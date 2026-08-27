package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
	sqlitestore "github.com/openclaw/clickclack/apps/api/internal/store/sqlite"
)

func TestChannelBotPresentations(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := sqlitestore.Open("sqlite://" + filepath.Join(dataDir, "clickclack.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	owner, err := st.EnsureBootstrap(ctx, "Owner", "owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	workspace := workspaces[0]
	channels, err := st.ListChannels(ctx, workspace.ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channel := channels[0]
	member, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Member", Email: "member@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, workspace.ID, member.ID, store.WorkspaceRoleMember); err != nil {
		t.Fatal(err)
	}
	bot, token, err := st.CreateBot(ctx, store.CreateBotInput{
		WorkspaceID: workspace.ID,
		DisplayName: "Kai",
		Handle:      "kai",
		TokenName:   "test",
		Scopes:      []string{"channels:read", "channels:write"},
		CreatedBy:   owner.ID,
	})
	if err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(New(st, realtime.NewHub(), Options{UploadDir: filepath.Join(dataDir, "uploads")}).Handler())
	t.Cleanup(server.Close)
	endpoint := server.URL + "/api/channels/" + channel.ID + "/bot-presentations/" + bot.ID

	presentation := putJSON[struct {
		Presentation store.ChannelBotPresentation `json:"presentation"`
		Event        store.Event                  `json:"event"`
	}](t, endpoint, map[string]string{
		"display_name": "  лиза  ",
		"avatar_url":   "https://example.com/liz.webp",
	})
	if presentation.Presentation.DisplayName != "лиза" || presentation.Presentation.BotUserID != bot.ID || presentation.Event.Type != "channel.updated" {
		t.Fatalf("unexpected presentation response: %#v", presentation)
	}

	listed := getJSON[struct {
		Channels []store.Channel `json:"channels"`
	}](t, server.URL+"/api/workspaces/"+workspace.ID+"/channels")
	if len(listed.Channels) != 1 || len(listed.Channels[0].BotPresentations) != 1 || listed.Channels[0].BotPresentations[0].DisplayName != "лиза" {
		t.Fatalf("channel presentation was not hydrated: %#v", listed.Channels)
	}

	payload, err := json.Marshal(map[string]string{"display_name": "nope"})
	if err != nil {
		t.Fatal(err)
	}
	expectStatusAsUser(t, member.ID, http.MethodPut, endpoint, bytes.NewReader(payload), http.StatusForbidden)

	req, err := http.NewRequest(http.MethodPut, endpoint, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("bot token presentation mutation status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}

	deleteJSONBody[struct {
		Event store.Event `json:"event"`
	}](t, endpoint)
	listed = getJSON[struct {
		Channels []store.Channel `json:"channels"`
	}](t, server.URL+"/api/workspaces/"+workspace.ID+"/channels")
	if len(listed.Channels[0].BotPresentations) != 0 {
		t.Fatalf("presentation was not deleted: %#v", listed.Channels[0].BotPresentations)
	}
}

func putJSON[T any](t *testing.T, endpoint string, body any) T {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPut, endpoint, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	return doJSON[T](t, req)
}
