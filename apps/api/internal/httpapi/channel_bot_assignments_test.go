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

func TestChannelBotAssignmentEndpointsAndHydration(t *testing.T) {
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
	owner, err := st.EnsureBootstrap(ctx, "Owner", "assignment-api-owner@example.com")
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
	member, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Member", Email: "assignment-api-member@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, workspace.ID, member.ID, store.WorkspaceRoleMember); err != nil {
		t.Fatal(err)
	}
	bot, _, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: workspace.ID, DisplayName: "Career", Handle: "career", CreatedBy: owner.ID})
	if err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(New(st, realtime.NewHub(), Options{UploadDir: filepath.Join(dataDir, "uploads")}).Handler())
	t.Cleanup(server.Close)
	endpoint := server.URL + "/api/channels/" + channel.ID + "/bot-assignments/" + bot.ID

	assigned := putJSON[struct {
		Assignment store.ChannelBotAssignment `json:"assignment"`
		Event      store.Event                `json:"event"`
	}](t, endpoint, nil)
	if assigned.Assignment.ChannelID != channel.ID || assigned.Assignment.BotUserID != bot.ID || assigned.Event.Type != "channel.bot_assignment_updated" {
		t.Fatalf("unexpected response: %#v", assigned)
	}
	listed := getJSON[struct {
		Channels []store.Channel `json:"channels"`
	}](t, server.URL+"/api/workspaces/"+workspace.ID+"/channels")
	if len(listed.Channels[0].BotAssignments) != 1 {
		t.Fatalf("assignment not hydrated: %#v", listed.Channels[0])
	}
	expectStatusAsUser(t, member.ID, http.MethodDelete, endpoint, nil, http.StatusForbidden)
	deleteJSONBody[struct {
		Event store.Event `json:"event"`
	}](t, endpoint)
	listed = getJSON[struct {
		Channels []store.Channel `json:"channels"`
	}](t, server.URL+"/api/workspaces/"+workspace.ID+"/channels")
	if len(listed.Channels[0].BotAssignments) != 0 {
		t.Fatalf("assignment not deleted: %#v", listed.Channels[0].BotAssignments)
	}
}
