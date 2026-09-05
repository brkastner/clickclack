package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

func (s *Server) publishWorkflowSnapshot(w http.ResponseWriter, r *http.Request) {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if act.botTokenID == "" {
		writeError(w, http.StatusForbidden, errors.New("workflow snapshots require a bot token"))
		return
	}
	for _, scope := range []string{"messages:write", store.AgentActivityWriteScope} {
		if err := act.requireScope(scope); err != nil {
			writeError(w, http.StatusForbidden, err)
			return
		}
	}
	var body struct {
		WorkspaceID          string          `json:"workspace_id"`
		ChannelID            string          `json:"channel_id"`
		DirectConversationID string          `json:"direct_conversation_id"`
		Snapshot             json.RawMessage `json:"snapshot"`
	}
	if err := readJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.WorkspaceID == "" || (body.ChannelID == "") == (body.DirectConversationID == "") {
		writeError(w, http.StatusBadRequest, errors.New("workflow snapshot requires workspace_id and exactly one target"))
		return
	}
	for _, id := range []string{body.WorkspaceID, body.ChannelID, body.DirectConversationID} {
		if utf8.RuneCountInString(id) > 256 {
			writeError(w, http.StatusBadRequest, errors.New("target identifier too long"))
			return
		}
	}
	snapshot, err := store.DecodeWorkflowSnapshot(body.Snapshot)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if !s.authorizeWorkspaceAccess(w, r, act, body.WorkspaceID) {
		return
	}
	var recipients []string
	if body.DirectConversationID != "" {
		if err := act.requireScope("dms:write"); err != nil {
			writeError(w, http.StatusForbidden, err)
			return
		}
		dm, err := s.store.GetDirectConversation(r.Context(), body.DirectConversationID, act.user.ID)
		if err != nil || dm.WorkspaceID != body.WorkspaceID {
			writeError(w, http.StatusForbidden, errors.New("direct conversation unavailable"))
			return
		}
		for _, member := range dm.Members {
			recipients = append(recipients, member.ID)
		}
	} else {
		channel, err := s.store.GetChannel(r.Context(), body.ChannelID, act.user.ID)
		if err != nil || channel.WorkspaceID != body.WorkspaceID {
			writeError(w, http.StatusForbidden, errors.New("channel unavailable"))
			return
		}
	}
	record, changed, err := s.store.PublishWorkflowSnapshot(r.Context(), store.PublishWorkflowSnapshotInput{WorkspaceID: body.WorkspaceID, ChannelID: body.ChannelID, DirectConversationID: body.DirectConversationID, ProducerID: act.user.ID, Snapshot: snapshot})
	if errors.Is(err, store.ErrWorkflowRevisionConflict) {
		writeError(w, http.StatusConflict, err)
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if changed {
		s.publishEvent(r.Context(), store.Event{ID: "eph_" + time.Now().UTC().Format("20060102150405.000000000"), Type: "workflow.snapshot", WorkspaceID: record.WorkspaceID, ChannelID: record.ChannelID, CreatedAt: record.UpdatedAt, RecipientUserIDs: recipients, Payload: map[string]any{"record": record, "channel_id": record.ChannelID, "direct_conversation_id": record.DirectConversationID, "user_id": record.ProducerID}})
	}
	writeJSON(w, http.StatusOK, map[string]any{"record": record, "changed": changed})
}
func (s *Server) listWorkflowSnapshots(w http.ResponseWriter, r *http.Request) {
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
	workspaceID := ""
	if channelID != "" {
		channel, err := s.store.GetChannel(r.Context(), channelID, act.user.ID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		workspaceID = channel.WorkspaceID
	} else {
		if err := act.requireScope("dms:read"); err != nil {
			writeError(w, http.StatusForbidden, err)
			return
		}
		dm, err := s.store.GetDirectConversation(r.Context(), dmID, act.user.ID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		workspaceID = dm.WorkspaceID
	}
	if !s.authorizeWorkspaceAccess(w, r, act, workspaceID) {
		return
	}
	limit := 10
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 20 {
			writeError(w, http.StatusBadRequest, errors.New("limit must be 1..20"))
			return
		}
	}
	page, err := s.store.ListWorkflowSnapshots(r.Context(), workspaceID, channelID, dmID, act.user.ID, r.URL.Query().Get("cursor"), limit)
	writeResult(w, page, err)
}
