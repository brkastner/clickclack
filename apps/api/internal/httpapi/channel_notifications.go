package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func (s *Server) getChannelNotificationSettings(w http.ResponseWriter, r *http.Request) {
	actor, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if err := actor.requireScope("messages:read"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	channelID := chi.URLParam(r, "channel_id")
	if !s.requireBotChannelWorkspace(w, r, actor, channelID) {
		return
	}
	preference, err := s.store.GetChannelNotificationPreference(
		r.Context(),
		channelID,
		actor.user.ID,
	)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"preference": preference})
}

func (s *Server) updateChannelNotificationSettings(w http.ResponseWriter, r *http.Request) {
	actor, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if err := actor.requireScope("messages:write"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	channelID := chi.URLParam(r, "channel_id")
	if !s.requireBotChannelWorkspace(w, r, actor, channelID) {
		return
	}
	var body struct {
		Preference string `json:"preference"`
	}
	if err := readJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.Preference != store.ChannelNotifyAll &&
		body.Preference != store.ChannelNotifyMentions &&
		body.Preference != store.ChannelNotifyMuted {
		writeError(w, http.StatusBadRequest, errors.New("preference must be all, mentions, or muted"))
		return
	}
	if err := s.store.UpsertChannelNotificationSettings(r.Context(), store.ChannelNotificationInput{
		ChannelID:  channelID,
		UserID:     actor.user.ID,
		Preference: body.Preference,
	}); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"preference": body.Preference})
}
