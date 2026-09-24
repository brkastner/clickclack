package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestTangentsStayPrivateToOwnerAndBot(t *testing.T) {
	st := workflowAPIStore(t, "sqlite")
	ctx := context.Background()
	owner, err := st.EnsureBootstrap(ctx, "Owner", "tangent-owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	ws := workspaces[0]
	channels, err := st.ListChannels(ctx, ws.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channel := channels[0]
	member, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Member", Email: "tangent-member@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, ws.ID, member.ID, "member"); err != nil {
		t.Fatal(err)
	}
	bot, token, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: ws.ID, OwnerUserID: owner.ID, CreatedBy: owner.ID, DisplayName: "Tangent Bot", Scopes: []string{"bot:write"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, ws.ID, bot.ID, store.WorkspaceRoleBot); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(New(st, realtime.NewHub(), Options{UploadDir: t.TempDir()}).Handler())
	defer server.Close()
	ownerConn := dialRealtimeAsUser(t, server.URL, ws.ID, owner.ID)
	defer ownerConn.CloseNow()
	memberConn := dialRealtimeAsUser(t, server.URL, ws.ID, member.ID)
	defer memberConn.CloseNow()
	botConn := dialRealtimeWithBotToken(t, server.URL, ws.ID, token.Token)
	defer botConn.CloseNow()

	encode := func(body any) *strings.Reader {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		return strings.NewReader(string(raw))
	}
	openBody := map[string]any{"workspace_id": ws.ID, "channel_id": channel.ID, "bot_user_id": bot.ID}

	// Only people open tangents, only with a bot, and only on one target.
	expectStatusWithBearer(t, token.Token, http.MethodPost, server.URL+"/api/tangents", encode(openBody), http.StatusForbidden)
	expectStatusAsUser(t, owner.ID, http.MethodPost, server.URL+"/api/tangents", encode(map[string]any{"workspace_id": ws.ID, "channel_id": channel.ID, "bot_user_id": member.ID}), http.StatusBadRequest)
	expectStatusAsUser(t, owner.ID, http.MethodPost, server.URL+"/api/tangents", encode(map[string]any{"workspace_id": ws.ID, "bot_user_id": bot.ID}), http.StatusBadRequest)

	opened := postJSONAsUser[struct {
		Tangent tangentRecord `json:"tangent"`
	}](t, owner.ID, server.URL+"/api/tangents", openBody).Tangent
	if !strings.HasPrefix(opened.ID, "tng_") || opened.OwnerUserID != owner.ID || opened.BotUserID != bot.ID || opened.ChannelID != channel.ID {
		t.Fatalf("unexpected tangent: %#v", opened)
	}
	if _, ok := readEventTypeWithin(t, ownerConn, "tangent.opened", time.Second); !ok {
		t.Fatal("owner did not receive tangent.opened")
	}
	if event, ok := readEventTypeWithin(t, botConn, "tangent.opened", time.Second); !ok || event.Cursor != "" {
		t.Fatalf("bot tangent.opened = %#v, %v; want a cursorless frame", event, ok)
	}

	endpoint := server.URL + "/api/tangents/" + opened.ID
	// Other members can't see, read, or write the tangent.
	expectStatusAsUser(t, member.ID, http.MethodGet, endpoint, nil, http.StatusNotFound)
	expectStatusAsUser(t, member.ID, http.MethodPost, endpoint+"/messages", encode(map[string]any{"body": "hi"}), http.StatusNotFound)
	expectStatusAsUser(t, owner.ID, http.MethodPost, endpoint+"/messages", encode(map[string]any{"body": "   "}), http.StatusBadRequest)

	question := postJSONAsUser[struct {
		Message tangentMessage `json:"message"`
	}](t, owner.ID, endpoint+"/messages", map[string]any{"body": "side question", "client_id": "c1"}).Message
	if question.AuthorID != owner.ID || question.ClientID != "c1" {
		t.Fatalf("unexpected tangent message: %#v", question)
	}
	if event, ok := readEventTypeWithin(t, botConn, "tangent.message", time.Second); !ok {
		t.Fatal("bot did not receive the owner's tangent message")
	} else if payload, _ := event.Payload.(map[string]any); payload["tangent_id"] != opened.ID || payload["channel_id"] != channel.ID {
		t.Fatalf("unexpected tangent.message payload: %#v", event.Payload)
	}

	// Only the bot reports activity; the bot answers with its token.
	expectStatusAsUser(t, owner.ID, http.MethodPost, endpoint+"/activity", encode(map[string]any{"state": "working"}), http.StatusForbidden)
	expectStatusWithBearer(t, token.Token, http.MethodPost, endpoint+"/activity", encode(map[string]any{"state": "busy"}), http.StatusBadRequest)
	expectStatusWithBearer(t, token.Token, http.MethodPost, endpoint+"/activity", encode(map[string]any{"state": "working"}), http.StatusAccepted)
	if _, ok := readEventTypeWithin(t, ownerConn, "tangent.activity", time.Second); !ok {
		t.Fatal("owner did not receive tangent.activity")
	}
	expectStatusWithBearer(t, token.Token, http.MethodPost, endpoint+"/messages", encode(map[string]any{"body": "side answer"}), http.StatusCreated)
	if event, ok := readEventTypeWithin(t, ownerConn, "tangent.message", 2*time.Second); !ok {
		t.Fatal("owner did not receive the bot's reply")
	} else if payload, _ := event.Payload.(map[string]any); payload["message"].(map[string]any)["author_id"] != bot.ID {
		t.Fatalf("unexpected reply payload: %#v", event.Payload)
	}
	if event, ok := readEventTypeWithin(t, memberConn, "tangent.message", 300*time.Millisecond); ok {
		t.Fatalf("channel member received a private tangent frame: %#v", event)
	}

	// The bot can't close it; the owner can, and then it is gone.
	expectStatusWithBearer(t, token.Token, http.MethodDelete, endpoint, nil, http.StatusForbidden)
	expectStatusAsUser(t, owner.ID, http.MethodDelete, endpoint, nil, http.StatusNoContent)
	if event, ok := readEventTypeWithin(t, botConn, "tangent.closed", time.Second); !ok {
		t.Fatal("bot did not receive tangent.closed")
	} else if payload, _ := event.Payload.(map[string]any); payload["reason"] != "closed" {
		t.Fatalf("unexpected close payload: %#v", event.Payload)
	}
	expectStatusAsUser(t, owner.ID, http.MethodPost, endpoint+"/messages", encode(map[string]any{"body": "late"}), http.StatusNotFound)
	expectStatusWithBearer(t, token.Token, http.MethodPost, endpoint+"/messages", encode(map[string]any{"body": "late"}), http.StatusNotFound)
}

func TestTangentDirectConversationRequiresBotMember(t *testing.T) {
	st := workflowAPIStore(t, "sqlite")
	ctx := context.Background()
	owner, err := st.EnsureBootstrap(ctx, "Owner", "tangent-dm@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	ws := workspaces[0]
	makeBot := func(name string) store.User {
		bot, _, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: ws.ID, OwnerUserID: owner.ID, CreatedBy: owner.ID, DisplayName: name, Scopes: []string{"bot:write"}})
		if err != nil {
			t.Fatal(err)
		}
		if err := st.AddWorkspaceMember(ctx, ws.ID, bot.ID, store.WorkspaceRoleBot); err != nil {
			t.Fatal(err)
		}
		return bot
	}
	inDM, outside := makeBot("DM Bot"), makeBot("Other Bot")
	dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{WorkspaceID: ws.ID, UserID: owner.ID, MemberIDs: []string{inDM.ID}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(New(st, realtime.NewHub(), Options{UploadDir: t.TempDir()}).Handler())
	defer server.Close()

	body := func(botID string) *strings.Reader {
		raw, _ := json.Marshal(map[string]any{"workspace_id": ws.ID, "direct_conversation_id": dm.ID, "bot_user_id": botID})
		return strings.NewReader(string(raw))
	}
	expectStatusAsUser(t, owner.ID, http.MethodPost, server.URL+"/api/tangents", body(outside.ID), http.StatusBadRequest)
	expectStatusAsUser(t, owner.ID, http.MethodPost, server.URL+"/api/tangents", body(inDM.ID), http.StatusCreated)
}

func TestTangentRegistryCapsEachOwner(t *testing.T) {
	registry := newTangentRegistry()
	now := time.Now()
	var ids []string
	for i := range tangentMaxPerOwner + 1 {
		record := &tangentRecord{ID: newTangentID("tng_"), OwnerUserID: "usr_owner", lastActive: now.Add(time.Duration(i) * time.Second)}
		ids = append(ids, record.ID)
		evicted := registry.add(record, now.Add(time.Duration(i)*time.Second))
		if i < tangentMaxPerOwner && len(evicted) != 0 {
			t.Fatalf("add %d evicted %v too early", i, evicted)
		}
		if i == tangentMaxPerOwner && (len(evicted) != 1 || evicted[0].ID != ids[0]) {
			t.Fatalf("expected the oldest tangent to be evicted, got %#v", evicted)
		}
	}
	if _, ok := registry.get(ids[0]); ok {
		t.Fatal("evicted tangent is still registered")
	}
	stale := &tangentRecord{ID: newTangentID("tng_"), OwnerUserID: "usr_other", lastActive: now}
	registry.add(stale, now)
	later := now.Add(tangentIdleTTL + time.Minute)
	evicted := registry.add(&tangentRecord{ID: newTangentID("tng_"), OwnerUserID: "usr_third", lastActive: later}, later)
	if len(evicted) < 1 {
		t.Fatal("idle tangents were not evicted")
	}
	if _, ok := registry.get(stale.ID); ok {
		t.Fatal("idle tangent is still registered")
	}
}
