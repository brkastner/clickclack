package httpapi

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestBotPublishesConversationNotepad(t *testing.T) {
	st := workflowAPIStore(t, "sqlite")
	ctx := context.Background()
	owner, err := st.EnsureBootstrap(ctx, "Owner", "published-notepad@example.test")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, _ := st.ListWorkspaces(ctx, owner.ID)
	workspace := workspaces[0]
	channels, _ := st.ListChannels(ctx, workspace.ID, owner.ID)
	channel := channels[0]
	bot, token, err := st.CreateBot(ctx, store.CreateBotInput{
		WorkspaceID: workspace.ID,
		OwnerUserID: owner.ID,
		CreatedBy:   owner.ID,
		DisplayName: "Pi",
		Scopes:      []string{"messages:read", "agent_activity:write"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = st.AddWorkspaceMember(ctx, workspace.ID, bot.ID, store.WorkspaceRoleBot); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(New(st, realtime.NewHub(), Options{}).Handler())
	defer server.Close()
	path := "/api/channels/" + channel.ID + "/notepad"
	body := `{"card":{"revision":7,"updatedAt":1234,"markdown":"**1 of 2 complete**","steps":[{"step":"Ship it","status":"in_progress"}]}}`
	req, _ := http.NewRequestWithContext(ctx, http.MethodPut, server.URL+path, bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer "+token.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	published, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(published), "Ship it") {
		t.Fatalf("publish: %d %s", resp.StatusCode, published)
	}

	for _, suffix := range []string{"/availability", ""} {
		req, _ = http.NewRequestWithContext(ctx, http.MethodGet, server.URL+path+suffix, nil)
		req.Header.Set("X-ClickClack-User", owner.ID)
		resp, err = http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		result, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("read %s: %d %s", suffix, resp.StatusCode, result)
		}
		if suffix == "/availability" && string(result) != "{\"available\":true}\n" {
			t.Fatal(string(result))
		}
		if suffix == "" && (!strings.Contains(string(result), "Ship it") || !strings.Contains(string(result), "ready")) {
			t.Fatal(string(result))
		}
	}

	session, err := st.CreateSession(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	watchCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	socket, _, err := websocket.Dial(watchCtx, "ws"+strings.TrimPrefix(server.URL, "http")+path+"/watch", &websocket.DialOptions{
		Subprotocols: []string{websocketBearerProtocolPrefix + session.Token},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer socket.CloseNow()
	if _, frame, err := socket.Read(watchCtx); err != nil || !strings.Contains(string(frame), "ready") {
		t.Fatalf("initial watch notice: %s %v", frame, err)
	}
	req, _ = http.NewRequestWithContext(ctx, http.MethodPut, server.URL+path, bytes.NewBufferString(`{"card":null}`))
	req.Header.Set("Authorization", "Bearer "+token.Token)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("clear notepad returned %d", resp.StatusCode)
	}
	if _, frame, err := socket.Read(watchCtx); err != nil || !strings.Contains(string(frame), "ready") {
		t.Fatalf("updated watch notice: %s %v", frame, err)
	}

	req, _ = http.NewRequestWithContext(ctx, http.MethodPut, server.URL+path, bytes.NewBufferString(`{"card":null}`))
	req.Header.Set("X-ClickClack-User", owner.ID)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("human notepad mutation returned %d", resp.StatusCode)
	}
}
