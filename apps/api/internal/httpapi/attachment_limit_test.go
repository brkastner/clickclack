package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestMessageAttachmentCountLimit(t *testing.T) {
	st := newEmptyHTTPStore(t)
	ctx := context.Background()
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
	peer, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Peer", Email: "peer@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, workspace.ID, peer.ID, store.WorkspaceRoleMember); err != nil {
		t.Fatal(err)
	}
	dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{WorkspaceID: workspace.ID, UserID: owner.ID, MemberIDs: []string{peer.ID}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(New(st, realtime.NewHub(), Options{}).Handler())
	t.Cleanup(server.Close)
	type response struct {
		Message store.Message `json:"message"`
	}
	channelPath := "/api/channels/" + channels[0].ID + "/messages"
	root := postJSON[response](t, server.URL+channelPath, map[string]any{"body": "root"})
	for _, endpoint := range []string{channelPath, "/api/dms/" + dm.ID + "/messages", "/api/messages/" + root.Message.ID + "/thread/replies"} {
		t.Run(endpoint, func(t *testing.T) {
			for _, count := range []int{0, 11, 50} {
				created := postJSON[response](t, server.URL+endpoint, map[string]any{"body": "batch", "expected_attachment_count": count})
				if created.Message.ID == "" {
					t.Fatalf("count %d: missing message", count)
				}
			}
			for _, count := range []int{-1, 51} {
				expectStatus(t, http.MethodPost, server.URL+endpoint, strings.NewReader(fmt.Sprintf(`{"body":"batch","expected_attachment_count":%d}`, count)), http.StatusBadRequest)
			}
		})
	}
}
