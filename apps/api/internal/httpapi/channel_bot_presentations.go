package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func (s *Server) upsertChannelBotPresentation(w http.ResponseWriter, r *http.Request) {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if act.botTokenID != "" {
		writeError(w, http.StatusForbidden, errors.New("bot tokens cannot manage channel bot presentations"))
		return
	}
	if err := act.requireScope("channels:write"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	var body struct {
		DisplayName string `json:"display_name"`
		AvatarURL   string `json:"avatar_url"`
	}
	if err := readJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	presentation, event, err := s.store.UpsertChannelBotPresentation(r.Context(), store.UpsertChannelBotPresentationInput{
		ChannelID:   chi.URLParam(r, "channel_id"),
		BotUserID:   chi.URLParam(r, "bot_user_id"),
		DisplayName: body.DisplayName,
		AvatarURL:   body.AvatarURL,
		ActorUserID: act.user.ID,
	})
	if err == nil {
		s.publishEvent(r.Context(), event)
	}
	writeResult(w, map[string]any{"presentation": presentation, "event": event}, err)
}

func (s *Server) deleteChannelBotPresentation(w http.ResponseWriter, r *http.Request) {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if act.botTokenID != "" {
		writeError(w, http.StatusForbidden, errors.New("bot tokens cannot manage channel bot presentations"))
		return
	}
	if err := act.requireScope("channels:write"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	event, err := s.store.DeleteChannelBotPresentation(r.Context(), store.DeleteChannelBotPresentationInput{
		ChannelID:   chi.URLParam(r, "channel_id"),
		BotUserID:   chi.URLParam(r, "bot_user_id"),
		ActorUserID: act.user.ID,
	})
	if err == nil {
		s.publishEvent(r.Context(), event)
	}
	writeResult(w, map[string]any{"event": event}, err)
}
