package sqlite

import (
	"context"
	"github.com/openclaw/clickclack/apps/api/internal/store/storetest"
	"path/filepath"
	"testing"
)

func TestGalleryRecords(t *testing.T) { storetest.GalleryRecords(t, newTestStore(t)) }
func TestGalleryRecordsSurviveReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gallery.db")
	st, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	if e = st.Migrate(context.Background()); e != nil {
		t.Fatal(e)
	}
	storetest.GalleryRecords(t, st)
	if e = st.Close(); e != nil {
		t.Fatal(e)
	}
	st, e = Open(path)
	if e != nil {
		t.Fatal(e)
	}
	defer st.Close()
	v, e := st.GetGallerySession(context.Background(), "gallery-store-session")
	if e != nil {
		t.Fatal(e)
	}
	if v.Generation != "generation" || v.RequestCount != 2 {
		t.Fatal("session binding lost on reopen")
	}
	r, e := st.GetGalleryRequest(context.Background(), "gallery-store-open")
	if e != nil || r.State != "accepted" {
		t.Fatalf("outcome lost on reopen: %+v %v", r, e)
	}
}

func TestGalleryRetention(t *testing.T) {
	st := newTestStore(t)
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	storetest.GalleryRetention(t, st)
}
