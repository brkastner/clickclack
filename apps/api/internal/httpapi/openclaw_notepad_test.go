package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/openclaw/clickclack/apps/api/internal/config"
	"github.com/openclaw/clickclack/apps/api/internal/notepad/notepadtest"
	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestNotepadConversationAuthorizationAndWatch(t *testing.T) {
	st := workflowAPIStore(t, "sqlite")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	owner, err := st.EnsureBootstrap(ctx, "Owner", "notepad@example.test")
	if err != nil {
		t.Fatal(err)
	}
	spaces, _ := st.ListWorkspaces(ctx, owner.ID)
	ws := spaces[0]
	channels, _ := st.ListChannels(ctx, ws.ID, owner.ID)
	ch := channels[0]
	viewer, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Viewer", Email: "notepad-viewer@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	if err = st.AddWorkspaceMember(ctx, ws.ID, viewer.ID, store.WorkspaceRoleMember); err != nil {
		t.Fatal(err)
	}
	private, _, err := st.CreateChannel(ctx, store.CreateChannelInput{WorkspaceID: ws.ID, UserID: owner.ID, Name: "notepad-private", Kind: "private"})
	if err != nil {
		t.Fatal(err)
	}
	dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{WorkspaceID: ws.ID, UserID: owner.ID, MemberIDs: []string{viewer.ID}})
	if err != nil {
		t.Fatal(err)
	}
	outsider, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Outside", Email: "notepad-outside@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	g := notepadtest.New(t)
	key := "agent:a:global"
	other := "agent:b:global"
	g.Set(key, notepadtest.Card(key, "channel card", 1))
	g.Set(other, notepadtest.Card(other, "dm card", 2))
	cfg := config.OpenClawNotepadConfig{Gateways: []config.OpenClawNotepadGateway{g.Config}, Bindings: []config.OpenClawNotepadBinding{
		{WorkspaceID: ws.ID, ChannelID: ch.ID, GatewayID: g.Config.ID, AgentID: "a", SessionKey: "global"},
		{WorkspaceID: ws.ID, DirectConversationID: dm.ID, GatewayID: g.Config.ID, AgentID: "b", SessionKey: "global"},
	}}
	api := New(st, realtime.NewHub(), Options{OpenClawNotepad: cfg})
	api.realtimeSessionCheck = 10 * time.Millisecond
	server := httptest.NewServer(api.Handler())
	defer server.Close()
	read := func(path, user string) string {
		t.Helper()
		req, _ := http.NewRequestWithContext(ctx, "GET", server.URL+path, nil)
		req.Header.Set("X-ClickClack-User", user)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != 200 {
			t.Fatalf("%d %s", resp.StatusCode, body)
		}
		if resp.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("cache enabled")
		}
		return string(body)
	}
	channelPath := "/api/channels/" + ch.ID + "/notepad"
	dmPath := "/api/dms/" + dm.ID + "/notepad"
	availability := func(path, user string) string {
		t.Helper()
		req, _ := http.NewRequestWithContext(ctx, "GET", server.URL+path+"/availability", nil)
		req.Header.Set("X-ClickClack-User", user)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK || resp.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("%d %s", resp.StatusCode, body)
		}
		return string(body)
	}
	for _, path := range []string{channelPath, dmPath} {
		body := availability(path, viewer.ID)
		if body != "{\"available\":true}\n" || strings.Contains(body, "agent:") || strings.Contains(body, g.Config.Token) {
			t.Fatal(body)
		}
	}
	// Unbound and Pi-only conversations have no server binding and therefore no entry.
	if body := availability("/api/channels/"+private.ID+"/notepad", owner.ID); body != "{\"available\":false}\n" {
		t.Fatal(body)
	}
	body := read(channelPath, viewer.ID)
	if !strings.Contains(body, "channel card") || strings.Contains(body, "agent:") || strings.Contains(body, g.Config.Token) {
		t.Fatal(body)
	}
	if body = read(dmPath, viewer.ID); !strings.Contains(body, "dm card") {
		t.Fatal(body)
	}
	if body = read("/api/channels/"+private.ID+"/notepad", owner.ID); !strings.Contains(body, "unmapped") {
		t.Fatal(body)
	}
	for _, path := range []string{channelPath, dmPath} {
		expectStatusAsUser(t, outsider.ID, "GET", server.URL+path, nil, 403)
		expectStatusAsUser(t, outsider.ID, "GET", server.URL+path+"/availability", nil, 403)
		expectStatusAsUser(t, outsider.ID, "GET", server.URL+path+"/watch", nil, 403)
	}
	if err := st.AddWorkspaceMember(ctx, ws.ID, outsider.ID, store.WorkspaceRoleGuest); err != nil {
		t.Fatal(err)
	}
	expectStatusAsUser(t, outsider.ID, "GET", server.URL+"/api/channels/"+private.ID+"/notepad", nil, 403)
	session, err := st.CreateSession(ctx, viewer.ID)
	if err != nil {
		t.Fatal(err)
	}
	socket, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+channelPath+"/watch", &websocket.DialOptions{Subprotocols: []string{websocketBearerProtocolPrefix + session.Token}})
	if err != nil {
		t.Fatal(err)
	}
	defer socket.CloseNow()
	_, raw, err := socket.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var notice map[string]string
	if json.Unmarshal(raw, &notice) != nil || notice["state"] != "ready" {
		t.Fatal(string(raw))
	}
	g.Change(key, 2)
	_, raw, err = socket.Read(ctx)
	if err != nil || strings.Contains(string(raw), "channel card") || strings.Contains(string(raw), key) {
		t.Fatalf("invalid notice %s %v", raw, err)
	}
	if err = st.RevokeSession(ctx, session.Token); err != nil {
		t.Fatal(err)
	}
	g.Change(key, 3)
	_, _, err = socket.Read(ctx)
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("revoked session received frame or wrong closure: %v", err)
	}
}
