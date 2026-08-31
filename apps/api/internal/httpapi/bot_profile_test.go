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

type botProfileFixture struct {
	store      *sqlitestore.Store
	server     *httptest.Server
	workspace  store.Workspace
	owner      store.User
	moderator  store.User
	member     store.User
	serviceBot store.User
	botToken   store.BotToken
}

func newBotProfileFixture(t *testing.T) botProfileFixture {
	t.Helper()
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

	moderator, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Moderator", Email: "mod@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, workspace.ID, moderator.ID, store.WorkspaceRoleModerator); err != nil {
		t.Fatal(err)
	}
	member, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Member", Email: "member@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, workspace.ID, member.ID, store.WorkspaceRoleMember); err != nil {
		t.Fatal(err)
	}

	serviceBot, botToken, err := st.CreateBot(ctx, store.CreateBotInput{
		WorkspaceID: workspace.ID,
		DisplayName: "Kai",
		Handle:      "kai",
		TokenName:   "test",
		Scopes:      []string{"bot:write"},
		CreatedBy:   owner.ID,
	})
	if err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(New(st, realtime.NewHub(), Options{UploadDir: filepath.Join(dataDir, "uploads")}).Handler())
	t.Cleanup(server.Close)

	return botProfileFixture{
		store:      st,
		server:     server,
		workspace:  workspace,
		owner:      owner,
		moderator:  moderator,
		member:     member,
		serviceBot: serviceBot,
		botToken:   botToken,
	}
}

func TestUpdateServiceBotProfileAsManager(t *testing.T) {
	t.Parallel()
	fixture := newBotProfileFixture(t)
	endpoint := fixture.server.URL + "/api/bots/" + fixture.serviceBot.ID

	updated := patchJSONAsUser[struct {
		Bot store.User `json:"bot"`
	}](t, fixture.owner.ID, endpoint, map[string]string{
		"display_name": "  рекрутер  ",
		"avatar_url":   "https://example.com/kai.webp",
	})
	if updated.Bot.DisplayName != "рекрутер" {
		t.Fatalf("display_name = %q, want %q", updated.Bot.DisplayName, "рекрутер")
	}
	if updated.Bot.AvatarURL != "https://example.com/kai.webp" {
		t.Fatalf("avatar_url = %q", updated.Bot.AvatarURL)
	}
	// An omitted field must be left alone.
	if updated.Bot.Handle != "kai" {
		t.Fatalf("handle = %q, want it unchanged", updated.Bot.Handle)
	}

	// Moderators manage bots too.
	moderated := patchJSONAsUser[struct {
		Bot store.User `json:"bot"`
	}](t, fixture.moderator.ID, endpoint, map[string]string{"handle": "@recruiter"})
	if moderated.Bot.Handle != "recruiter" {
		t.Fatalf("handle = %q, want normalized %q", moderated.Bot.Handle, "recruiter")
	}
	if moderated.Bot.DisplayName != "рекрутер" {
		t.Fatalf("display_name changed on handle-only patch: %q", moderated.Bot.DisplayName)
	}
}

func TestUpdateServiceBotProfileRejectsOrdinaryMember(t *testing.T) {
	t.Parallel()
	fixture := newBotProfileFixture(t)
	payload, err := json.Marshal(map[string]string{"display_name": "nope"})
	if err != nil {
		t.Fatal(err)
	}
	expectStatusAsUser(
		t,
		fixture.member.ID,
		http.MethodPatch,
		fixture.server.URL+"/api/bots/"+fixture.serviceBot.ID,
		bytes.NewReader(payload),
		http.StatusForbidden,
	)
}

func TestUpdateBotProfileRejectsBotToken(t *testing.T) {
	t.Parallel()
	fixture := newBotProfileFixture(t)
	payload, err := json.Marshal(map[string]string{"display_name": "self-promotion"})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(
		http.MethodPatch,
		fixture.server.URL+"/api/bots/"+fixture.serviceBot.ID,
		bytes.NewReader(payload),
	)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+fixture.botToken.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("bot token profile mutation status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}
}

func TestUpdateUserOwnedBotProfileRequiresOwner(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	fixture := newBotProfileFixture(t)

	userBot, _, err := fixture.store.CreateBot(ctx, store.CreateBotInput{
		WorkspaceID: fixture.workspace.ID,
		OwnerUserID: fixture.member.ID,
		DisplayName: "Member's Agent",
		Handle:      "member-agent",
		TokenName:   "test",
		Scopes:      []string{"bot:write"},
		CreatedBy:   fixture.member.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	endpoint := fixture.server.URL + "/api/bots/" + userBot.ID

	updated := patchJSONAsUser[struct {
		Bot store.User `json:"bot"`
	}](t, fixture.member.ID, endpoint, map[string]string{"display_name": "Renamed Agent"})
	if updated.Bot.DisplayName != "Renamed Agent" {
		t.Fatalf("owner could not rename their own bot: %#v", updated.Bot)
	}

	// A workspace owner does not outrank the bot's human owner.
	payload, err := json.Marshal(map[string]string{"display_name": "seized"})
	if err != nil {
		t.Fatal(err)
	}
	expectStatusAsUser(t, fixture.owner.ID, http.MethodPatch, endpoint, bytes.NewReader(payload), http.StatusForbidden)
}

func TestUpdateBotProfileRejectsDuplicateHandle(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	fixture := newBotProfileFixture(t)

	if _, _, err := fixture.store.CreateBot(ctx, store.CreateBotInput{
		WorkspaceID: fixture.workspace.ID,
		DisplayName: "Other",
		Handle:      "taken",
		TokenName:   "test",
		Scopes:      []string{"bot:read"},
		CreatedBy:   fixture.owner.ID,
	}); err != nil {
		t.Fatal(err)
	}

	payload, err := json.Marshal(map[string]string{"handle": "taken"})
	if err != nil {
		t.Fatal(err)
	}
	// Matches PATCH /api/me, which also reports a taken handle as a 400 through
	// the shared store-error mapping.
	expectStatusAsUser(
		t,
		fixture.owner.ID,
		http.MethodPatch,
		fixture.server.URL+"/api/bots/"+fixture.serviceBot.ID,
		bytes.NewReader(payload),
		http.StatusBadRequest,
	)
}

func TestUpdateBotProfileRejectsInvalidInput(t *testing.T) {
	t.Parallel()
	fixture := newBotProfileFixture(t)
	endpoint := fixture.server.URL + "/api/bots/" + fixture.serviceBot.ID

	for name, body := range map[string]map[string]string{
		"blank display name": {"display_name": "   "},
		"bad handle":         {"handle": "not a handle"},
		"bad avatar":         {"avatar_url": "javascript:alert(1)"},
	} {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		t.Run(name, func(t *testing.T) {
			expectStatusAsUser(t, fixture.owner.ID, http.MethodPatch, endpoint, bytes.NewReader(payload), http.StatusBadRequest)
		})
	}
}

func TestUpdateBotProfileMissingBot(t *testing.T) {
	t.Parallel()
	fixture := newBotProfileFixture(t)
	payload, err := json.Marshal(map[string]string{"display_name": "ghost"})
	if err != nil {
		t.Fatal(err)
	}
	expectStatusAsUser(
		t,
		fixture.owner.ID,
		http.MethodPatch,
		fixture.server.URL+"/api/bots/usr_missing",
		bytes.NewReader(payload),
		http.StatusNotFound,
	)
}

func patchJSONAsUser[T any](t *testing.T, userID, endpoint string, body any) T {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPatch, endpoint, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ClickClack-User", userID)
	return doJSON[T](t, req)
}
