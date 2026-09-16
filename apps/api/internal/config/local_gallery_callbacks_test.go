package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeLocalGalleryCallbacksAcceptsOnlyDistinctCanonicalRoutes(t *testing.T) {
	callbacks, err := NormalizeLocalGalleryCallbacks([]LocalGalleryCallback{
		{InstallationID: " ins_vai ", CallbackURL: "http://127.0.0.1:8791/gallery-actions"},
		{InstallationID: "ins_other", CallbackURL: "http://127.0.0.1:8792/gallery-actions"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if callbacks[0].InstallationID != "ins_vai" || callbacks[0].CallbackURL != "http://127.0.0.1:8791/gallery-actions" {
		t.Fatalf("unexpected normalized callback: %#v", callbacks[0])
	}
}

func TestNormalizeLocalGalleryCallbacksFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		name      string
		callbacks []LocalGalleryCallback
	}{
		{"missing installation", []LocalGalleryCallback{{CallbackURL: "http://127.0.0.1:8791/gallery-actions"}}},
		{"dns", []LocalGalleryCallback{{InstallationID: "ins", CallbackURL: "http://localhost:8791/gallery-actions"}}},
		{"ipv6", []LocalGalleryCallback{{InstallationID: "ins", CallbackURL: "http://[::1]:8791/gallery-actions"}}},
		{"https", []LocalGalleryCallback{{InstallationID: "ins", CallbackURL: "https://127.0.0.1:8791/gallery-actions"}}},
		{"no port", []LocalGalleryCallback{{InstallationID: "ins", CallbackURL: "http://127.0.0.1/gallery-actions"}}},
		{"leading zero port", []LocalGalleryCallback{{InstallationID: "ins", CallbackURL: "http://127.0.0.1:08791/gallery-actions"}}},
		{"other path", []LocalGalleryCallback{{InstallationID: "ins", CallbackURL: "http://127.0.0.1:8791/callback"}}},
		{"query", []LocalGalleryCallback{{InstallationID: "ins", CallbackURL: "http://127.0.0.1:8791/gallery-actions?x=1"}}},
		{"fragment", []LocalGalleryCallback{{InstallationID: "ins", CallbackURL: "http://127.0.0.1:8791/gallery-actions#x"}}},
		{"userinfo", []LocalGalleryCallback{{InstallationID: "ins", CallbackURL: "http://user@127.0.0.1:8791/gallery-actions"}}},
		{"duplicate installation", []LocalGalleryCallback{{InstallationID: "ins", CallbackURL: "http://127.0.0.1:8791/gallery-actions"}, {InstallationID: "ins", CallbackURL: "http://127.0.0.1:8792/gallery-actions"}}},
		{"duplicate url", []LocalGalleryCallback{{InstallationID: "one", CallbackURL: "http://127.0.0.1:8791/gallery-actions"}, {InstallationID: "two", CallbackURL: "http://127.0.0.1:8791/gallery-actions"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NormalizeLocalGalleryCallbacks(tc.callbacks); err == nil {
				t.Fatal("expected rejection")
			}
		})
	}
}

func TestLoadAndValidateLocalGalleryCallbacks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server.json")
	if err := os.WriteFile(path, []byte(`{"local_gallery_callbacks":[{"installation_id":"ins_vai","callback_url":"http://127.0.0.1:8791/gallery-actions"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = cfg.ValidateServe(); err != nil {
		t.Fatal(err)
	}
	if len(cfg.LocalGalleryCallbacks) != 1 || cfg.LocalGalleryCallbacks[0].InstallationID != "ins_vai" {
		t.Fatalf("local callback was not loaded: %#v", cfg.LocalGalleryCallbacks)
	}
}

func TestValidateServeNormalizesLocalGalleryCallbacks(t *testing.T) {
	cfg := Defaults()
	cfg.LocalGalleryCallbacks = []LocalGalleryCallback{{InstallationID: " ins_vai ", CallbackURL: "http://127.0.0.1:8791/gallery-actions"}}
	if err := cfg.ValidateServe(); err != nil {
		t.Fatal(err)
	}
	if got := cfg.LocalGalleryCallbacks[0]; got.InstallationID != "ins_vai" || got.CallbackURL != "http://127.0.0.1:8791/gallery-actions" {
		t.Fatalf("unexpected callback: %#v", got)
	}
}
