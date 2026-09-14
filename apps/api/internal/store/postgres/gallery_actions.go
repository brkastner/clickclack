package postgres

import (
	"context"
	"encoding/json"
	"github.com/openclaw/clickclack/apps/api/internal/store"
	"github.com/openclaw/clickclack/apps/api/internal/store/postgres/storedb"
)

func (s *Store) PutGalleryCapability(ctx context.Context, c store.GalleryCapability) error {
	b, e := json.Marshal(c.Descriptors)
	if e != nil {
		return e
	}
	return s.q.PutGalleryCapability(ctx, storedb.PutGalleryCapabilityParams{InstallationID: c.InstallationID, WorkspaceID: c.WorkspaceID, TokenID: c.TokenID, Generation: c.Generation, DescriptorsJson: string(b)})
}
func (s *Store) ListGalleryCapabilities(ctx context.Context, w string) ([]store.GalleryCapability, error) {
	rows, e := s.q.ListGalleryCapabilities(ctx, w)
	if e != nil {
		return nil, e
	}
	out := []store.GalleryCapability{}
	for _, r := range rows {
		c := store.GalleryCapability{InstallationID: r.InstallationID, WorkspaceID: r.WorkspaceID, TokenID: r.TokenID, Generation: r.Generation}
		if e = json.Unmarshal([]byte(r.DescriptorsJson), &c.Descriptors); e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	return out, nil
}
func (s *Store) GetGallerySession(ctx context.Context, id string) (store.GallerySession, error) {
	r, e := s.q.GetGallerySession(ctx, id)
	if e != nil {
		return store.GallerySession{}, e
	}
	var v store.GallerySession
	e = json.Unmarshal([]byte(r.DataJson), &v)
	v.Version = r.Version
	return v, e
}
func (s *Store) GetGalleryRequest(ctx context.Context, id string) (store.GalleryRequest, error) {
	r, e := s.q.GetGalleryRequest(ctx, id)
	if e != nil {
		return store.GalleryRequest{}, e
	}
	var v store.GalleryRequest
	e = json.Unmarshal([]byte(r.DataJson), &v)
	v.Digest = r.Digest
	v.Envelope = json.RawMessage(r.EnvelopeJson)
	return v, e
}
func (s *Store) SaveGallery(ctx context.Context, v store.GallerySession, r *store.GalleryRequest, create bool) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	q := s.q.WithTx(tx)
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	if create {
		e = q.CreateGallerySession(ctx, storedb.CreateGallerySessionParams{ID: v.ID, DataJson: string(b), RetainUntil: v.ExpiresAt + store.GalleryRetentionSeconds})
	} else {
		var n int64
		n, e = q.UpdateGallerySession(ctx, storedb.UpdateGallerySessionParams{ID: v.ID, Version: v.Version, DataJson: string(b)})
		if e == nil && n != 1 {
			return store.ErrGalleryConflict
		}
	}
	if e != nil {
		return e
	}
	if r != nil {
		b, e = json.Marshal(r)
		if e != nil {
			return e
		}
		e = q.CreateGalleryRequest(ctx, storedb.CreateGalleryRequestParams{ID: r.ID, SessionID: v.ID, Kind: r.Kind, Digest: r.Digest, EnvelopeJson: string(r.Envelope), DataJson: string(b)})
		if e != nil {
			return e
		}
		if e = q.EnqueueGalleryRequest(ctx, storedb.EnqueueGalleryRequestParams{RequestID: r.ID, DueAt: 0}); e != nil {
			return e
		}
	}
	return tx.Commit()
}
func (s *Store) CompleteGallery(ctx context.Context, v store.GallerySession, r store.GalleryRequest) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	q := s.q.WithTx(tx)
	current, e := q.GetGalleryRequest(ctx, r.ID)
	if e != nil {
		return e
	}
	var prior store.GalleryRequest
	if e = json.Unmarshal([]byte(current.DataJson), &prior); e != nil {
		return e
	}
	if prior.State != "pending" && prior.State != "uncertain" {
		return store.ErrGalleryConflict
	}

	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	n, e := q.UpdateGallerySession(ctx, storedb.UpdateGallerySessionParams{ID: v.ID, Version: v.Version, DataJson: string(b)})
	if e != nil {
		return e
	}
	if n != 1 {
		return store.ErrGalleryConflict
	}
	b, e = json.Marshal(r)
	if e != nil {
		return e
	}
	if e = q.UpdateGalleryRequest(ctx, storedb.UpdateGalleryRequestParams{ID: r.ID, DataJson: string(b)}); e != nil {
		return e
	}
	if e = q.FinishGalleryRequest(ctx, r.ID); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) ListDueGalleryRequests(ctx context.Context, at int64) ([]store.GalleryOutbox, error) {
	rows, e := s.q.ListDueGalleryRequests(ctx, at)
	if e != nil {
		return nil, e
	}
	out := []store.GalleryOutbox{}
	for _, r := range rows {
		out = append(out, store.GalleryOutbox{RequestID: r.RequestID, DueAt: r.DueAt, Attempts: r.Attempts})
	}
	return out, nil
}
func (s *Store) ClaimGalleryRequest(ctx context.Context, id string, at, next int64) (bool, error) {
	n, e := s.q.ClaimGalleryRequest(ctx, storedb.ClaimGalleryRequestParams{RequestID: id, NowAt: at, NextDue: next})
	return n == 1, e
}
func (s *Store) FinishGalleryRequest(ctx context.Context, id string) error {
	return s.q.FinishGalleryRequest(ctx, id)
}
func (s *Store) MarkGalleryUncertain(ctx context.Context, v store.GallerySession, r store.GalleryRequest) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	q := s.q.WithTx(tx)
	current, e := q.GetGalleryRequest(ctx, r.ID)
	if e != nil {
		return e
	}
	var prior store.GalleryRequest
	if e = json.Unmarshal([]byte(current.DataJson), &prior); e != nil {
		return e
	}
	if prior.State != "pending" && prior.State != "uncertain" {
		return store.ErrGalleryConflict
	}

	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	n, e := q.UpdateGallerySession(ctx, storedb.UpdateGallerySessionParams{ID: v.ID, Version: v.Version, DataJson: string(b)})
	if e != nil {
		return e
	}
	if n != 1 {
		return store.ErrGalleryConflict
	}
	b, e = json.Marshal(r)
	if e != nil {
		return e
	}
	if e = q.UpdateGalleryRequest(ctx, storedb.UpdateGalleryRequestParams{ID: r.ID, DataJson: string(b)}); e != nil {
		return e
	}
	return tx.Commit()
}

func (s *Store) AuthorizeGalleryActor(ctx context.Context, w, id, channelID string) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if e = requireMembershipTx(ctx, tx, w, id); e != nil {
		return e
	}
	if channelID != "" {
		return requireCanPostTx(ctx, tx, w, channelID, id)
	}
	return requireNoModerationBlockTx(ctx, tx, w, id)
}

func (s *Store) CleanupGallerySessions(ctx context.Context, at int64) (int64, error) {
	return s.q.CleanupGallerySessions(ctx, at)
}
