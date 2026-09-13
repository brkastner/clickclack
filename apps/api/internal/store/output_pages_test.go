package store

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
)

func TestOutputPageRequestAndCursorAreScoped(t *testing.T) {
	req, err := NormalizeOutputPageRequest(OutputPageRequest{WorkspaceID: " workspace ", AuthorID: " bot ", UserID: " user ", Limit: 999})
	if err != nil {
		t.Fatal(err)
	}
	if req.Limit != MaxOutputPageLimit || req.WorkspaceID != "workspace" || req.AuthorID != "bot" {
		t.Fatalf("unexpected normalized request: %#v", req)
	}
	cursor, err := EncodeOutputCursor(req, "2026-01-01T00:00:00Z", "msg_1")
	if err != nil {
		t.Fatal(err)
	}
	created, id, err := DecodeOutputCursor(cursor, req)
	if err != nil || created != "2026-01-01T00:00:00.000000000Z" || id != "msg_1" {
		t.Fatalf("unexpected cursor: %q %q %v", created, id, err)
	}
	_, _, err = DecodeOutputCursor(cursor, OutputPageRequest{WorkspaceID: req.WorkspaceID, AuthorID: req.AuthorID, UserID: "other", Limit: req.Limit})
	if !errors.Is(err, ErrInvalidOutputPage) {
		t.Fatalf("expected requester-scoped cursor rejection, got %v", err)
	}
}

func TestOutputPageRequestRejectsMissingIdentity(t *testing.T) {
	_, err := NormalizeOutputPageRequest(OutputPageRequest{WorkspaceID: "w", UserID: "u"})
	if !errors.Is(err, ErrInvalidOutputPage) {
		t.Fatalf("expected invalid request, got %v", err)
	}
}

func TestOutputCursorRejectsChangedScopeAndMalformedPosition(t *testing.T) {
	req := OutputPageRequest{WorkspaceID: "w", AuthorID: "b", UserID: "u"}
	cursor, err := EncodeOutputCursor(req, "2026-01-01T02:00:00+02:00", "message")
	if err != nil {
		t.Fatal(err)
	}
	for _, changed := range []OutputPageRequest{{WorkspaceID: "other", AuthorID: "b", UserID: "u"}, {WorkspaceID: "w", AuthorID: "other", UserID: "u"}} {
		if _, _, err := DecodeOutputCursor(cursor, changed); !errors.Is(err, ErrInvalidOutputPage) {
			t.Fatal("accepted changed cursor scope")
		}
	}
	bad, _ := json.Marshal(outputCursor{Version: outputCursorVersion, Fingerprint: outputFingerprint(req), CreatedAt: "invalid", MessageID: "m"})
	if _, _, err := DecodeOutputCursor(base64.RawURLEncoding.EncodeToString(bad), req); !errors.Is(err, ErrInvalidOutputPage) {
		t.Fatal("accepted malformed timestamp")
	}
	if _, _, err := DecodeOutputCursor("not-base64!", req); !errors.Is(err, ErrInvalidOutputPage) {
		t.Fatal("accepted malformed cursor")
	}
	normalized, err := NormalizeOutputPageRequest(req)
	if err != nil || normalized.Limit != DefaultOutputPageLimit {
		t.Fatal("missing default page limit")
	}
	req.Limit = -1
	if _, err := NormalizeOutputPageRequest(req); !errors.Is(err, ErrInvalidOutputPage) {
		t.Fatal("accepted negative limit")
	}
}
