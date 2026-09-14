package storetest

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/openclaw/clickclack/apps/api/internal/galleryactions"
	"github.com/openclaw/clickclack/apps/api/internal/store"
	"sync"
	"testing"
)

// GalleryRecords is the shared SQLite/Postgres transaction acceptance suite.
func GalleryRecords(t *testing.T, st store.Store) {
	t.Helper()
	ctx := context.Background()
	v := store.GallerySession{ID: "gallery-store-session", ActorID: "actor", Generation: "generation", RequestCount: 1, Descriptor: galleryactions.Descriptor{Version: 1, ID: "synthetic.action", Label: "Action", SchemaRevision: 1, AcceptedMediaTypes: []string{"image/png"}, Fields: []galleryactions.Field{}}}
	r := store.GalleryRequest{ID: "gallery-store-open", SessionID: v.ID, Kind: "open", Digest: "digest", Payload: []byte(`{}`), State: "pending", SubscriptionID: "subscription"}
	if err := st.SaveGallery(ctx, v, &r, true); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetGallerySession(ctx, v.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Generation != v.Generation || got.RequestCount != 1 || got.Version != 1 {
		t.Fatalf("lost session binding: %+v", got)
	}
	request, err := st.GetGalleryRequest(ctx, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if request.Digest != r.Digest || request.SubscriptionID != r.SubscriptionID {
		t.Fatal("lost request binding")
	}
	due, err := st.ListDueGalleryRequests(ctx, 0)
	if err != nil || len(due) != 1 {
		t.Fatalf("atomic outbox: %v %v", due, err)
	}
	var wg sync.WaitGroup
	wins := make(chan bool, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, e := st.ClaimGalleryRequest(ctx, r.ID, 0, 30)
			if e != nil {
				t.Error(e)
			}
			wins <- ok
		}()
	}
	wg.Wait()
	close(wins)
	n := 0
	for win := range wins {
		if win {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("lease winners %d", n)
	}
	stale := got
	got.RequestCount++
	if err = st.SaveGallery(ctx, got, nil, false); err != nil {
		t.Fatal(err)
	}
	next := r
	next.ID = "must-rollback"
	next.Kind = "submit"
	if err = st.SaveGallery(ctx, stale, &next, false); !errors.Is(err, store.ErrGalleryConflict) {
		t.Fatal("stale write", err)
	}
	if _, err = st.GetGalleryRequest(ctx, next.ID); err == nil {
		t.Fatal("request survived rolled back transaction")
	}
	got, err = st.GetGallerySession(ctx, v.ID)
	if err != nil {
		t.Fatal(err)
	}
	r.State = "accepted"
	r.Response = []byte(`{"state":"accepted"}`)
	if err = st.CompleteGallery(ctx, got, r); err != nil {
		t.Fatal(err)
	}
	due, err = st.ListDueGalleryRequests(ctx, 100)
	if err != nil || len(due) != 0 {
		t.Fatal("completed delivery retained", err)
	}
	got, err = st.GetGallerySession(ctx, v.ID)
	if err != nil {
		t.Fatal(err)
	}
	r.State = "uncertain"
	if err = st.MarkGalleryUncertain(ctx, got, r); !errors.Is(err, store.ErrGalleryConflict) {
		t.Fatal("terminal outcome overwritten", err)
	}
}

// GalleryRetention proves bounded indexed cleanup and FK cascades on both stores.
func GalleryRetention(t *testing.T, st store.Store) {
	ctx := context.Background()
	for i := 0; i < 34; i++ {
		v := store.GallerySession{ID: fmt.Sprintf("retention-%02d", i), ExpiresAt: 100, Descriptor: galleryactions.Descriptor{Version: 1, ID: "retention.action", Label: "Action", SchemaRevision: 1, AcceptedMediaTypes: []string{"image/png"}, Fields: []galleryactions.Field{}}}
		if i == 33 {
			v.ExpiresAt = 101
		}
		r := store.GalleryRequest{ID: v.ID + ".open", SessionID: v.ID, Kind: "open", State: "pending", Payload: []byte(`{}`)}
		if err := st.SaveGallery(ctx, v, &r, true); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			saved, err := st.GetGallerySession(ctx, v.ID)
			if err != nil {
				t.Fatal(err)
			}
			r.State = "accepted"
			if err = st.CompleteGallery(ctx, saved, r); err != nil {
				t.Fatal(err)
			}
		}
	}
	at := int64(100) + store.GalleryRetentionSeconds
	if n, err := st.CleanupGallerySessions(ctx, at-1); err != nil || n != 0 {
		t.Fatalf("premature cleanup: %d %v", n, err)
	}
	for _, want := range []int64{32, 1, 0} {
		if n, err := st.CleanupGallerySessions(ctx, at); err != nil || n != want {
			t.Fatalf("cleanup: %d want %d: %v", n, want, err)
		}
	}
	for i := 0; i < 33; i++ {
		id := fmt.Sprintf("retention-%02d", i)
		if _, err := st.GetGallerySession(ctx, id); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("session retained: %v", err)
		}
		if _, err := st.GetGalleryRequest(ctx, id+".open"); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("request retained: %v", err)
		}
	}
	due, err := st.ListDueGalleryRequests(ctx, at)
	if err != nil || len(due) != 1 || due[0].RequestID != "retention-33.open" {
		t.Fatalf("outbox cascade: %v %v", due, err)
	}
	if _, err = st.GetGallerySession(ctx, "retention-33"); err != nil {
		t.Fatal(err)
	}
}
