package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestAtomicMessageReplayPreservesAttachments(t *testing.T) {
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			var st store.Store
			if backend == "postgres" {
				st, _ = newIsolatedPostgresHTTPTestStore(t)
			} else {
				st = newEmptyHTTPStore(t)
			}
			ctx := context.Background()
			if err := st.Migrate(ctx); err != nil {
				t.Fatal(err)
			}
			owner, err := st.EnsureBootstrap(ctx, "Attachment Owner", "attachments@example.com")
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
			server := httptest.NewServer(New(st, realtime.NewHub(), Options{UploadDir: filepath.Join(t.TempDir(), "uploads")}).Handler())
			t.Cleanup(server.Close)
			for _, target := range []struct{ kind, path string }{
				{"channel", "/api/channels/" + channels[0].ID + "/messages"},
				{"dm", "/api/dms/" + dm.ID + "/messages"},
			} {
				t.Run(target.kind, func(t *testing.T) {
					first := uploadFile(t, server.URL+"/api/uploads", workspace.ID, "first.txt", "first")
					second := uploadFile(t, server.URL+"/api/uploads", workspace.ID, "second.txt", "second")
					payload := map[string]any{"body": "complete replay", "nonce": target.kind, "upload_id": first.ID, "expected_attachment_count": 2}
					type response struct {
						Message store.Message `json:"message"`
						Event   store.Event   `json:"event"`
					}
					created := postJSON[response](t, server.URL+target.path, payload)
					if len(created.Message.Attachments) != 1 || created.Message.Attachments[0].ID != first.ID {
						t.Fatalf("atomic create did not return its first attachment: %#v", created.Message.Attachments)
					}
					fields, ok := created.Event.Payload.(map[string]any)
					if !ok || fields["expected_attachment_count"] != "2" {
						t.Fatalf("multi-upload completion boundary missing from create event: %#v", created.Event.Payload)
					}
					// A failed second link must leave the declared completion boundary
					// above the hydrated count. Retrying create must not emit a new turn.
					attachmentURL := server.URL + "/api/messages/" + created.Message.ID + "/attachments"
					expectStatus(t, http.MethodPost, attachmentURL, strings.NewReader(`{"upload_id":"upl_missing"}`), http.StatusForbidden)
					partial := postJSON[response](t, server.URL+target.path, payload)
					if partial.Message.ID != created.Message.ID || len(partial.Message.Attachments) != 1 || partial.Event.ID != "" {
						t.Fatalf("partial replay changed completion or emitted a duplicate create: %#v", partial)
					}
					postJSON[struct{}](t, attachmentURL, map[string]string{"upload_id": second.ID})
					duplicate := postJSON[response](t, attachmentURL, map[string]string{"upload_id": second.ID})
					if duplicate.Event.ID != "" {
						t.Fatalf("duplicate attachment emitted another event: %#v", duplicate)
					}
					replayed, status := postJSONWithStatus[response](t, server.URL+target.path, payload)
					if status != http.StatusOK || replayed.Message.ID != created.Message.ID || replayed.Event.ID != "" {
						t.Fatalf("unexpected replay: status=%d response=%#v", status, replayed)
					}
					attachments := replayed.Message.Attachments
					if len(attachments) != 2 || attachments[0].ID != first.ID || attachments[1].ID != second.ID {
						t.Fatalf("replay lost attachments: %#v", attachments)
					}
					unlinked := uploadFile(t, server.URL+"/api/uploads", workspace.ID, "unlinked.txt", "unlinked")
					expectStatus(t, http.MethodPost, server.URL+target.path, strings.NewReader(`{"body":"complete replay","nonce":"`+target.kind+`","upload_id":"`+unlinked.ID+`"}`), http.StatusBadRequest)
					stored := getJSON[response](t, server.URL+"/api/messages/"+created.Message.ID)
					if len(stored.Message.Attachments) != 2 {
						t.Fatalf("conflicting replay changed attachments: %#v", stored.Message.Attachments)
					}
					single := postJSON[response](t, server.URL+target.path, map[string]any{"body": "single atomic", "nonce": target.kind + "-single", "upload_id": unlinked.ID, "expected_attachment_count": 1})
					if len(single.Message.Attachments) != 1 || single.Message.Attachments[0].ID != unlinked.ID {
						t.Fatalf("single atomic attachment missing: %#v", single)
					}
					zero := postJSON[response](t, server.URL+target.path, map[string]any{"body": "no attachments", "nonce": target.kind + "-zero", "expected_attachment_count": 0})
					if len(zero.Message.Attachments) != 0 {
						t.Fatalf("zero-attachment create unexpectedly linked uploads: %#v", zero.Message.Attachments)
					}
				})
			}
			t.Run("channel replay after moderation", func(t *testing.T) {
				upload := uploadFileAsUser(t, peer.ID, server.URL+"/api/uploads", workspace.ID, "committed.txt", "committed")
				endpoint := server.URL + "/api/channels/" + channels[0].ID + "/messages"
				payload := map[string]string{"body": "already committed", "nonce": "moderated-replay", "upload_id": upload.ID}
				type response struct {
					Message store.Message `json:"message"`
					Event   store.Event   `json:"event"`
				}
				created := postJSONAsUser[response](t, peer.ID, endpoint, payload)
				blocked := true
				if _, _, err := st.UpdateMemberModeration(ctx, store.UpdateMemberModerationInput{WorkspaceID: workspace.ID, ActorUserID: owner.ID, TargetUserID: peer.ID, Blocked: &blocked}); err != nil {
					t.Fatal(err)
				}
				replayed := postJSONAsUser[response](t, peer.ID, endpoint, payload)
				if replayed.Message.ID != created.Message.ID || replayed.Event.ID != "" || len(replayed.Message.Attachments) != 1 || replayed.Message.Attachments[0].ID != upload.ID {
					t.Fatalf("committed channel replay changed after moderation: %#v", replayed)
				}
				expectStatusAsUser(t, peer.ID, http.MethodPost, endpoint, strings.NewReader(`{"body":"new write","nonce":"new-after-block","upload_id":"`+upload.ID+`"}`), http.StatusForbidden)
			})
		})
	}
}
