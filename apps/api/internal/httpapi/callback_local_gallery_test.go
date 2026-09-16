package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/config"
	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestLocalGalleryCallbackDeliversOnlyExactConfiguredGalleryRoute(t *testing.T) {
	var requests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/gallery-actions" {
			t.Errorf("path = %q", r.URL.Path)
		}
		requests.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(target.Close)
	callbackURL := target.URL + "/gallery-actions"
	server := New(nil, realtime.NewHub(), Options{LocalGalleryCallbacks: []config.LocalGalleryCallback{{InstallationID: "ins_vai", CallbackURL: callbackURL}}})
	subscription := store.EventSubscription{AppInstallationID: "ins_vai", CallbackURL: callbackURL, SigningSecret: "secret"}
	if _, _, err := server.postEventCallback(context.Background(), subscription, store.Event{ID: "open", Type: "gallery_action.open"}, []byte(`{}`)); err != nil {
		t.Fatalf("configured gallery callback failed: %v", err)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("requests = %d, want 1", got)
	}
}

func TestLocalGalleryCallbackDoesNotWidenOtherDelivery(t *testing.T) {
	var requests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(target.Close)
	callbackURL := target.URL + "/gallery-actions"
	server := New(nil, realtime.NewHub(), Options{LocalGalleryCallbacks: []config.LocalGalleryCallback{{InstallationID: "ins_vai", CallbackURL: callbackURL}}})
	configured := store.EventSubscription{AppInstallationID: "ins_vai", CallbackURL: callbackURL, SigningSecret: "secret"}
	cases := []struct {
		name  string
		sub   store.EventSubscription
		event store.Event
	}{
		{"generic event on mixed subscription", configured, store.Event{ID: "generic", Type: "message.created"}},
		{"wrong gallery installation", store.EventSubscription{AppInstallationID: "ins_other", CallbackURL: callbackURL, SigningSecret: "secret"}, store.Event{ID: "other", Type: "gallery_action.open"}},
		{"wrong local path", store.EventSubscription{AppInstallationID: "ins_vai", CallbackURL: strings.TrimSuffix(callbackURL, "/gallery-actions") + "/other", SigningSecret: "secret"}, store.Event{ID: "path", Type: "gallery_action.open"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := server.postEventCallback(context.Background(), tc.sub, tc.event, []byte(`{}`)); err == nil {
				t.Fatal("unexpected loopback delivery")
			}
		})
	}
	if _, _, err := server.postSlashCallback(context.Background(), store.SlashCommand{CallbackURL: callbackURL, SigningSecret: "secret"}, []byte(`{}`)); err == nil {
		t.Fatal("slash callback reached local gallery endpoint")
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("requests = %d, want 0", got)
	}
}

func TestLocalGalleryClientDeniesProxyAndRetainsThreeSecondTimeout(t *testing.T) {
	client := newLocalGalleryCallbackHTTPClient(map[string]string{"ins_vai": "http://127.0.0.1:8791/gallery-actions"})
	if client.Timeout != callbackTimeout {
		t.Fatalf("timeout = %v, want %v", client.Timeout, callbackTimeout)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok || transport.Proxy != nil {
		t.Fatal("local gallery client inherits proxy configuration")
	}
	if client.CheckRedirect == nil || client.CheckRedirect(&http.Request{}, nil) != http.ErrUseLastResponse {
		t.Fatal("local gallery client permits redirects")
	}
}

func TestLocalGalleryCallbackDoesNotFollowRedirects(t *testing.T) {
	var targetRequests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { targetRequests.Add(1) }))
	t.Cleanup(target.Close)
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	t.Cleanup(redirect.Close)
	callbackURL := redirect.URL + "/gallery-actions"
	server := New(nil, realtime.NewHub(), Options{LocalGalleryCallbacks: []config.LocalGalleryCallback{{InstallationID: "ins_vai", CallbackURL: callbackURL}}})
	_, _, err := server.postEventCallback(context.Background(), store.EventSubscription{AppInstallationID: "ins_vai", CallbackURL: callbackURL, SigningSecret: "secret"}, store.Event{ID: "open", Type: "gallery_action.open"}, []byte(`{}`))
	if err == nil {
		t.Fatal("redirect response was accepted")
	}
	if targetRequests.Load() != 0 {
		t.Fatal("local gallery callback followed redirect")
	}
}
