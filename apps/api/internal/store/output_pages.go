package store

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	DefaultOutputPageLimit = 30
	MaxOutputPageLimit     = 100
	outputCursorVersion    = 1
)

var ErrInvalidOutputPage = errors.New("invalid output page request")

type OutputPageRequest struct {
	WorkspaceID string
	AuthorID    string
	UserID      string
	Limit       int
	Cursor      string
}

type OutputPage struct {
	Outputs    []Message `json:"outputs"`
	NextCursor *string   `json:"next_cursor"`
}

type outputCursor struct {
	Version     int    `json:"v"`
	Fingerprint string `json:"f"`
	CreatedAt   string `json:"t"`
	MessageID   string `json:"m"`
}

func NormalizeOutputPageRequest(req OutputPageRequest) (OutputPageRequest, error) {
	req.WorkspaceID = strings.TrimSpace(req.WorkspaceID)
	req.AuthorID = strings.TrimSpace(req.AuthorID)
	req.UserID = strings.TrimSpace(req.UserID)
	req.Cursor = strings.TrimSpace(req.Cursor)
	if req.WorkspaceID == "" || req.AuthorID == "" || req.UserID == "" {
		return req, fmt.Errorf("%w: workspace_id, author_id, and user id are required", ErrInvalidOutputPage)
	}
	if req.Limit == 0 {
		req.Limit = DefaultOutputPageLimit
	}
	if req.Limit < 0 {
		return req, fmt.Errorf("%w: limit must be positive", ErrInvalidOutputPage)
	}
	if req.Limit > MaxOutputPageLimit {
		req.Limit = MaxOutputPageLimit
	}
	return req, nil
}

func DecodeOutputCursor(value string, req OutputPageRequest) (createdAt, messageID string, err error) {
	if strings.TrimSpace(value) == "" {
		return "", "", nil
	}
	payload, decodeErr := base64.RawURLEncoding.DecodeString(value)
	if decodeErr != nil {
		return "", "", fmt.Errorf("%w: malformed cursor", ErrInvalidOutputPage)
	}
	var cursor outputCursor
	if json.Unmarshal(payload, &cursor) != nil || cursor.Version != outputCursorVersion || cursor.Fingerprint != outputFingerprint(req) || cursor.CreatedAt == "" || cursor.MessageID == "" {
		return "", "", fmt.Errorf("%w: stale or mismatched cursor", ErrInvalidOutputPage)
	}
	normalized, parseErr := NormalizeOutputTimestamp(cursor.CreatedAt)
	if parseErr != nil {
		return "", "", fmt.Errorf("%w: malformed cursor timestamp", ErrInvalidOutputPage)
	}
	return normalized, cursor.MessageID, nil
}

func EncodeOutputCursor(req OutputPageRequest, createdAt, messageID string) (string, error) {
	if createdAt == "" || messageID == "" {
		return "", fmt.Errorf("%w: invalid cursor position", ErrInvalidOutputPage)
	}
	normalized, err := NormalizeOutputTimestamp(createdAt)
	if err != nil {
		return "", fmt.Errorf("%w: invalid cursor timestamp", ErrInvalidOutputPage)
	}
	payload, err := json.Marshal(outputCursor{Version: outputCursorVersion, Fingerprint: outputFingerprint(req), CreatedAt: normalized, MessageID: messageID})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

// NormalizeOutputTimestamp gives cursors the same UTC, nanosecond precision key
// used by the SQLite and Postgres output queries.
func NormalizeOutputTimestamp(value string) (string, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return "", err
	}
	return parsed.UTC().Format("2006-01-02T15:04:05.000000000Z"), nil
}

func outputFingerprint(req OutputPageRequest) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{req.WorkspaceID, req.AuthorID, req.UserID}, "\x00")))
	return base64.RawURLEncoding.EncodeToString(sum[:16])
}
