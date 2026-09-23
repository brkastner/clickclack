package httpapi

import (
	"errors"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func (s *Server) publishBotRuntimeStatus(w http.ResponseWriter, r *http.Request) {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if act.botTokenID == "" {
		writeError(w, http.StatusForbidden, errors.New("runtime status requires a bot token"))
		return
	}
	for _, scope := range []string{"messages:read", store.AgentActivityWriteScope} {
		if err := act.requireScope(scope); err != nil {
			writeError(w, http.StatusForbidden, err)
			return
		}
	}
	channelID, dmID := chi.URLParam(r, "channel_id"), chi.URLParam(r, "conversation_id")
	if dmID != "" {
		if err := act.requireScope("dms:read"); err != nil {
			writeError(w, http.StatusForbidden, err)
			return
		}
	}
	var body struct {
		WorkspaceID string                         `json:"workspace_id"`
		Status      store.BotRuntimeStatusSnapshot `json:"status"`
	}
	if err := readJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.WorkspaceID == "" || utf8.RuneCountInString(body.WorkspaceID) > 256 || (channelID == "") == (dmID == "") {
		writeError(w, http.StatusBadRequest, errors.New("runtime status requires workspace_id and exactly one target"))
		return
	}
	if err := body.Status.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := act.requireWorkspace(body.WorkspaceID); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	var recipients []string
	if dmID != "" {
		dm, err := s.store.GetDirectConversation(r.Context(), dmID, act.user.ID)
		if err != nil || dm.WorkspaceID != body.WorkspaceID {
			writeError(w, http.StatusForbidden, errors.New("direct conversation unavailable"))
			return
		}
		for _, member := range dm.Members {
			recipients = append(recipients, member.ID)
		}
	} else {
		channel, err := s.store.GetChannel(r.Context(), channelID, act.user.ID)
		if err != nil || channel.WorkspaceID != body.WorkspaceID {
			writeError(w, http.StatusForbidden, errors.New("channel unavailable"))
			return
		}
	}
	record, err := s.store.PublishBotRuntimeStatus(r.Context(), store.PublishBotRuntimeStatusInput{WorkspaceID: body.WorkspaceID, ChannelID: channelID, DirectConversationID: dmID, BotUserID: act.user.ID, Snapshot: body.Status})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.publishEvent(r.Context(), store.Event{ID: "eph_" + time.Now().UTC().Format("20060102150405.000000000"), Type: "bot.runtime_status", WorkspaceID: record.WorkspaceID, ChannelID: record.ChannelID, CreatedAt: record.UpdatedAt, RecipientUserIDs: recipients, Payload: map[string]any{"status": record, "channel_id": record.ChannelID, "direct_conversation_id": record.DirectConversationID, "user_id": record.BotUserID}})
	writeJSON(w, http.StatusOK, map[string]any{"status": record})
}

func (s *Server) listBotRuntimeStatuses(w http.ResponseWriter, r *http.Request) {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if err := act.requireScope("messages:read"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	channelID, dmID := chi.URLParam(r, "channel_id"), chi.URLParam(r, "conversation_id")
	if dmID != "" {
		if err := act.requireScope("dms:read"); err != nil {
			writeError(w, http.StatusForbidden, err)
			return
		}
	}
	workspaceID := ""
	if channelID != "" {
		channel, err := s.store.GetChannel(r.Context(), channelID, act.user.ID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		workspaceID = channel.WorkspaceID
	} else {
		dm, err := s.store.GetDirectConversation(r.Context(), dmID, act.user.ID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		workspaceID = dm.WorkspaceID
	}
	if err := act.requireWorkspace(workspaceID); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	statuses, err := s.store.ListBotRuntimeStatuses(r.Context(), workspaceID, channelID, dmID, act.user.ID)
	writeResult(w, map[string]any{"statuses": statuses}, err)
}
