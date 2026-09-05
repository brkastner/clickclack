package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func TestAvatarPacks(t *testing.T) {
	root := t.TempDir()
	pack := "a + # ü %20"
	if err := os.Mkdir(filepath.Join(root, pack), 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"z.PNG", "a b.webp", "no.svg", "bad..png"} {
		if err := os.WriteFile(filepath.Join(root, pack, name), []byte("image"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	outside := filepath.Join(t.TempDir(), "secret.png")
	if err := os.WriteFile(outside, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, pack, "escape.png")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Dir(outside), filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	st := newEmptyHTTPStore(t)
	if _, err := st.EnsureBootstrap(context.Background(), "Owner", "owner@example.com"); err != nil {
		t.Fatal(err)
	}
	s := New(st, realtime.NewHub(), Options{AvatarPacksDir: root})
	server := httptest.NewServer(s.Handler())
	defer server.Close()
	listing := getJSON[struct {
		Packs     []string
		Directory string
	}](t, server.URL+"/api/avatar-packs")
	if !reflect.DeepEqual(listing.Packs, []string{pack}) || listing.Directory != root {
		t.Fatalf("listing: %+v", listing)
	}
	path := "/api/avatar-packs/" + url.PathEscape(pack)
	files := getJSON[struct{ Files []string }](t, server.URL+path).Files
	want := []string{path + "/a%20b.webp", path + "/z.PNG"}
	if !reflect.DeepEqual(files, want) {
		t.Fatalf("files %v want %v", files, want)
	}
	for _, file := range files {
		resp, err := http.Get(server.URL + file)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 200 || resp.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("image response %+v", resp)
		}
		if got := resp.Header.Get("Content-Type"); got != "image/png" && got != "image/webp" {
			t.Fatal(got)
		}
	}
	for _, path := range []string{"/missing", "/escape"} {
		got := getJSON[struct{ Files []string }](t, server.URL+"/api/avatar-packs"+path)
		if len(got.Files) != 0 {
			t.Fatalf("unexpected files %v", got.Files)
		}
	}
	for _, path := range []string{path + "/escape.png", path + "/no.svg", path + "/bad..png", "/api/avatar-packs/%2e%2e", "/api/avatar-packs/a%2Fb", "/api/avatar-packs/a%5Cb", "/api/avatar-packs/a%00b", path + "/%2e%2e%2fsecret.png", "/api/avatar-packs/escape/secret.png"} {
		t.Run(path, func(t *testing.T) {
			resp, err := http.Get(server.URL + path)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != 404 {
				t.Fatalf("status %d", resp.StatusCode)
			}
		})
	}
	s.avatarPacksDir = filepath.Join(root, "missing")
	if got := getJSON[struct{ Packs []string }](t, server.URL+"/api/avatar-packs"); len(got.Packs) != 0 {
		t.Fatal(got)
	}
	s.avatarPacksDir = outside // A non-directory is unreadable as a pack root.
	if got := getJSON[struct{ Packs []string }](t, server.URL+"/api/avatar-packs"); len(got.Packs) != 0 {
		t.Fatal(got)
	}
}

func TestAvatarPackFileLimit(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "pack"), 0700); err != nil {
		t.Fatal(err)
	}
	for i := 1001; i >= 0; i-- {
		if err := os.WriteFile(filepath.Join(root, "pack", fmt.Sprintf("%04d.avif", i)), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	s := &Server{avatarPacksDir: root}
	files := s.avatarFiles("pack")
	if len(files) != 1000 || files[0] != "/api/avatar-packs/pack/0000.avif" || files[999] != "/api/avatar-packs/pack/0999.avif" {
		t.Fatalf("unexpected bounded listing: %d", len(files))
	}
}

func TestAvatarNames(t *testing.T) {
	for _, name := range []string{"", "..", "a..b", "a/b", "a\\b", "a\x00b", " padded "} {
		if validAvatarPack(name) {
			t.Errorf("accepted %q", name)
		}
	}
	for name, want := range map[string]string{"x.png": "image/png", "x.JPG": "image/jpeg", "x.jpeg": "image/jpeg", "x.gif": "image/gif", "x.webp": "image/webp", "x.avif": "image/avif", "x.svg": ""} {
		if got := avatarContentType(name); got != want {
			t.Errorf("%s: %s", name, got)
		}
	}
}

func TestAvatarPacksBotTokenScope(t *testing.T) {
	st := newEmptyHTTPStore(t)
	ctx := context.Background()
	owner, err := st.EnsureBootstrap(ctx, "Owner", "avatar-scope@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(New(st, realtime.NewHub(), Options{AvatarPacksDir: t.TempDir()}).Handler())
	defer server.Close()
	for _, scope := range []string{"messages:read", "profile:read"} {
		_, token, err := st.CreateBot(ctx, store.CreateBotInput{WorkspaceID: workspaces[0].ID, OwnerUserID: owner.ID, DisplayName: scope, Scopes: []string{scope}, CreatedBy: owner.ID})
		if err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{"/api/avatar-packs", "/api/avatar-packs/missing", "/api/avatar-packs/missing/image.png"} {
			want := http.StatusForbidden
			if scope == "messages:read" {
				want = http.StatusOK
				if strings.HasSuffix(path, ".png") {
					want = http.StatusNotFound
				}
			}
			expectStatusWithBearer(t, token.Token, http.MethodGet, server.URL+path, nil, want)
		}
	}
}

func TestAvatarPacksUnreadableRoot(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root bypasses filesystem permission checks")
	}
	root := t.TempDir()
	if err := os.Chmod(root, 0); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.Chmod(root, 0700); err != nil {
			t.Error(err)
		}
	}()
	st := newEmptyHTTPStore(t)
	if _, err := st.EnsureBootstrap(context.Background(), "Owner", "avatar-unreadable@example.com"); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(New(st, realtime.NewHub(), Options{AvatarPacksDir: root}).Handler())
	defer server.Close()
	if got := getJSON[struct{ Packs []string }](t, server.URL+"/api/avatar-packs"); len(got.Packs) != 0 {
		t.Fatal(got)
	}
	if got := getJSON[struct{ Files []string }](t, server.URL+"/api/avatar-packs/pack"); len(got.Files) != 0 {
		t.Fatal(got)
	}
}
