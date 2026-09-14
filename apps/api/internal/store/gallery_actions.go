package store

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/openclaw/clickclack/apps/api/internal/galleryactions"
)

// GalleryRetentionSeconds retains expired records for diagnosis, not execution.
const GalleryRetentionSeconds int64 = 24 * 60 * 60

const GalleryActionsWriteScope = "gallery_actions:write"

var ErrGalleryConflict = errors.New("gallery identity or revision conflict")

func IsGalleryEventType(t string) bool {
	return t == "gallery_action.open" || t == "gallery_action.choices" || t == "gallery_action.submit"
}

type GalleryCapability struct {
	InstallationID string                      `json:"installation_id"`
	WorkspaceID    string                      `json:"-"`
	TokenID        string                      `json:"-"`
	Generation     string                      `json:"capability_revision"`
	Descriptors    []galleryactions.Descriptor `json:"gallery_actions"`
}
type GallerySession struct {
	ID              string                    `json:"id"`
	Version         int64                     `json:"-"`
	ActorID         string                    `json:"actor_id"`
	WorkspaceID     string                    `json:"workspace_id"`
	InstallationID  string                    `json:"installation_id"`
	SourceUploadID  string                    `json:"source_upload_id"`
	DestinationID   string                    `json:"destination_id"`
	Generation      string                    `json:"capability_revision"`
	Descriptor      galleryactions.Descriptor `json:"descriptor"`
	ExpiresAt       int64                     `json:"expires_at"`
	SubmissionID    string                    `json:"submission_id,omitempty"`
	RequestCount    int                       `json:"request_count"`
	PreviewUploadID string                    `json:"preview_upload_id,omitempty"`
}
type GalleryRequest struct {
	ID             string          `json:"request_id"`
	SessionID      string          `json:"session_id"`
	Kind           string          `json:"kind"`
	Digest         string          `json:"-"`
	Payload        json.RawMessage `json:"payload"`
	Envelope       json.RawMessage `json:"-"`
	State          string          `json:"state"`
	Response       json.RawMessage `json:"response,omitempty"`
	SubscriptionID string          `json:"subscription_id"`
}
type GalleryOutbox struct {
	RequestID string
	DueAt     int64
	Attempts  int64
}

// GalleryStore persists sessions and payload-bound requests with atomic enqueue.
// SaveGallery uses optimistic session revision checks in the same transaction as
// request creation, preventing concurrent new submission identities.
type GalleryStore interface {
	CleanupGallerySessions(context.Context, int64) (int64, error)
	PutGalleryCapability(context.Context, GalleryCapability) error
	ListGalleryCapabilities(context.Context, string) ([]GalleryCapability, error)
	GetGallerySession(context.Context, string) (GallerySession, error)
	GetGalleryRequest(context.Context, string) (GalleryRequest, error)
	SaveGallery(context.Context, GallerySession, *GalleryRequest, bool) error
	CompleteGallery(context.Context, GallerySession, GalleryRequest) error
	MarkGalleryUncertain(context.Context, GallerySession, GalleryRequest) error
	AuthorizeGalleryActor(context.Context, string, string, string) error
	ListDueGalleryRequests(context.Context, int64) ([]GalleryOutbox, error)
	ClaimGalleryRequest(context.Context, string, int64, int64) (bool, error)
	FinishGalleryRequest(context.Context, string) error
}
