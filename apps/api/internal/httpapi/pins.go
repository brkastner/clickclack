package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func (s *Server) pinMessage(w http.ResponseWriter, r *http.Request) {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if err := act.requireScope("messages:write"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}

	channelID := chi.URLParam(r, "channel_id")
	if !s.requireBotChannelWorkspace(w, r, act, channelID) {
		return
	}
	var body struct {
		MessageID string `json:"message_id"`
	}
	if err := readJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.MessageID == "" {
		writeError(w, http.StatusBadRequest, errors.New("message_id is required"))
		return
	}

	pin, event, err := s.store.PinMessage(r.Context(), channelID, body.MessageID, act.user.ID)
	if err == nil && event.ID != "" {
		s.publishEvent(r.Context(), event)
	}
	writeResultStatus(w, http.StatusCreated, map[string]any{"pinned_message": pin, "event": event}, err)
}

func (s *Server) unpinMessage(w http.ResponseWriter, r *http.Request) {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if err := act.requireScope("messages:write"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}

	channelID := chi.URLParam(r, "channel_id")
	if !s.requireBotChannelWorkspace(w, r, act, channelID) {
		return
	}
	messageID := chi.URLParam(r, "message_id")

	event, err := s.store.UnpinMessage(r.Context(), channelID, messageID, act.user.ID)
	if err == nil && event.ID != "" {
		s.publishEvent(r.Context(), event)
	}
	if err != nil {
		if errors.Is(err, store.ErrPinnedMessageNotFound) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"event": event})
}

func (s *Server) listPinnedMessages(w http.ResponseWriter, r *http.Request) {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if err := act.requireScope("messages:read"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}

	channelID := chi.URLParam(r, "channel_id")
	if !s.requireBotChannelWorkspace(w, r, act, channelID) {
		return
	}
	limit := queryInt(r, "limit", store.MaxPinnedMessagesPerChannel)

	messages, err := s.store.ListPinnedMessages(r.Context(), channelID, act.user.ID, limit)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if messages == nil {
		messages = []store.Message{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
}
