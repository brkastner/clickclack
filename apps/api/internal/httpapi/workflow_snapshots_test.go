package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
	pgstore "github.com/openclaw/clickclack/apps/api/internal/store/postgres"
	sqlitestore "github.com/openclaw/clickclack/apps/api/internal/store/sqlite"
	"github.com/openclaw/clickclack/apps/api/internal/store/storetest"
)

func workflowAPIStore(t *testing.T, backend string) store.Store {
	t.Helper()
	var st store.Store
	var err error
	if backend == "sqlite" {
		st, err = sqlitestore.Open("sqlite://" + filepath.Join(t.TempDir(), "workflow.db"))
	} else {
		dsn := os.Getenv("CLICKCLACK_POSTGRES_TEST_DSN")
		if dsn == "" {
			t.Skip("set CLICKCLACK_POSTGRES_TEST_DSN for isolated Postgres API tests")
		}
		admin, e := sql.Open("pgx", dsn)
		if e != nil {
			t.Fatal(e)
		}
		schema := fmt.Sprintf("workflow_api_%d", time.Now().UnixNano())
		if _, e = admin.Exec("CREATE SCHEMA " + schema); e != nil {
			_ = admin.Close()
			t.Fatal(e)
		}
		t.Cleanup(func() {
			if _, e := admin.Exec("DROP SCHEMA " + schema + " CASCADE"); e != nil {
				t.Error(e)
			}
			_ = admin.Close()
		})
		parsed, e := url.Parse(dsn)
		if e != nil {
			t.Fatal(e)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		st, err = pgstore.Open(parsed.String())
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := st.Close(); err != nil {
			t.Error(err)
		}
	})
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	return st
}
func TestWorkflowSnapshotAPI(t *testing.T) {
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			st := workflowAPIStore(t, backend)
			ctx := context.Background()
			owner, err := st.EnsureBootstrap(ctx, "Owner", "snapshot@example.com")
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
			ch := channels[0]
			makeBot := func(scopes []string) (store.User, store.BotToken) {
				bot, token, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: ws.ID, OwnerUserID: owner.ID, CreatedBy: owner.ID, DisplayName: "Snapshot Bot", Scopes: scopes})
				if err != nil {
					t.Fatal(err)
				}
				if err := st.AddWorkspaceMember(ctx, ws.ID, bot.ID, "bot"); err != nil {
					t.Fatal(err)
				}
				return bot, token
			}
			bot, token := makeBot([]string{"bot:write", "bot:read", store.AgentActivityWriteScope})
			_, unscoped := makeBot([]string{"bot:write"})
			_, noDM := makeBot([]string{"messages:write", store.AgentActivityWriteScope})
			server := httptest.NewServer(New(st, realtime.NewHub(), Options{UploadDir: t.TempDir()}).Handler())
			defer server.Close()
			viewer, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Viewer", Email: "snapshot-viewer@example.com"})
			if err != nil {
				t.Fatal(err)
			}
			if err := st.AddWorkspaceMember(ctx, ws.ID, viewer.ID, store.WorkspaceRoleMember); err != nil {
				t.Fatal(err)
			}
			viewerConn := dialRealtimeAsUser(t, server.URL, ws.ID, viewer.ID)
			defer func() { _ = viewerConn.Close(websocket.StatusNormalClosure, "done") }()
			ownerConn := dialRealtimeAsUser(t, server.URL, ws.ID, owner.ID)
			defer func() { _ = ownerConn.Close(websocket.StatusNormalClosure, "done") }()
			time.Sleep(100 * time.Millisecond)
			endpoint := server.URL + "/api/workflow-runs"
			snapshot := storetest.WorkflowSnapshotFixture()
			body := map[string]any{"workspace_id": ws.ID, "channel_id": ch.ID, "snapshot": snapshot}
			encode := func() string {
				raw, err := json.Marshal(body)
				if err != nil {
					t.Fatal(err)
				}
				return string(raw)
			}
			expectStatusAsUser(t, owner.ID, http.MethodPost, endpoint, strings.NewReader(encode()), http.StatusForbidden)
			expectStatusWithBearer(t, unscoped.Token, http.MethodPost, endpoint, strings.NewReader(encode()), http.StatusForbidden)
			type response struct {
				Record  store.WorkflowRunRecord `json:"record"`
				Changed bool                    `json:"changed"`
			}
			first, status := postJSONWithBearerStatus[response](t, token.Token, endpoint, encode())
			if status != 200 || !first.Changed || first.Record.ProducerID != bot.ID {
				t.Fatalf("initial: %#v %d", first, status)
			}
			event := readEventType(t, viewerConn, "workflow.snapshot")
			if event.ChannelID != ch.ID {
				t.Fatalf("unscoped channel notification: %#v", event)
			}
			readEventType(t, ownerConn, "workflow.snapshot")
			same, status := postJSONWithBearerStatus[response](t, token.Token, endpoint, encode())
			if status != 200 || same.Changed || same.Record.ID != first.Record.ID {
				t.Fatalf("replay: %#v %d", same, status)
			}
			snapshot.Run.Status = "failed"
			body["snapshot"] = snapshot
			expectStatusWithBearer(t, token.Token, http.MethodPost, endpoint, strings.NewReader(encode()), http.StatusConflict)
			snapshot.Source.Revision = 0
			body["snapshot"] = snapshot
			stale, status := postJSONWithBearerStatus[response](t, token.Token, endpoint, encode())
			if status != 200 || stale.Changed || stale.Record.Snapshot.Run.Status != "completed" {
				t.Fatalf("stale: %#v %d", stale, status)
			}
			snapshot.Source.Revision = 2
			snapshot.Files.Entries[0].Path = "../../secret"
			body["snapshot"] = snapshot
			expectStatusWithBearer(t, token.Token, http.MethodPost, endpoint, strings.NewReader(encode()), http.StatusBadRequest)
			snapshot = storetest.WorkflowSnapshotFixture()
			body["snapshot"] = snapshot
			list := server.URL + "/api/channels/" + ch.ID + "/workflow-runs"
			expectStatusAsUser(t, owner.ID, http.MethodGet, list, nil, http.StatusOK)
			expectStatusAsUser(t, owner.ID, http.MethodGet, list+"?limit=21", nil, http.StatusBadRequest)
			outsider, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Outsider", Email: "outside-snapshot@example.com"})
			if err != nil {
				t.Fatal(err)
			}
			req, _ := http.NewRequest(http.MethodGet, list, nil)
			req.Header.Set("X-ClickClack-User", outsider.ID)
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			if err := res.Body.Close(); err != nil {
				t.Fatal(err)
			}
			if res.StatusCode == 200 {
				t.Fatal("outsider could read")
			}
			dm, err := st.CreateDirectConversation(ctx, store.CreateDirectConversationInput{WorkspaceID: ws.ID, UserID: owner.ID, MemberIDs: []string{bot.ID}})
			if err != nil {
				t.Fatal(err)
			}
			body["direct_conversation_id"] = dm.ID
			expectStatusWithBearer(t, token.Token, http.MethodPost, endpoint, strings.NewReader(encode()), http.StatusBadRequest)
			delete(body, "channel_id")
			expectStatusWithBearer(t, noDM.Token, http.MethodPost, endpoint, strings.NewReader(encode()), http.StatusForbidden)
			direct, status := postJSONWithBearerStatus[response](t, token.Token, endpoint, encode())
			if status != 200 || direct.Record.ID == first.Record.ID {
				t.Fatalf("DM: %#v %d", direct, status)
			}
			expectStatusAsUser(t, owner.ID, http.MethodGet, server.URL+"/api/dms/"+dm.ID+"/workflow-runs", nil, http.StatusOK)
			dmEvent := readEventType(t, ownerConn, "workflow.snapshot")
			if dmEvent.ChannelID != "" {
				t.Fatalf("DM channel leak: %#v", dmEvent)
			}
			// A later channel sentinel must be the viewer's next snapshot: the
			// intervening private DM and idempotent writes must not arrive.
			body["channel_id"] = ch.ID
			delete(body, "direct_conversation_id")
			snapshot.Source.Revision = 3
			body["snapshot"] = snapshot
			expectStatusWithBearer(t, token.Token, http.MethodPost, endpoint, strings.NewReader(encode()), http.StatusOK)
			sentinel := readEventType(t, viewerConn, "workflow.snapshot")
			if sentinel.ChannelID != ch.ID {
				t.Fatalf("private snapshot leaked: %#v", sentinel)
			}
			// Private kind does not restrict regular workspace members. Exercise
			// the enforced guest boundary instead, with a readable sentinel.
			guest, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Guest", Email: "snapshot-guest@example.com"})
			if err != nil {
				t.Fatal(err)
			}
			guestWS, err := st.EnsureDefaultGuestWorkspaceMember(ctx, guest.ID, store.WorkspaceRoleGuest)
			if err != nil {
				t.Fatal(err)
			}
			if err := st.AddWorkspaceMember(ctx, guestWS.ID, owner.ID, store.WorkspaceRoleOwner); err != nil {
				t.Fatal(err)
			}
			private, _, err := st.CreateChannel(ctx, store.CreateChannelInput{WorkspaceID: guestWS.ID, UserID: owner.ID, Name: "snapshot-private", Kind: "private"})
			if err != nil {
				t.Fatal(err)
			}
			guestBot, guestToken, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: guestWS.ID, OwnerUserID: owner.ID, CreatedBy: owner.ID, DisplayName: "Guest Snapshot Bot", Scopes: []string{"bot:write", store.AgentActivityWriteScope}})
			if err != nil {
				t.Fatal(err)
			}
			if err := st.AddWorkspaceMember(ctx, guestWS.ID, guestBot.ID, "bot"); err != nil {
				t.Fatal(err)
			}
			guestChannels, err := st.ListChannels(ctx, guestWS.ID, guest.ID)
			if err != nil || len(guestChannels) != 1 {
				t.Fatalf("guest channels: %#v %v", guestChannels, err)
			}
			guestConn := dialRealtimeAsUser(t, server.URL, guestWS.ID, guest.ID)
			defer func() { _ = guestConn.Close(websocket.StatusNormalClosure, "done") }()
			time.Sleep(100 * time.Millisecond)
			body["workspace_id"] = guestWS.ID
			delete(body, "direct_conversation_id")
			body["channel_id"] = private.ID
			expectStatusWithBearer(t, guestToken.Token, http.MethodPost, endpoint, strings.NewReader(encode()), http.StatusOK)
			expectStatusAsUser(t, guest.ID, http.MethodGet, server.URL+"/api/channels/"+private.ID+"/workflow-runs", nil, http.StatusForbidden)
			expectStatusAsUser(t, outsider.ID, http.MethodGet, server.URL+"/api/channels/"+private.ID+"/workflow-runs", nil, http.StatusBadRequest)
			body["channel_id"] = guestChannels[0].ID
			expectStatusWithBearer(t, guestToken.Token, http.MethodPost, endpoint, strings.NewReader(encode()), http.StatusOK)
			expectStatusAsUser(t, guest.ID, http.MethodGet, server.URL+"/api/channels/"+guestChannels[0].ID+"/workflow-runs", nil, http.StatusOK)
			if event := readEventType(t, guestConn, "workflow.snapshot"); event.ChannelID != guestChannels[0].ID {
				t.Fatalf("guest received inaccessible private snapshot before sentinel: %#v", event)
			}
			// The original workspace viewer must not receive either guest-workspace frame.
			body["workspace_id"] = ws.ID
			body["channel_id"] = ch.ID
			snapshot.Source.Revision = 4
			body["snapshot"] = snapshot
			expectStatusWithBearer(t, token.Token, http.MethodPost, endpoint, strings.NewReader(encode()), http.StatusOK)
			if event := readEventType(t, viewerConn, "workflow.snapshot"); event.ChannelID != ch.ID {
				t.Fatalf("cross-workspace snapshot leaked: %#v", event)
			}
			delete(body, "channel_id")
			expectStatusWithBearer(t, token.Token, http.MethodPost, endpoint, strings.NewReader(encode()), http.StatusBadRequest)
		})
	}
}
