package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"encoding/json"
	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/openclaw/clickclack/apps/api/internal/config"
	"github.com/openclaw/clickclack/apps/api/internal/notepad"
)

// Revalidate exact credentials and current conversation membership, never a
// remembered workspace recipient list. No raw gateway identities cross HTTP/WS.
func (s *Server) notepadAccess(r *http.Request, act actor) (string, error) {
	ctx := r.Context()
	if act.botTokenID != "" {
		token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		auth, err := s.store.GetBotTokenAuth(ctx, token)
		if err != nil {
			return "", notepad.Denied
		}
		act.scopes = auth.Scopes
		act.workspaceID = auth.WorkspaceID
	} else if act.sessionToken != "" {
		if _, err := s.sessionUser(ctx, act.sessionToken); err != nil {
			return "", notepad.Denied
		}
	} else if s.access != nil && r.Header.Get(accessAssertionHeader) != "" {
		if _, err := s.accessActor(r, r.Header.Get(accessAssertionHeader)); err != nil {
			return "", notepad.Denied
		}
	}
	if strings.HasSuffix(r.URL.Path, "/watch") && act.requireScope("realtime:read") != nil {
		return "", notepad.Denied
	}
	if err := act.requireScope("messages:read"); err != nil {
		return "", notepad.Denied
	}
	var workspaceID string
	if id := chi.URLParam(r, "channel_id"); id != "" {
		channel, err := s.store.GetChannel(ctx, id, act.user.ID)
		if err != nil {
			return "", notepad.Denied
		}
		workspaceID = channel.WorkspaceID
	} else {
		if err := act.requireScope("dms:read"); err != nil {
			return "", notepad.Denied
		}
		dm, err := s.store.GetDirectConversation(ctx, chi.URLParam(r, "conversation_id"), act.user.ID)
		if err != nil {
			return "", notepad.Denied
		}
		workspaceID = dm.WorkspaceID
	}
	if act.requireWorkspace(workspaceID) != nil {
		return "", notepad.Denied
	}
	if _, err := s.store.GetWorkspace(ctx, workspaceID, act.user.ID); err != nil {
		return "", notepad.Denied
	}
	return workspaceID, nil
}
func (s *Server) notepadBinding(workspaceID string, r *http.Request) (config.OpenClawNotepadGateway, config.OpenClawNotepadBinding, bool) {
	for _, b := range s.openclawNotepad.Bindings {
		if b.WorkspaceID == workspaceID && b.ChannelID == chi.URLParam(r, "channel_id") && b.DirectConversationID == chi.URLParam(r, "conversation_id") {
			for _, g := range s.openclawNotepad.Gateways {
				if g.ID == b.GatewayID {
					return g, b, true
				}
			}
		}
	}
	return config.OpenClawNotepadGateway{}, config.OpenClawNotepadBinding{}, false
}
func (s *Server) getNotepadAvailability(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, notepad.Denied)
		return
	}
	workspaceID, err := s.notepadAccess(r, act)
	if err != nil {
		writeError(w, http.StatusForbidden, notepad.Denied)
		return
	}
	_, _, available := s.notepadBinding(workspaceID, r)
	writeJSON(w, http.StatusOK, map[string]bool{"available": available})
}

func (s *Server) getNotepad(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, notepad.Denied)
		return
	}
	workspaceID, err := s.notepadAccess(r, act)
	if err != nil {
		writeError(w, http.StatusForbidden, notepad.Denied)
		return
	}
	g, b, ok := s.notepadBinding(workspaceID, r)
	if !ok {
		writeJSON(w, http.StatusOK, notepad.Result{State: notepad.Unmapped})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	connection, err := notepad.Dial(ctx, g, b)
	result := notepad.Result{State: notepad.ErrorState(err)}
	if err == nil {
		defer connection.Close()
		result.Card, err = connection.Get(ctx)
		result.State = notepad.Ready
		if err != nil {
			result.State = notepad.ErrorState(err)
		}
	}
	if _, err = s.notepadAccess(r, act); err != nil {
		writeError(w, http.StatusForbidden, notepad.Denied)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) watchNotepad(w http.ResponseWriter, r *http.Request) {
	// Same browser-cookie/SDK bearer subprotocol and Origin checks as realtime/ws.
	protocol := websocketBearerProtocol(r)
	if r.Header.Get("Authorization") == "" && protocol != "" {
		r.Header.Set("Authorization", "Bearer "+strings.TrimPrefix(protocol, websocketBearerProtocolPrefix))
	}
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, notepad.Denied)
		return
	}
	workspaceID, err := s.notepadAccess(r, act)
	if err != nil || act.requireScope("realtime:read") != nil {
		writeError(w, http.StatusForbidden, notepad.Denied)
		return
	}
	options := &websocket.AcceptOptions{OriginPatterns: s.websocketOriginPatterns(r)}
	if protocol != "" {
		options.Subprotocols = []string{protocol}
	}
	socket, err := websocket.Accept(w, r, options)
	if err != nil {
		return
	}
	defer socket.CloseNow()
	ctx := socket.CloseRead(r.Context())
	r = r.WithContext(ctx)
	send := func(state notepad.State) bool {
		if _, err := s.notepadAccess(r, act); err != nil {
			socket.Close(websocket.StatusPolicyViolation, "conversation access revoked")
			return false
		}
		body, _ := json.Marshal(map[string]any{"type": "notepad.changed", "state": state})
		writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return socket.Write(writeCtx, websocket.MessageText, body) == nil
	}
	g, b, ok := s.notepadBinding(workspaceID, r)
	if !ok {
		send(notepad.Unmapped)
		socket.Close(websocket.StatusNormalClosure, "unmapped")
		return
	}
	connection, err := notepad.Dial(ctx, g, b)
	if err != nil {
		send(notepad.ErrorState(err))
		socket.Close(websocket.StatusNormalClosure, "notepad unavailable")
		return
	}
	defer connection.Close()
	initialCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	_, err = connection.Get(initialCtx)
	cancel()
	if err != nil {
		send(notepad.ErrorState(err))
		socket.Close(websocket.StatusNormalClosure, "notepad unavailable")
		return
	}
	if !send(notepad.Ready) {
		return
	}
	ticker := time.NewTicker(s.realtimeSessionCheck)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-connection.Done():
			send(notepad.Unavailable)
			return
		case <-ticker.C:
			if _, err := s.notepadAccess(r, act); err != nil {
				socket.Close(websocket.StatusPolicyViolation, "conversation access revoked")
				return
			}
		case <-connection.Changes:
			if !send(notepad.Ready) {
				return
			}
		}
	}
}
