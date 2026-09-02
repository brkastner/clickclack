package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func (s *Server) upsertChannelBotAssignment(w http.ResponseWriter, r *http.Request) {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if act.botTokenID != "" {
		writeError(w, http.StatusForbidden, errors.New("bot tokens cannot manage channel bot assignments"))
		return
	}
	if err := act.requireScope("channels:write"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	assignment, event, err := s.store.UpsertChannelBotAssignment(r.Context(), store.UpsertChannelBotAssignmentInput{
		ChannelID: chi.URLParam(r, "channel_id"), BotUserID: chi.URLParam(r, "bot_user_id"), ActorUserID: act.user.ID,
	})
	if err == nil {
		s.publishEvent(r.Context(), event)
	}
	writeResult(w, map[string]any{"assignment": assignment, "event": event}, err)
}

func (s *Server) deleteChannelBotAssignment(w http.ResponseWriter, r *http.Request) {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if act.botTokenID != "" {
		writeError(w, http.StatusForbidden, errors.New("bot tokens cannot manage channel bot assignments"))
		return
	}
	if err := act.requireScope("channels:write"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	event, err := s.store.DeleteChannelBotAssignment(r.Context(), store.DeleteChannelBotAssignmentInput{
		ChannelID: chi.URLParam(r, "channel_id"), BotUserID: chi.URLParam(r, "bot_user_id"), ActorUserID: act.user.ID,
	})
	if err == nil {
		s.publishEvent(r.Context(), event)
	}
	writeResult(w, map[string]any{"event": event}, err)
}
