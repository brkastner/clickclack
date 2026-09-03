package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
	sqlitestore "github.com/openclaw/clickclack/apps/api/internal/store/sqlite"
)

// TestWorkflowRunEphemeralAuthz is the acceptance gate for the workflow.run
// ephemeral frame. It carries the live state of a workflow a bot is running on
// a conversation's behalf, so it inherits the agent.progress rules exactly:
//
//   - bot-token-only (a human session can never publish run state),
//   - gated by the existing bot write scopes,
//   - required to name exactly one concrete target, so a private run can never
//     broadcast to the whole workspace,
//   - DM targets bind to server-derived conversation members.
func TestWorkflowRunEphemeralAuthz(t *testing.T) {
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

	bridgeBot, bridgeToken, err := st.CreateBot(ctx, store.CreateBotInput{
		WorkspaceID: workspace.ID,
		OwnerUserID: owner.ID,
		DisplayName: "Bridge Bot",
		Scopes:      []string{"bot:write"},
		CreatedBy:   owner.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, workspace.ID, bridgeBot.ID, "bot"); err != nil {
		t.Fatal(err)
	}

	readBot, readToken, err := st.CreateBot(ctx, store.CreateBotInput{
		WorkspaceID: workspace.ID,
		OwnerUserID: owner.ID,
		DisplayName: "Read Bot",
		Scopes:      []string{"bot:read"},
		CreatedBy:   owner.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, workspace.ID, readBot.ID, "bot"); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(New(st, realtime.NewHub(), Options{UploadDir: filepath.Join(dataDir, "uploads")}).Handler())
	t.Cleanup(server.Close)

	ephemeralURL := server.URL + "/api/realtime/ephemeral"
	channelFrame := `{"workspace_id":"` + workspace.ID + `","channel_id":"` + channel.ID +
		`","type":"workflow.run","payload":{"run":{"runId":"run_1","workflowName":"ship-it","status":"waiting"}}}`

	// 1. A human session cannot publish run state at all.
	expectStatus(t, http.MethodPost, ephemeralURL, strings.NewReader(channelFrame), http.StatusForbidden)

	// 2. A read-only bot is rejected.
	expectStatusWithBearer(t, readToken.Token, http.MethodPost, ephemeralURL, strings.NewReader(channelFrame), http.StatusForbidden)

	// 3. A normal bot:write bridge bot publishing to a channel target is accepted.
	expectStatusWithBearer(t, bridgeToken.Token, http.MethodPost, ephemeralURL, strings.NewReader(channelFrame), http.StatusAccepted)

	// 4. A frame with NO concrete target is rejected. Without this it would fall
	//    through to the workspace-wide branch and put a private conversation's
	//    run state in front of every member.
	noTarget := `{"workspace_id":"` + workspace.ID +
		`","type":"workflow.run","payload":{"run":{"runId":"run_1","workflowName":"ship-it","status":"waiting"}}}`
	expectStatusWithBearer(t, bridgeToken.Token, http.MethodPost, ephemeralURL, strings.NewReader(noTarget), http.StatusBadRequest)

	// 5. Channel and DM targets are mutually exclusive.
	bothTargets := `{"workspace_id":"` + workspace.ID + `","channel_id":"` + channel.ID +
		`","direct_conversation_id":"dm_whatever","type":"workflow.run","payload":{"run":{"runId":"run_1"}}}`
	expectStatusWithBearer(t, bridgeToken.Token, http.MethodPost, ephemeralURL, strings.NewReader(bothTargets), http.StatusBadRequest)

	// 6. A DM-targeted frame binds to server-derived recipients.
	dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
		WorkspaceID: workspace.ID,
		UserID:      owner.ID,
		MemberIDs:   []string{bridgeBot.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	dmFrame := `{"workspace_id":"` + workspace.ID + `","direct_conversation_id":"` + dm.ID +
		`","type":"workflow.run","payload":{"run":{"runId":"run_2","workflowName":"private-thing","status":"running"}}}`
	dmResult, dmStatus := postJSONWithBearerStatus[struct {
		Event store.Event `json:"event"`
	}](t, bridgeToken.Token, ephemeralURL, dmFrame)
	if dmStatus != http.StatusAccepted {
		t.Fatalf("DM workflow.run: expected 202, got %d", dmStatus)
	}
	if dmResult.Event.Type != "workflow.run" {
		t.Fatalf("DM workflow.run: unexpected event type %q", dmResult.Event.Type)
	}
	// Recipient binding is not observable here: store.Event.RecipientUserIDs is
	// json:"-", so it never crosses the HTTP response. The delivery test below
	// proves the binding over the wire, which is where it actually matters.
}

// TestWorkflowRunDeliversOverRealtimeWithPrivateScoping is the end-to-end proof
// that run state honours conversation privacy over the wire:
//
//   - a channel-targeted frame reaches a workspace member on the WS, and
//   - a DM-targeted frame reaches DM members but NOT a workspace member outside
//     the conversation, via server-derived recipients.
//
// This matters more for run state than it looks. A run names the workflow being
// executed and what it is waiting on, so a leak tells a non-member what someone
// else is doing in a private conversation.
func TestWorkflowRunDeliversOverRealtimeWithPrivateScoping(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
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

	// The viewer is an ordinary workspace member, not the bot and not a DM member.
	viewer, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Viewer", Email: "viewer@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, workspace.ID, viewer.ID, "member"); err != nil {
		t.Fatal(err)
	}

	bridgeBot, bridgeToken, err := st.CreateBot(ctx, store.CreateBotInput{
		WorkspaceID: workspace.ID,
		OwnerUserID: owner.ID,
		DisplayName: "Bridge Bot",
		Scopes:      []string{"bot:write"},
		CreatedBy:   owner.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, workspace.ID, bridgeBot.ID, "bot"); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(New(st, realtime.NewHub(), Options{UploadDir: filepath.Join(dataDir, "uploads")}).Handler())
	t.Cleanup(server.Close)
	ephemeralURL := server.URL + "/api/realtime/ephemeral"
	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) +
		"/api/realtime/ws?workspace_id=" + url.QueryEscape(workspace.ID)

	viewerConn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"X-ClickClack-User": []string{viewer.ID}},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = viewerConn.Close(websocket.StatusNormalClosure, "done") })
	// Dial returns once the upgrade completes, but hub.Subscribe runs just after
	// in the handler goroutine. Settle so the first publish is not missed.
	time.Sleep(200 * time.Millisecond)

	// 1. A channel-targeted frame reaches the subscribed workspace member.
	channelFrame := `{"workspace_id":"` + workspace.ID + `","channel_id":"` + channel.ID +
		`","type":"workflow.run","payload":{"run":{"runId":"run_1","workflowName":"ship-it","status":"running"}}}`
	_, status := postJSONWithBearerStatus[struct{}](t, bridgeToken.Token, ephemeralURL, channelFrame)
	if status != http.StatusAccepted {
		t.Fatalf("channel workflow.run: expected 202, got %d", status)
	}
	channelEvent := readEventType(t, viewerConn, "workflow.run")
	if channelEvent.ChannelID != channel.ID {
		t.Fatalf("channel workflow.run delivered with wrong channel: %#v", channelEvent)
	}

	// 2. A DM-targeted frame must NOT reach the viewer, who is outside the DM.
	dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{
		WorkspaceID: workspace.ID,
		UserID:      owner.ID,
		MemberIDs:   []string{bridgeBot.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	dmFrame := `{"workspace_id":"` + workspace.ID + `","direct_conversation_id":"` + dm.ID +
		`","type":"workflow.run","payload":{"run":{"runId":"run_2","workflowName":"private-workflow","status":"waiting"}}}`
	_, dmStatus := postJSONWithBearerStatus[struct{}](t, bridgeToken.Token, ephemeralURL, dmFrame)
	if dmStatus != http.StatusAccepted {
		t.Fatalf("dm workflow.run: expected 202, got %d", dmStatus)
	}

	// A follow-up channel frame acts as a sentinel: a leaked DM frame would
	// arrive before it, and the sentinel proves the socket is still live.
	sentinelFrame := `{"workspace_id":"` + workspace.ID + `","channel_id":"` + channel.ID +
		`","type":"workflow.run","payload":{"run":{"runId":"run_1","workflowName":"ship-it","status":"completed"}}}`
	_, sentinelStatus := postJSONWithBearerStatus[struct{}](t, bridgeToken.Token, ephemeralURL, sentinelFrame)
	if sentinelStatus != http.StatusAccepted {
		t.Fatalf("sentinel workflow.run: expected 202, got %d", sentinelStatus)
	}

	nextEvent := readEventType(t, viewerConn, "workflow.run")
	payload, _ := nextEvent.Payload.(map[string]any)
	if payload == nil {
		t.Fatalf("expected workflow.run payload map, got %#v", nextEvent.Payload)
	}
	run, _ := payload["run"].(map[string]any)
	if run == nil {
		t.Fatalf("expected a run in the payload, got %#v", payload)
	}
	if name, _ := run["workflowName"].(string); name == "private-workflow" {
		t.Fatalf("DM-scoped run state leaked to a non-member over the WS: %#v", nextEvent)
	}
	if runStatus, _ := run["status"].(string); runStatus != "completed" {
		t.Fatalf("expected the sentinel channel frame next, got %#v", nextEvent)
	}
}
