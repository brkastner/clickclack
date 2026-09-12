// Package notepadtest provides an isolated authenticated Gateway v4 fixture.
package notepadtest

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/openclaw/clickclack/apps/api/internal/config"
)

type Gateway struct {
	Config       config.OpenClawNotepadGateway
	mu           sync.Mutex
	sockets      map[*websocket.Conn]bool
	cards        map[string]any
	Methods      []string
	ConnectError string
	Deny         bool
	Reads        int
	Params       []map[string]string
	BeforeRead   func(*websocket.Conn, string, int)
}

func New(t *testing.T) *Gateway {
	t.Helper()
	key := ed25519.NewKeyFromSeed(make([]byte, 32))
	raw, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "device.pem")
	if err = os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: raw}), 0600); err != nil {
		t.Fatal(err)
	}
	g := &Gateway{Config: config.OpenClawNotepadGateway{ID: "fixture", Token: "fixture-token-do-not-forward", PrivateKeyFile: path}, sockets: map[*websocket.Conn]bool{}, cards: map[string]any{}, Methods: []string{"progressCard.get", "sessions.messages.subscribe", "sessions.messages.unsubscribe"}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		ctx := r.Context()
		g.mu.Lock()
		g.sockets[socket] = true
		g.mu.Unlock()
		defer func() { g.mu.Lock(); delete(g.sockets, socket); g.mu.Unlock() }()
		send := func(v any) { body, _ := json.Marshal(v); _ = socket.Write(ctx, websocket.MessageText, body) }
		send(map[string]any{"type": "event", "event": "connect.challenge", "payload": map[string]any{"nonce": "fixture-nonce", "ts": time.Now().UnixMilli()}})
		for {
			_, body, err := socket.Read(ctx)
			if err != nil {
				return
			}
			var req struct {
				ID, Method string
				Params     json.RawMessage
			}
			if json.Unmarshal(body, &req) != nil {
				return
			}
			var payload any
			switch req.Method {
			case "connect":
				var p struct {
					MinProtocol, MaxProtocol int
					Client                   struct{ ID, Mode, Platform string }
					Role                     string
					Scopes                   []string
					Auth                     struct{ Token string }
					Device                   struct {
						ID, PublicKey, Signature, Nonce string
						SignedAt                        int64
					}
				}
				if json.Unmarshal(req.Params, &p) != nil {
					return
				}
				public, _ := base64.RawURLEncoding.DecodeString(p.Device.PublicKey)
				signature, _ := base64.RawURLEncoding.DecodeString(p.Device.Signature)
				hash := sha256.Sum256(public)
				signed := strings.Join([]string{"v3", p.Device.ID, p.Client.ID, p.Client.Mode, p.Role, strings.Join(p.Scopes, ","), strconv.FormatInt(p.Device.SignedAt, 10), p.Auth.Token, p.Device.Nonce, p.Client.Platform, ""}, "|")
				valid := p.MinProtocol == 4 && p.MaxProtocol == 4 && p.Client.ID == "gateway-client" && p.Client.Mode == "backend" && p.Role == "operator" && strings.Join(p.Scopes, ",") == "operator.read" && p.Auth.Token == g.Config.Token && p.Device.ID == hex.EncodeToString(hash[:]) && p.Device.Nonce == "fixture-nonce" && len(public) == 32 && ed25519.Verify(public, []byte(signed), signature)
				if !valid {
					t.Error("invalid signed v4 handshake")
					return
				}
				if g.ConnectError != "" {
					send(map[string]any{"type": "res", "id": req.ID, "ok": false, "error": map[string]any{"code": "INVALID_REQUEST", "details": map[string]string{"code": g.ConnectError}}})
					continue
				}
				payload = map[string]any{"type": "hello-ok", "protocol": 4, "policy": map[string]int{"tickIntervalMs": 30000}, "features": map[string]any{"methods": g.Methods, "events": []string{"progressCard.changed"}}, "auth": map[string]any{"role": "operator", "scopes": []string{"operator.read"}}}
			case "sessions.messages.subscribe", "progressCard.get":
				var p map[string]string
				_ = json.Unmarshal(req.Params, &p)
				key := p["sessionKey"]
				if key == "" {
					key = p["key"]
				}
				if !strings.HasPrefix(key, "agent:") {
					key = "agent:" + p["agentId"] + ":" + key
				}
				if req.Method == "sessions.messages.subscribe" {
					payload = map[string]any{"subscribed": true, "key": key}
				} else {
					g.mu.Lock()
					g.Reads++
					reads := g.Reads
					g.Params = append(g.Params, p)
					card := g.cards[key]
					deny := g.Deny
					before := g.BeforeRead
					g.mu.Unlock()
					if before != nil {
						before(socket, key, reads)
					}
					if deny {
						send(map[string]any{"type": "res", "id": req.ID, "ok": false, "error": map[string]any{"code": "INVALID_REQUEST", "details": map[string]string{"code": "SESSION_PARTICIPATION_REQUIRED"}}})
						continue
					}
					payload = map[string]any{"card": card}
				}
			default:
				t.Errorf("unexpected gateway mutation/method %s", req.Method)
				return
			}
			// Tick events may interleave with every response, including hello.
			send(map[string]any{"type": "event", "event": "tick", "payload": map[string]int{"ts": 1}})
			send(map[string]any{"type": "res", "id": req.ID, "ok": true, "payload": payload})
		}
	}))
	g.Config.URL = "ws" + strings.TrimPrefix(server.URL, "http")
	t.Cleanup(func() { g.Disconnect(); server.Close() })
	return g
}
func (g *Gateway) Set(key string, card any) { g.mu.Lock(); g.cards[key] = card; g.mu.Unlock() }
func (g *Gateway) Change(key string, revision any) {
	g.mu.Lock()
	sockets := make([]*websocket.Conn, 0, len(g.sockets))
	for s := range g.sockets {
		sockets = append(sockets, s)
	}
	g.mu.Unlock()
	for _, s := range sockets {
		body, _ := json.Marshal(map[string]any{"type": "event", "event": "progressCard.changed", "payload": map[string]any{"sessionKey": key, "revision": revision}})
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		_ = s.Write(ctx, websocket.MessageText, body)
		cancel()
	}
}
func (g *Gateway) Disconnect() {
	g.mu.Lock()
	defer g.mu.Unlock()
	for socket := range g.sockets {
		socket.CloseNow()
	}
}
func Card(key, markdown string, revision int) map[string]any {
	return map[string]any{"sessionKey": key, "markdown": markdown, "revision": revision, "updatedAt": 1234, "steps": []map[string]string{{"step": "Inspect", "status": "completed"}}}
}
