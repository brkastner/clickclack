package httpapi

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

// The current store rotates rather than edits token scopes. Model a live
// authority refresh here so future mutable scopes cannot bypass watch checks.
type notepadNarrowedScopes struct{ store.Store }

func (s notepadNarrowedScopes) GetBotTokenAuth(ctx context.Context, token string) (store.BotTokenAuth, error) {
	auth, err := s.Store.GetBotTokenAuth(ctx, token)
	auth.Scopes = []string{"messages:read"}
	return auth, err
}
func TestNotepadWatchRevalidatesRealtimeScope(t *testing.T) {
	st := workflowAPIStore(t, "sqlite")
	ctx := context.Background()
	owner, err := st.EnsureBootstrap(ctx, "Owner", "notepad-scopes@example.test")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, _ := st.ListWorkspaces(ctx, owner.ID)
	ws := workspaces[0]
	channels, _ := st.ListChannels(ctx, ws.ID, owner.ID)
	bot, token, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: ws.ID, OwnerUserID: owner.ID, CreatedBy: owner.ID, DisplayName: "Notepad", Scopes: []string{"messages:read", "realtime:read"}})
	if err != nil {
		t.Fatal(err)
	}
	if err = st.AddWorkspaceMember(ctx, ws.ID, bot.ID, "bot"); err != nil {
		t.Fatal(err)
	}
	s := New(notepadNarrowedScopes{st}, realtime.NewHub(), Options{})
	r := httptest.NewRequest("GET", "/api/channels/"+channels[0].ID+"/notepad/watch", nil)
	r.Header.Set("Authorization", "Bearer "+token.Token)
	routing := chi.NewRouteContext()
	routing.URLParams.Add("channel_id", channels[0].ID)
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, routing))
	act := actor{user: bot, botTokenID: token.ID, workspaceID: ws.ID, scopes: []string{"messages:read", "realtime:read"}}
	if _, err = s.notepadAccess(r, act); err == nil {
		t.Fatal("remembered realtime scope authorized watch")
	}
	r.URL.Path = "/api/channels/" + channels[0].ID + "/notepad"
	if _, err = s.notepadAccess(r, act); err != nil {
		t.Fatalf("ordinary read was incorrectly denied: %v", err)
	}
}
