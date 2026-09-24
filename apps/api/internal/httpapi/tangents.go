package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/openclaw/clickclack/apps/api/internal/store"
)

// Tangents are private side chats between one person and one bot, forked from
// a channel or DM the two already share. ClickClack never persists them: the
// registry lives in server memory and every frame is cursorless, so nothing
// reaches replay, event subscriptions, search, or unread state. A server
// restart ends every tangent, which is the intended lifetime. The agent side
// owns whatever context the fork carries.
const (
	tangentMaxBodyRunes    = 32000
	tangentMaxPerOwner     = 3
	tangentMaxTotal        = 1024
	tangentIdleTTL         = 12 * time.Hour
	tangentClientIDMaxLen  = 128
	tangentActivityWorking = "working"
	tangentActivityIdle    = "idle"
)

var errTangentNotFound = errors.New("tangent not found")

type tangentRecord struct {
	ID                   string `json:"id"`
	WorkspaceID          string `json:"workspace_id"`
	ChannelID            string `json:"channel_id,omitempty"`
	DirectConversationID string `json:"direct_conversation_id,omitempty"`
	OwnerUserID          string `json:"owner_user_id"`
	BotUserID            string `json:"bot_user_id"`
	CreatedAt            string `json:"created_at"`
	lastActive           time.Time
}

type tangentMessage struct {
	ID        string `json:"id"`
	TangentID string `json:"tangent_id"`
	AuthorID  string `json:"author_id"`
	Body      string `json:"body"`
	ClientID  string `json:"client_id,omitempty"`
	CreatedAt string `json:"created_at"`
}

type tangentRegistry struct {
	mu   sync.Mutex
	byID map[string]*tangentRecord
}

func newTangentRegistry() *tangentRegistry {
	return &tangentRegistry{byID: map[string]*tangentRecord{}}
}

// add stores record and returns the tangents it displaced: idle ones, the
// owner's oldest beyond the per-owner cap, and the oldest overall beyond the
// global cap. Callers announce each displaced tangent as closed.
func (g *tangentRegistry) add(record *tangentRecord, now time.Time) []tangentRecord {
	g.mu.Lock()
	defer g.mu.Unlock()
	var evicted []tangentRecord
	for id, existing := range g.byID {
		if now.Sub(existing.lastActive) > tangentIdleTTL {
			evicted = append(evicted, *existing)
			delete(g.byID, id)
		}
	}
	oldestFirst := func(filter func(*tangentRecord) bool) []*tangentRecord {
		var list []*tangentRecord
		for _, existing := range g.byID {
			if filter(existing) {
				list = append(list, existing)
			}
		}
		sort.Slice(list, func(i, j int) bool { return list[i].lastActive.Before(list[j].lastActive) })
		return list
	}
	owned := oldestFirst(func(t *tangentRecord) bool { return t.OwnerUserID == record.OwnerUserID })
	for len(owned) >= tangentMaxPerOwner {
		evicted = append(evicted, *owned[0])
		delete(g.byID, owned[0].ID)
		owned = owned[1:]
	}
	all := oldestFirst(func(*tangentRecord) bool { return true })
	for len(all) >= tangentMaxTotal {
		evicted = append(evicted, *all[0])
		delete(g.byID, all[0].ID)
		all = all[1:]
	}
	g.byID[record.ID] = record
	return evicted
}

func (g *tangentRegistry) get(id string) (tangentRecord, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	record, ok := g.byID[id]
	if !ok {
		return tangentRecord{}, false
	}
	return *record, true
}

func (g *tangentRegistry) touch(id string, now time.Time) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if record, ok := g.byID[id]; ok {
		record.lastActive = now
	}
}

func (g *tangentRegistry) remove(id string) (tangentRecord, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	record, ok := g.byID[id]
	if !ok {
		return tangentRecord{}, false
	}
	delete(g.byID, id)
	return *record, true
}

func newTangentID(prefix string) string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		panic(err)
	}
	return prefix + hex.EncodeToString(raw[:])
}

// tangentParticipant resolves the caller and confirms they are the tangent's
// owner or bot. Anyone else gets the same not-found answer as a missing id so
// tangent ids can't be probed.
func (s *Server) tangentParticipant(r *http.Request) (actor, tangentRecord, error) {
	act, err := s.currentActor(r)
	if err != nil {
		return actor{}, tangentRecord{}, err
	}
	record, ok := s.tangents.get(chi.URLParam(r, "tangent_id"))
	if !ok || (act.user.ID != record.OwnerUserID && act.user.ID != record.BotUserID) {
		return act, tangentRecord{}, errTangentNotFound
	}
	if err := act.requireWorkspace(record.WorkspaceID); err != nil {
		return act, tangentRecord{}, errTangentNotFound
	}
	return act, record, nil
}

// tangentStillShared rechecks that both participants can still see the
// source conversation. Losing access ends the tangent.
func (s *Server) tangentStillShared(ctx context.Context, record tangentRecord) bool {
	for _, userID := range []string{record.OwnerUserID, record.BotUserID} {
		var err error
		if record.DirectConversationID != "" {
			_, err = s.store.GetDirectConversation(ctx, record.DirectConversationID, userID)
		} else {
			_, err = s.store.GetChannel(ctx, record.ChannelID, userID)
		}
		if err != nil {
			return false
		}
	}
	return true
}

func (s *Server) publishTangentEvent(ctx context.Context, record tangentRecord, eventType string, payload map[string]any) {
	payload["tangent_id"] = record.ID
	if record.DirectConversationID != "" {
		payload["direct_conversation_id"] = record.DirectConversationID
	} else {
		payload["channel_id"] = record.ChannelID
	}
	now := time.Now().UTC()
	s.publishEvent(ctx, store.Event{
		ID:               "eph_" + now.Format("20060102150405.000000000"),
		Type:             eventType,
		WorkspaceID:      record.WorkspaceID,
		ChannelID:        record.ChannelID,
		CreatedAt:        now.Format(time.RFC3339Nano),
		Payload:          payload,
		RecipientUserIDs: []string{record.OwnerUserID, record.BotUserID},
	})
}

func (s *Server) closeTangent(ctx context.Context, record tangentRecord, reason string) {
	s.publishTangentEvent(ctx, record, "tangent.closed", map[string]any{"reason": reason})
}

func (s *Server) createTangent(w http.ResponseWriter, r *http.Request) {
	act, err := s.currentActor(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if act.botTokenID != "" {
		writeError(w, http.StatusForbidden, errors.New("bots can't open tangents"))
		return
	}
	if err := act.requireScope("messages:write"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	var body struct {
		WorkspaceID          string `json:"workspace_id"`
		ChannelID            string `json:"channel_id"`
		DirectConversationID string `json:"direct_conversation_id"`
		BotUserID            string `json:"bot_user_id"`
	}
	if err := readJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	channelID := strings.TrimSpace(body.ChannelID)
	dmID := strings.TrimSpace(body.DirectConversationID)
	botID := strings.TrimSpace(body.BotUserID)
	if body.WorkspaceID == "" || botID == "" || (channelID == "") == (dmID == "") {
		writeError(w, http.StatusBadRequest, errors.New("tangent requires workspace_id, bot_user_id, and exactly one of channel_id or direct_conversation_id"))
		return
	}
	if err := act.requireWorkspace(body.WorkspaceID); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	bot, err := s.store.GetUser(r.Context(), botID)
	if err != nil || bot.Kind != "bot" || bot.DeletedAt != nil {
		writeError(w, http.StatusBadRequest, errors.New("bot_user_id must name a bot"))
		return
	}
	record := &tangentRecord{WorkspaceID: body.WorkspaceID, ChannelID: channelID, DirectConversationID: dmID, OwnerUserID: act.user.ID, BotUserID: bot.ID}
	if dmID != "" {
		dm, err := s.store.GetDirectConversation(r.Context(), dmID, act.user.ID)
		if err != nil || dm.WorkspaceID != body.WorkspaceID {
			writeError(w, http.StatusForbidden, errors.New("direct conversation unavailable"))
			return
		}
		botIsMember := false
		for _, member := range dm.Members {
			botIsMember = botIsMember || member.ID == bot.ID
		}
		if !botIsMember {
			writeError(w, http.StatusBadRequest, errors.New("bot isn't in this conversation"))
			return
		}
	} else {
		channel, err := s.store.GetChannel(r.Context(), channelID, act.user.ID)
		if err != nil || channel.WorkspaceID != body.WorkspaceID {
			writeError(w, http.StatusForbidden, errors.New("channel unavailable"))
			return
		}
	}
	if !s.tangentStillShared(r.Context(), *record) {
		writeError(w, http.StatusBadRequest, errors.New("bot can't see this conversation"))
		return
	}
	if err := s.store.CanPublishEphemeral(r.Context(), body.WorkspaceID, channelID, dmID, act.user.ID); err != nil {
		writeStoreError(w, err)
		return
	}
	now := time.Now().UTC()
	record.ID = newTangentID("tng_")
	record.CreatedAt = now.Format(time.RFC3339Nano)
	record.lastActive = now
	for _, evicted := range s.tangents.add(record, now) {
		s.closeTangent(r.Context(), evicted, "replaced")
	}
	s.publishTangentEvent(r.Context(), *record, "tangent.opened", map[string]any{"tangent": *record})
	writeJSON(w, http.StatusCreated, map[string]any{"tangent": *record})
}

func (s *Server) getTangent(w http.ResponseWriter, r *http.Request) {
	_, record, err := s.tangentParticipant(r)
	if err != nil {
		writeTangentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tangent": record})
}

func (s *Server) postTangentMessage(w http.ResponseWriter, r *http.Request) {
	act, record, err := s.tangentParticipant(r)
	if err != nil {
		writeTangentError(w, err)
		return
	}
	if err := act.requireScope("messages:write"); err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	var body struct {
		Body     string `json:"body"`
		ClientID string `json:"client_id"`
	}
	if err := readJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	text := strings.TrimSpace(body.Body)
	if text == "" || utf8.RuneCountInString(text) > tangentMaxBodyRunes {
		writeError(w, http.StatusBadRequest, errors.New("tangent message body must be 1 to 32000 characters"))
		return
	}
	if len(body.ClientID) > tangentClientIDMaxLen {
		writeError(w, http.StatusBadRequest, errors.New("client_id is too long"))
		return
	}
	if !s.tangentStillShared(r.Context(), record) {
		if removed, ok := s.tangents.remove(record.ID); ok {
			s.closeTangent(r.Context(), removed, "access_lost")
		}
		writeTangentError(w, errTangentNotFound)
		return
	}
	now := time.Now().UTC()
	s.tangents.touch(record.ID, now)
	message := tangentMessage{
		ID:        newTangentID("tgm_"),
		TangentID: record.ID,
		AuthorID:  act.user.ID,
		Body:      text,
		ClientID:  body.ClientID,
		CreatedAt: now.Format(time.RFC3339Nano),
	}
	s.publishTangentEvent(r.Context(), record, "tangent.message", map[string]any{"message": message})
	writeJSON(w, http.StatusCreated, map[string]any{"message": message})
}

// postTangentActivity lets the bot say it is working on a reply, so the panel
// can show progress without a durable activity row.
func (s *Server) postTangentActivity(w http.ResponseWriter, r *http.Request) {
	act, record, err := s.tangentParticipant(r)
	if err != nil {
		writeTangentError(w, err)
		return
	}
	if act.user.ID != record.BotUserID {
		writeError(w, http.StatusForbidden, errors.New("only the tangent's bot reports activity"))
		return
	}
	var body struct {
		State string `json:"state"`
	}
	if err := readJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if body.State != tangentActivityWorking && body.State != tangentActivityIdle {
		writeError(w, http.StatusBadRequest, errors.New("state must be working or idle"))
		return
	}
	s.publishTangentEvent(r.Context(), record, "tangent.activity", map[string]any{"state": body.State, "user_id": act.user.ID})
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) deleteTangent(w http.ResponseWriter, r *http.Request) {
	act, record, err := s.tangentParticipant(r)
	if err != nil {
		writeTangentError(w, err)
		return
	}
	if act.user.ID != record.OwnerUserID {
		writeError(w, http.StatusForbidden, errors.New("only the tangent's owner can close it"))
		return
	}
	if removed, ok := s.tangents.remove(record.ID); ok {
		s.closeTangent(r.Context(), removed, "closed")
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeTangentError(w http.ResponseWriter, err error) {
	if errors.Is(err, errTangentNotFound) {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeError(w, http.StatusUnauthorized, err)
}
