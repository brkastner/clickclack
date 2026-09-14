package httpapi

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/openclaw/clickclack/apps/api/internal/galleryactions"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

var galleryIdentity = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,128}$`)

func galleryID() string { return fmt.Sprintf("%x", rand.Text()) }
func galleryRead(w http.ResponseWriter, r *http.Request, v any) error {
	b, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 128*1024))
	if e != nil {
		return e
	}
	return galleryactions.Decode(b, v)
}
func galleryError(w http.ResponseWriter, e error) {
	code := http.StatusBadRequest
	if errors.Is(e, store.ErrGalleryConflict) {
		code = http.StatusConflict
	}
	if errors.Is(e, sql.ErrNoRows) {
		code = http.StatusNotFound
	}
	writeError(w, code, e)
}
func (s *Server) galleryActor(w http.ResponseWriter, r *http.Request, bot bool) (actor, bool) {
	a, e := s.currentActor(r)
	if e != nil {
		writeError(w, 401, e)
		return a, false
	}
	if (a.botTokenID != "") != bot {
		writeError(w, 403, errors.New("incorrect credential kind"))
		return a, false
	}
	if bot {
		if e = a.requireScope(store.GalleryActionsWriteScope); e != nil {
			writeError(w, 403, e)
			return a, false
		}
	}
	return a, true
}
func (s *Server) setGalleryActions(w http.ResponseWriter, r *http.Request) {
	a, ok := s.galleryActor(w, r, true)
	if !ok {
		return
	}
	var b struct {
		InstallationID string                      `json:"installation_id"`
		Actions        []galleryactions.Descriptor `json:"gallery_actions"`
	}
	if e := galleryRead(w, r, &b); e != nil {
		galleryError(w, e)
		return
	}
	if e := galleryactions.ValidateDescriptors(b.Actions); e != nil {
		galleryError(w, e)
		return
	}
	apps, e := s.store.ListAppInstallations(r.Context(), a.workspaceID, a.user.ID)
	if e != nil {
		galleryError(w, e)
		return
	}
	found := false
	for _, app := range apps {
		if app.ID == b.InstallationID && app.BotUserID == a.user.ID {
			found = true
		}
	}
	if !found {
		writeError(w, 403, errors.New("installation does not belong to this bot"))
		return
	}
	// Registration may reference only media the producer can already read.
	if e = s.galleryMedia(r.Context(), a.workspaceID, a.user.ID, b.Actions); e != nil {
		writeError(w, 403, e)
		return
	}
	c := store.GalleryCapability{InstallationID: b.InstallationID, WorkspaceID: a.workspaceID, TokenID: a.botTokenID, Generation: galleryID(), Descriptors: b.Actions}
	if e = s.store.PutGalleryCapability(r.Context(), c); e != nil {
		galleryError(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"installation_id": c.InstallationID, "gallery_actions": c.Descriptors})
}
func (s *Server) galleryMedia(ctx context.Context, w, actorID string, ds []galleryactions.Descriptor) error {
	for _, d := range ds {
		for _, f := range d.Fields {
			for _, c := range f.Choices {
				if c.UploadID != "" {
					u, e := s.store.GetUpload(ctx, c.UploadID, actorID)
					if e != nil {
						return e
					}
					if u.WorkspaceID != w || !strings.HasPrefix(u.ContentType, "image/") {
						return errors.New("invalid image reference")
					}
				}
			}
		}
	}
	return nil
}
func (s *Server) galleryContext(ctx context.Context, w, actorID, source, destination, botID string) (store.Upload, error) {
	if _, e := s.store.GetWorkspace(ctx, w, actorID); e != nil {
		return store.Upload{}, e
	}
	u, e := s.store.GetUpload(ctx, source, actorID)
	if e != nil {
		return u, e
	}
	if u.WorkspaceID != w {
		return u, sql.ErrNoRows
	}
	// Both the actor and producer must already be able to read the source and
	// destination. Gallery transport never grants access to private conversations.
	if _, e = s.store.GetUpload(ctx, source, botID); e != nil {
		return u, e
	}
	for _, id := range []string{actorID, botID} {
		if e = s.store.AuthorizeGalleryActor(ctx, w, id, ""); e != nil {
			return u, e
		}
		ch, e := s.store.GetChannel(ctx, destination, id)
		if e == nil {
			if err := s.store.AuthorizeGalleryActor(ctx, w, id, ch.ID); err != nil {
				return u, err
			}
			if ch.WorkspaceID != w || ch.ArchivedAt != nil {
				return u, sql.ErrNoRows
			}
			continue
		}
		dm, e := s.store.GetDirectConversation(ctx, destination, id)
		if e != nil {
			return u, e
		}
		if dm.WorkspaceID != w || !dm.CanSend {
			return u, sql.ErrNoRows
		}
	}
	return u, nil
}
func (s *Server) galleryInstallation(ctx context.Context, w, actorID, installation string) (store.AppInstallation, store.GalleryCapability, error) {
	apps, e := s.store.ListAppInstallations(ctx, w, actorID)
	if e != nil {
		return store.AppInstallation{}, store.GalleryCapability{}, e
	}
	cs, e := s.store.ListGalleryCapabilities(ctx, w)
	if e != nil {
		return store.AppInstallation{}, store.GalleryCapability{}, e
	}
	for _, a := range apps {
		if a.ID == installation {
			for _, c := range cs {
				if c.InstallationID == a.ID {
					return a, c, nil
				}
			}
		}
	}
	return store.AppInstallation{}, store.GalleryCapability{}, sql.ErrNoRows
}
func (s *Server) gallerySubscription(ctx context.Context, w, installation, kind, id string) (store.EventSubscription, error) {
	subs, e := s.store.ListEventSubscriptionsForEvent(ctx, store.Event{ID: "gallery", Cursor: "gallery", WorkspaceID: w, Type: "gallery_action." + kind})
	if e != nil {
		return store.EventSubscription{}, e
	}
	matches := []store.EventSubscription{}
	for _, sub := range subs {
		if sub.AppInstallationID == installation && (id == "" || sub.ID == id) {
			matches = append(matches, sub)
		}
	}
	// Ambiguous routing is rejected, never fan out executable submissions.
	if len(matches) != 1 {
		return store.EventSubscription{}, errors.New("gallery action requires exactly one active installation subscription")
	}
	return matches[0], nil
}
func (s *Server) listGalleryActions(w http.ResponseWriter, r *http.Request) {
	a, ok := s.galleryActor(w, r, false)
	if !ok {
		return
	}
	workspace := chi.URLParam(r, "workspace_id")
	source := r.URL.Query().Get("source_upload_id")
	destination := r.URL.Query().Get("destination_id")
	if _, e := s.store.GetWorkspace(r.Context(), workspace, a.user.ID); e != nil {
		writeError(w, 403, e)
		return
	}
	caps, e := s.store.ListGalleryCapabilities(r.Context(), workspace)
	if e != nil {
		galleryError(w, e)
		return
	}
	out := []map[string]any{}
	for _, c := range caps {
		app, _, e := s.galleryInstallation(r.Context(), workspace, a.user.ID, c.InstallationID)
		if e != nil {
			continue
		}
		u, e := s.galleryContext(r.Context(), workspace, a.user.ID, source, destination, app.BotUserID)
		if e != nil {
			continue
		}
		if _, e = s.gallerySubscription(r.Context(), workspace, c.InstallationID, "open", ""); e != nil {
			continue
		}
		for _, d := range c.Descriptors {
			if galleryactions.ValidateDescriptors([]galleryactions.Descriptor{d}) != nil || !slices.Contains(d.AcceptedMediaTypes, u.ContentType) {
				continue
			}
			if s.galleryMedia(r.Context(), workspace, a.user.ID, []galleryactions.Descriptor{d}) != nil {
				continue
			}
			out = append(out, map[string]any{"installation_id": c.InstallationID, "descriptor": d})
		}
	}
	writeJSON(w, 200, map[string]any{"gallery_actions": out})
}
func (s *Server) galleryAuthorize(ctx context.Context, v store.GallerySession) error {
	if time.Now().Unix() >= v.ExpiresAt {
		return errors.New("gallery session expired")
	}
	app, c, e := s.galleryInstallation(ctx, v.WorkspaceID, v.ActorID, v.InstallationID)
	if e != nil {
		return e
	}
	if c.Generation != v.Generation {
		return errors.New("gallery capability revoked or changed")
	}
	u, e := s.galleryContext(ctx, v.WorkspaceID, v.ActorID, v.SourceUploadID, v.DestinationID, app.BotUserID)
	if e != nil {
		return e
	}
	if !slices.Contains(v.Descriptor.AcceptedMediaTypes, u.ContentType) {
		return errors.New("source media type changed")
	}
	for _, id := range []string{v.ActorID, app.BotUserID} {
		if e = s.galleryMedia(ctx, v.WorkspaceID, id, []galleryactions.Descriptor{v.Descriptor}); e != nil {
			return e
		}
		if v.PreviewUploadID != "" {
			u, e := s.store.GetUpload(ctx, v.PreviewUploadID, id)
			if e != nil {
				return e
			}
			if u.WorkspaceID != v.WorkspaceID || !strings.HasPrefix(u.ContentType, "image/") {
				return sql.ErrNoRows
			}
		}
	}
	return nil
}
func (s *Server) openGalleryAction(w http.ResponseWriter, r *http.Request) {
	a, ok := s.galleryActor(w, r, false)
	if !ok {
		return
	}
	var b struct {
		SessionID      string `json:"session_id"`
		InstallationID string `json:"installation_id"`
		ActionID       string `json:"action_id"`
		SourceUploadID string `json:"source_upload_id"`
		DestinationID  string `json:"destination_id"`
	}
	if e := galleryRead(w, r, &b); e != nil {
		galleryError(w, e)
		return
	}
	if !galleryIdentity.MatchString(b.SessionID) || len(b.SessionID) > 100 {
		galleryError(w, errors.New("invalid session_id"))
		return
	}
	workspace := chi.URLParam(r, "workspace_id")
	app, c, e := s.galleryInstallation(r.Context(), workspace, a.user.ID, b.InstallationID)
	if e != nil {
		writeError(w, 403, e)
		return
	}
	u, e := s.galleryContext(r.Context(), workspace, a.user.ID, b.SourceUploadID, b.DestinationID, app.BotUserID)
	if e != nil {
		writeError(w, 403, e)
		return
	}
	var d galleryactions.Descriptor
	for _, candidate := range c.Descriptors {
		if candidate.ID == b.ActionID {
			d = candidate
		}
	}
	if galleryactions.ValidateDescriptors([]galleryactions.Descriptor{d}) != nil || !slices.Contains(d.AcceptedMediaTypes, u.ContentType) {
		galleryError(w, errors.New("action unavailable"))
		return
	}
	v := store.GallerySession{ID: b.SessionID, ActorID: a.user.ID, WorkspaceID: workspace, InstallationID: c.InstallationID, SourceUploadID: b.SourceUploadID, DestinationID: b.DestinationID, Generation: c.Generation, Descriptor: d, ExpiresAt: time.Now().Add(30 * time.Minute).Unix(), RequestCount: 1}
	if e = s.galleryAuthorize(r.Context(), v); e != nil {
		writeError(w, 403, e)
		return
	}
	payload, _ := json.Marshal(b)
	req, e := s.galleryNewRequest(r.Context(), v, b.SessionID+".open", "open", payload)
	if e != nil {
		galleryError(w, e)
		return
	}
	if prior, e := s.store.GetGallerySession(r.Context(), v.ID); e == nil {
		old, e := s.store.GetGalleryRequest(r.Context(), req.ID)
		if e != nil || prior.ActorID != a.user.ID || old.Digest != req.Digest {
			galleryError(w, store.ErrGalleryConflict)
			return
		}
		if e = s.galleryAuthorize(r.Context(), prior); e != nil {
			writeError(w, 403, e)
			return
		}
		writeJSON(w, 200, map[string]any{"session": prior, "request": old})
		return
	}
	// Once records are cleaned, the timestamp still prevents an old open from
	// becoming a fresh execution. Legacy opaque IDs may only retry retained rows.
	issuedText, nonce, valid := strings.Cut(b.SessionID, ".")
	issued, parseErr := strconv.ParseInt(issuedText, 10, 64)
	now := time.Now().Unix()
	if !valid || len(nonce) < 16 || parseErr != nil || strconv.FormatInt(issued, 10) != issuedText || issued > now+60 || issued <= now-1800 {
		writeError(w, 410, errors.New("session_id must be a recent unix-seconds.random identity; expired identities cannot reopen"))
		return
	}
	if e = s.store.SaveGallery(r.Context(), v, &req, true); e != nil {
		galleryError(w, e)
		return
	}
	writeJSON(w, 202, map[string]any{"session": v, "request": req})
}
func (s *Server) galleryNewRequest(ctx context.Context, v store.GallerySession, id, kind string, payload []byte) (store.GalleryRequest, error) {
	sub, e := s.gallerySubscription(ctx, v.WorkspaceID, v.InstallationID, kind, "")
	if e != nil {
		return store.GalleryRequest{}, e
	}
	envelope, err := json.Marshal(map[string]any{"version": 1, "event_id": id, "type": "gallery_action." + kind, "installation_id": v.InstallationID, "action_id": v.Descriptor.ID, "actor_id": v.ActorID, "workspace_id": v.WorkspaceID, "source_upload_id": v.SourceUploadID, "destination_id": v.DestinationID, "session_id": v.ID, "request_id": id, "submission_id": v.SubmissionID, "schema_revision": v.Descriptor.SchemaRevision, "expires_at": v.ExpiresAt, "payload": json.RawMessage(payload)})
	if err != nil {
		return store.GalleryRequest{}, err
	}
	return store.GalleryRequest{ID: id, SessionID: v.ID, Kind: kind, Digest: galleryactions.SubmissionDigest(v.ID, id, string(payload)), Payload: payload, Envelope: envelope, State: "pending", SubscriptionID: sub.ID}, nil
}
func (s *Server) galleryLoad(w http.ResponseWriter, r *http.Request) (store.GallerySession, bool) {
	a, ok := s.galleryActor(w, r, false)
	if !ok {
		return store.GallerySession{}, false
	}
	v, e := s.store.GetGallerySession(r.Context(), chi.URLParam(r, "session_id"))
	if e != nil || v.ActorID != a.user.ID {
		writeError(w, 404, sql.ErrNoRows)
		return v, false
	}
	if e = s.galleryAuthorize(r.Context(), v); e != nil {
		writeError(w, 410, e)
		return v, false
	}
	return v, true
}

type galleryInput struct {
	RequestID      string         `json:"request_id"`
	SchemaRevision int            `json:"schema_revision"`
	Values         map[string]any `json:"values,omitempty"`
	FieldID        string         `json:"field_id,omitempty"`
	Offset         int            `json:"offset,omitempty"`
	Limit          int            `json:"limit,omitempty"`
}

func (s *Server) requestGalleryAction(w http.ResponseWriter, r *http.Request) {
	v, ok := s.galleryLoad(w, r)
	if !ok {
		return
	}
	kind := chi.URLParam(r, "kind")
	if kind != "submit" && kind != "choices" {
		writeError(w, 404, sql.ErrNoRows)
		return
	}
	var b galleryInput
	var decodeErr error
	if kind == "submit" {
		var input struct {
			RequestID      string         `json:"request_id"`
			SchemaRevision int            `json:"schema_revision"`
			Values         map[string]any `json:"values"`
		}
		decodeErr = galleryRead(w, r, &input)
		b = galleryInput{RequestID: input.RequestID, SchemaRevision: input.SchemaRevision, Values: input.Values}
	} else {
		var input struct {
			RequestID      string `json:"request_id"`
			SchemaRevision int    `json:"schema_revision"`
			FieldID        string `json:"field_id"`
			Offset         int    `json:"offset,omitempty"`
			Limit          int    `json:"limit"`
		}
		decodeErr = galleryRead(w, r, &input)
		b = galleryInput{RequestID: input.RequestID, SchemaRevision: input.SchemaRevision, FieldID: input.FieldID, Offset: input.Offset, Limit: input.Limit}
	}
	if decodeErr != nil {
		galleryError(w, decodeErr)
		return
	}
	if !galleryIdentity.MatchString(b.RequestID) || b.SchemaRevision != v.Descriptor.SchemaRevision {
		galleryError(w, store.ErrGalleryConflict)
		return
	}
	payload, _ := json.Marshal(b)
	digest := galleryactions.SubmissionDigest(v.ID, b.RequestID, string(payload))
	if old, e := s.store.GetGalleryRequest(r.Context(), b.RequestID); e == nil {
		if old.SessionID != v.ID || old.Kind != kind || old.Digest != digest {
			galleryError(w, store.ErrGalleryConflict)
			return
		}
		writeJSON(w, 200, map[string]any{"session": v, "request": old})
		return
	}
	if v.SubmissionID != "" || v.RequestCount >= 128 {
		galleryError(w, store.ErrGalleryConflict)
		return
	}
	opened, e := s.store.GetGalleryRequest(r.Context(), v.ID+".open")
	if e != nil || opened.State != "accepted" {
		galleryError(w, errors.New("panel open not yet accepted"))
		return
	}
	if kind == "submit" {
		if b.FieldID != "" || b.Offset != 0 || b.Limit != 0 {
			galleryError(w, errors.New("unexpected choices fields"))
			return
		}
		if e = galleryactions.ValidateValues(v.Descriptor.Fields, b.Values); e != nil {
			galleryError(w, e)
			return
		}
		v.SubmissionID = b.RequestID
	} else {
		if b.Values != nil || b.Offset < 0 || b.Offset > 10000 || b.Limit < 1 || b.Limit > 100 {
			galleryError(w, errors.New("invalid choices query"))
			return
		}
		found := false
		for _, f := range v.Descriptor.Fields {
			if f.ID == b.FieldID && f.Kind == "images" && f.Dynamic {
				found = true
			}
		}
		if !found {
			galleryError(w, errors.New("undeclared dynamic field"))
			return
		}
	}
	req, e := s.galleryNewRequest(r.Context(), v, b.RequestID, kind, payload)
	if e != nil {
		galleryError(w, e)
		return
	}
	v.RequestCount++
	if e = s.store.SaveGallery(r.Context(), v, &req, false); e != nil {
		// A concurrent identical retry resolves to the committed record.
		if old, lookup := s.store.GetGalleryRequest(r.Context(), b.RequestID); lookup == nil && old.SessionID == v.ID && old.Digest == digest && old.Kind == kind {
			writeJSON(w, 200, map[string]any{"session": v, "request": old})
			return
		}
		galleryError(w, e)
		return
	}
	writeJSON(w, 202, map[string]any{"session": v, "request": req})
}
func (s *Server) statusGalleryAction(w http.ResponseWriter, r *http.Request) {
	v, ok := s.galleryLoad(w, r)
	if !ok {
		return
	}
	id := r.URL.Query().Get("request_id")
	if id == "" {
		id = v.SubmissionID
		if id == "" {
			id = v.ID + ".open"
		}
	}
	req, e := s.store.GetGalleryRequest(r.Context(), id)
	if e != nil || req.SessionID != v.ID {
		writeError(w, 404, sql.ErrNoRows)
		return
	}
	if _, e = s.gallerySubscription(r.Context(), v.WorkspaceID, v.InstallationID, req.Kind, req.SubscriptionID); e != nil {
		writeError(w, 410, e)
		return
	}
	writeJSON(w, 200, map[string]any{"session": v, "request": req})
}

type galleryReply struct {
	SessionID       string                  `json:"session_id"`
	SchemaRevision  int                     `json:"schema_revision"`
	State           string                  `json:"state"`
	Choices         []galleryactions.Choice `json:"choices,omitempty"`
	PreviewUploadID string                  `json:"preview_upload_id,omitempty"`
}

func (s *Server) respondGalleryAction(w http.ResponseWriter, r *http.Request) {
	a, ok := s.galleryActor(w, r, true)
	if !ok {
		return
	}
	var b galleryReply
	if e := galleryRead(w, r, &b); e != nil {
		galleryError(w, e)
		return
	}
	req, e := s.store.GetGalleryRequest(r.Context(), chi.URLParam(r, "request_id"))
	if e != nil {
		galleryError(w, e)
		return
	}
	v, e := s.store.GetGallerySession(r.Context(), req.SessionID)
	if e != nil {
		galleryError(w, e)
		return
	}
	app, _, e := s.galleryInstallation(r.Context(), v.WorkspaceID, v.ActorID, v.InstallationID)
	if e != nil || app.BotUserID != a.user.ID || a.workspaceID != v.WorkspaceID {
		writeError(w, 403, errors.New("response producer mismatch"))
		return
	}
	if e = s.galleryAuthorize(r.Context(), v); e != nil {
		writeError(w, 410, e)
		return
	}
	if _, e = s.gallerySubscription(r.Context(), v.WorkspaceID, v.InstallationID, req.Kind, req.SubscriptionID); e != nil {
		writeError(w, 410, e)
		return
	}
	if b.SessionID != v.ID || b.SchemaRevision != v.Descriptor.SchemaRevision || (b.State != "accepted" && b.State != "failed") {
		galleryError(w, store.ErrGalleryConflict)
		return
	}
	if req.State != "pending" && req.State != "uncertain" && req.State != "accepted" && req.State != "failed" {
		writeError(w, 410, errors.New("request closed"))
		return
	}
	encoded, _ := json.Marshal(b)
	if req.State == "accepted" || req.State == "failed" {
		if string(encoded) != string(req.Response) {
			galleryError(w, store.ErrGalleryConflict)
			return
		}
		writeJSON(w, 200, map[string]any{"request": req})
		return
	}
	if req.Kind != "choices" && b.Choices != nil {
		galleryError(w, errors.New("choices are not valid for this request"))
		return
	}
	if req.Kind == "choices" && b.State == "accepted" {
		if v.SubmissionID != "" {
			galleryError(w, store.ErrGalleryConflict)
			return
		}
		var input galleryInput
		if e = json.Unmarshal(req.Payload, &input); e != nil {
			galleryError(w, e)
			return
		}
		if b.Choices == nil || len(b.Choices) > input.Limit {
			galleryError(w, errors.New("invalid choices page"))
			return
		}
		for i, f := range v.Descriptor.Fields {
			if f.ID == input.FieldID {
				seen := map[string]bool{}
				for _, c := range b.Choices {
					if seen[c.ID] {
						galleryError(w, errors.New("duplicate choice"))
						return
					}
					seen[c.ID] = true
				}
				// Opaque IDs cannot change meaning within a session.
				for _, c := range b.Choices {
					found := false
					for _, old := range f.Choices {
						if old.ID == c.ID {
							if old != c {
								galleryError(w, store.ErrGalleryConflict)
								return
							}
							found = true
						}
					}
					if !found {
						f.Choices = append(f.Choices, c)
					}
				}
				v.Descriptor.Fields[i] = f
			}
		}
	}
	if b.PreviewUploadID != "" {
		v.PreviewUploadID = b.PreviewUploadID
	}
	if e = galleryactions.ValidateDescriptors([]galleryactions.Descriptor{v.Descriptor}); e != nil {
		galleryError(w, e)
		return
	}
	if e = s.galleryAuthorize(r.Context(), v); e != nil {
		writeError(w, 403, e)
		return
	}
	req.State = b.State
	req.Response = encoded
	if e = s.store.CompleteGallery(r.Context(), v, req); e != nil {
		galleryError(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"request": req})
}

// RunGalleryDispatcher owns no additional service. Call with the server's
// lifetime context. Leases survive process loss; retry event/request/submission
// identities and payloads remain stable. Consumers MUST deduplicate side effects.
func (s *Server) RunGalleryDispatcher(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if e := s.DispatchGallery(ctx); e != nil && ctx.Err() == nil {
			log.Printf("gallery dispatcher: %v", e)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (s *Server) DispatchGallery(ctx context.Context) error {
	if _, err := s.store.CleanupGallerySessions(ctx, time.Now().Unix()); err != nil {
		return err
	}
	rows, e := s.store.ListDueGalleryRequests(ctx, time.Now().Unix())
	if e != nil {
		return e
	}
	for _, row := range rows {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		at := time.Now().Unix()
		claimed, e := s.store.ClaimGalleryRequest(ctx, row.RequestID, at, at+30)
		if e != nil {
			return e
		}
		if !claimed {
			continue
		}
		req, e := s.store.GetGalleryRequest(ctx, row.RequestID)
		if e != nil {
			return e
		}
		v, e := s.store.GetGallerySession(ctx, req.SessionID)
		if e != nil {
			return e
		}
		if req.State == "accepted" || req.State == "failed" {
			if e = s.store.FinishGalleryRequest(ctx, req.ID); e != nil {
				return e
			}
			continue
		}
		if e = s.galleryAuthorize(ctx, v); e != nil {
			req.State = "unavailable"
			if at >= v.ExpiresAt {
				req.State = "expired"
			}
			if e = s.store.CompleteGallery(ctx, v, req); e != nil && !errors.Is(e, store.ErrGalleryConflict) {
				return e
			}
			continue
		}
		sub, e := s.gallerySubscription(ctx, v.WorkspaceID, v.InstallationID, req.Kind, req.SubscriptionID)
		if e != nil {
			req.State = "unavailable"
			if e = s.store.CompleteGallery(ctx, v, req); e != nil && !errors.Is(e, store.ErrGalleryConflict) {
				return e
			}
			continue
		}
		if row.Attempts >= 5 {
			req.State = "uncertain"
			if e = s.store.CompleteGallery(ctx, v, req); e != nil && !errors.Is(e, store.ErrGalleryConflict) {
				return e
			}
			continue
		}
		payload := req.Envelope
		if len(payload) == 0 {
			return errors.New("gallery delivery envelope missing")
		}
		callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		_, _, deliveryErr := s.postEventCallback(callCtx, sub, store.Event{ID: req.ID}, payload)
		cancel()
		// HTTP acknowledgement alone never means execution was accepted. The durable
		// request remains pending until the authenticated response arrives. Network
		// failure is explicitly uncertain and retains the original identity.
		if deliveryErr != nil {
			latest, lookup := s.store.GetGalleryRequest(ctx, req.ID)
			if lookup != nil {
				return lookup
			}
			if latest.State == "pending" {
				latest.State = "uncertain"
				sv, lookup := s.store.GetGallerySession(ctx, v.ID)
				if lookup != nil {
					return lookup
				}
				if e = s.store.MarkGalleryUncertain(ctx, sv, latest); e != nil && !errors.Is(e, store.ErrGalleryConflict) {
					return e
				}
			}
		}
	}
	return nil
}
