package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestChannelNotificationSettingsHTTP(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	st := newEmptyHTTPStore(t)
	owner, err := st.EnsureBootstrap(ctx, "Owner", "channel-notifications@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channels, err := st.ListChannels(ctx, workspaces[0].ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(New(st, realtime.NewHub(), Options{}).Handler())
	t.Cleanup(server.Close)
	endpoint := server.URL + "/api/channels/" + channels[0].ID + "/notification-settings"

	initial := getJSON[map[string]string](t, endpoint)
	if initial["preference"] != store.ChannelNotifyAll {
		t.Fatalf("expected all as the default preference, got %#v", initial)
	}
	updated := patchJSON[map[string]string](t, endpoint, map[string]string{"preference": store.ChannelNotifyMentions})
	if updated["preference"] != store.ChannelNotifyMentions {
		t.Fatalf("expected mentions preference, got %#v", updated)
	}
	loaded := getJSON[map[string]string](t, endpoint)
	if loaded["preference"] != store.ChannelNotifyMentions {
		t.Fatalf("expected persisted mentions preference, got %#v", loaded)
	}
	expectStatus(t, http.MethodPatch, endpoint, strings.NewReader(`{"preference":"invalid"}`), http.StatusBadRequest)
	expectStatus(t, http.MethodPatch, endpoint, strings.NewReader(`{"preference":`), http.StatusBadRequest)
}
