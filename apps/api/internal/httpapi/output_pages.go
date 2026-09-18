package httpapi

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func (s *Server) listOutputs(w http.ResponseWriter, r *http.Request) {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if err := act.requireScope("messages:read"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	if err := act.requireScope("dms:read"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	workspaceID := chi.URLParam(r, "workspace_id")
	if err := act.requireWorkspace(workspaceID); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	limit := 0
	mediaOnly := r.URL.Query().Get("media_only") == "true"
	includeOwn := r.URL.Query().Get("include_own") == "true"
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, fmt.Errorf("%w: limit must be a positive integer", store.ErrInvalidOutputPage))
			return
		}
		limit = int(parsed)
	}
	page, err := s.store.ListOutputPage(r.Context(), store.OutputPageRequest{
		WorkspaceID: workspaceID, AuthorID: r.URL.Query().Get("author_id"), UserID: act.user.ID, Limit: limit, Cursor: r.URL.Query().Get("cursor"), MediaOnly: mediaOnly, IncludeOwn: includeOwn,
	})
	if err != nil {
		switch {
		case errors.Is(err, store.ErrInvalidOutputPage):
			writeError(w, http.StatusBadRequest, err)
		case errors.Is(err, sql.ErrNoRows):
			writeError(w, http.StatusNotFound, errors.New("workspace unavailable"))
		case errors.Is(err, store.ErrModerationRestricted):
			writeError(w, http.StatusForbidden, err)
		default:
			writeError(w, http.StatusInternalServerError, errors.New("could not load outputs"))
		}
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeResult(w, page, nil)
}
