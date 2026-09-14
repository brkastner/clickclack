package postgres

import (
	"context"
	"github.com/openclaw/clickclack/apps/api/internal/store/storetest"
	"testing"
)

func TestGalleryRecords(t *testing.T) {
	st := newIsolatedPostgresTestStore(t)
	if e := st.Migrate(context.Background()); e != nil {
		t.Fatal(e)
	}
	storetest.GalleryRecords(t, st)
}

func TestGalleryRetention(t *testing.T) {
	st := newIsolatedPostgresTestStore(t)
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	storetest.GalleryRetention(t, st)
}
