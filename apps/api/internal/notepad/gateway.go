// Package notepad implements the read-only OpenClaw Gateway v4 progress-card subset.
// Wire reference: persona-workstation packages/gateway-protocol schema/frames.ts,
// schema/progress-card.ts, gateway-client/device-auth.ts and sessions-subscriptions.ts.
package notepad

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/openclaw/clickclack/apps/api/internal/config"
)

type State string

const (
	Ready       State = "ready"
	Unmapped    State = "unmapped"
	Unsupported State = "unsupported"
	Denied      State = "denied"
	Unavailable State = "unavailable"
)

func (s State) Error() string { return string(s) }
func ErrorState(err error) State {
	var state State
	if errors.As(err, &state) {
		return state
	}
	return Unavailable
}

type Step struct {
	Step   string `json:"step"`
	Status string `json:"status"`
}
type Card struct {
	SessionKey string  `json:"-"`
	Revision   int64   `json:"revision"`
	UpdatedAt  int64   `json:"updatedAt"`
	Markdown   *string `json:"markdown,omitempty"`
	Steps      []Step  `json:"steps,omitempty"`
}
type Result struct {
	State State `json:"state"`
	Card  *Card `json:"card"`
}
type frame struct {
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	Event   string          `json:"event"`
	OK      bool            `json:"ok"`
	Payload json.RawMessage `json:"payload"`
	Seq     *uint64         `json:"seq"`
	Error   struct {
		Code    string `json:"code"`
		Details struct {
			Code string `json:"code"`
		} `json:"details"`
	} `json:"error"`
}

// A connection owns exactly one captured target. Nothing is cached across users,
// bindings or connections. Closing it releases the gateway's observation registry.
type Connection struct {
	conn       *websocket.Conn
	ctx        context.Context
	cancel     context.CancelFunc
	mu         sync.Mutex
	pending    map[string]chan frame
	sequence   atomic.Uint64
	generation atomic.Uint64
	lastFrame  atomic.Int64
	Changes    chan struct{}
	wireKey    string
	target     config.OpenClawNotepadBinding
}

func (c *Connection) Done() <-chan struct{} { return c.ctx.Done() }
func (c *Connection) Close()                { c.cancel(); _ = c.conn.CloseNow() }

func Dial(ctx context.Context, gateway config.OpenClawNotepadGateway, target config.OpenClawNotepadBinding) (*Connection, error) {
	key, err := readDeviceKey(gateway.PrivateKeyFile)
	if err != nil {
		return nil, Unavailable
	}
	handshake, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	socket, _, err := websocket.Dial(handshake, gateway.URL, nil)
	if err != nil {
		return nil, Unavailable
	}
	socket.SetReadLimit(8 << 20) // hello includes the gateway snapshot; never forward it.
	var challenge frame
	if err = readFrame(handshake, socket, &challenge); err != nil {
		socket.CloseNow()
		return nil, Unavailable
	}
	var payload struct {
		Nonce string `json:"nonce"`
		TS    int64  `json:"ts"`
	}
	if challenge.Type != "event" || challenge.Event != "connect.challenge" || json.Unmarshal(challenge.Payload, &payload) != nil || payload.Nonce == "" || len(payload.Nonce) > 4096 || payload.TS <= 0 {
		socket.CloseNow()
		return nil, Unavailable
	}
	connCtx, stop := context.WithCancel(ctx)
	c := &Connection{conn: socket, ctx: connCtx, cancel: stop, pending: map[string]chan frame{}, Changes: make(chan struct{}, 1), target: target}
	c.lastFrame.Store(time.Now().UnixMilli())
	go c.readLoop()
	go func() { <-connCtx.Done(); socket.CloseNow() }()
	fail := func(err error) (*Connection, error) { c.Close(); return nil, err }
	public := key.Public().(ed25519.PublicKey)
	hash := sha256.Sum256(public)
	deviceID := hex.EncodeToString(hash[:])
	signedAt := time.Now().UnixMilli()
	auth := map[string]string{"token": gateway.Token}
	signatureCredential := gateway.Token
	if strings.TrimSpace(gateway.Password) != "" {
		auth = map[string]string{"password": gateway.Password}
		// Gateway v3 binds an auth token into the device signature. Password-mode
		// sessions intentionally use an empty field rather than the password.
		signatureCredential = ""
	}
	signaturePayload := strings.Join([]string{"v3", deviceID, "gateway-client", "backend", "operator", "operator.read", strconv.FormatInt(signedAt, 10), signatureCredential, payload.Nonce, "server", ""}, "|")
	params := map[string]any{
		"minProtocol": 4, "maxProtocol": 4,
		"client": map[string]string{"id": "gateway-client", "displayName": "ClickClack notepad", "version": "1", "platform": "server", "mode": "backend"},
		"caps":   []string{"session-scoped-events"}, "role": "operator", "scopes": []string{"operator.read"}, "auth": auth,
		"device": map[string]any{"id": deviceID, "publicKey": base64.RawURLEncoding.EncodeToString(public), "signature": base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(signaturePayload))), "signedAt": signedAt, "nonce": payload.Nonce},
	}
	raw, err := c.request(handshake, "connect", params)
	if err != nil {
		return fail(err)
	}
	var hello struct {
		Type     string `json:"type"`
		Protocol int    `json:"protocol"`
		Policy   struct {
			TickIntervalMs int64 `json:"tickIntervalMs"`
		} `json:"policy"`
		Features struct {
			Methods []string `json:"methods"`
			Events  []string `json:"events"`
		} `json:"features"`
		Auth struct {
			Role   string   `json:"role"`
			Scopes []string `json:"scopes"`
		} `json:"auth"`
	}
	if json.Unmarshal(raw, &hello) != nil || hello.Type != "hello-ok" || hello.Protocol != 4 {
		return fail(Unsupported)
	}
	if hello.Auth.Role != "operator" || (!slices.Contains(hello.Auth.Scopes, "operator.read") && !slices.Contains(hello.Auth.Scopes, "operator.admin")) {
		return fail(Denied)
	}
	for _, method := range []string{"progressCard.get", "sessions.messages.subscribe", "sessions.messages.unsubscribe"} {
		if !slices.Contains(hello.Features.Methods, method) {
			return fail(Unsupported)
		}
	}
	if !slices.Contains(hello.Features.Events, "progressCard.changed") {
		return fail(Unsupported)
	}
	raw, err = c.request(handshake, "sessions.messages.subscribe", map[string]string{"key": target.SessionKey, "agentId": target.AgentID})
	if err != nil {
		return fail(err)
	}
	var observed struct {
		Subscribed bool   `json:"subscribed"`
		Key        string `json:"key"`
	}
	if json.Unmarshal(raw, &observed) != nil || !observed.Subscribed || observed.Key == "" {
		return fail(Unavailable)
	}
	wireKey := observed.Key
	if !strings.HasPrefix(wireKey, "agent:") {
		wireKey = "agent:" + target.AgentID + ":" + wireKey
	}
	// Owner-qualified replies must not redirect to another configured agent.
	if !strings.HasPrefix(wireKey, "agent:"+target.AgentID+":") {
		return fail(Unavailable)
	}
	c.mu.Lock()
	c.wireKey = wireKey
	c.mu.Unlock()
	if hello.Policy.TickIntervalMs < 1 || hello.Policy.TickIntervalMs > 120000 {
		return fail(Unavailable)
	}
	idleLimit := max(10000, hello.Policy.TickIntervalMs*3)
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-c.ctx.Done():
				return
			case <-ticker.C:
				if time.Now().UnixMilli()-c.lastFrame.Load() > idleLimit {
					c.Close()
					return
				}
			}
		}
	}()
	// Subscribe is not participation authorization. The caller must successfully
	// Get before declaring the watch ready; the gateway enforces session access.
	return c, nil
}

func readDeviceKey(path string) (ed25519.PrivateKey, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 16384 || info.Mode().Perm()&0077 != 0 {
		return nil, Unavailable
	}
	body := make([]byte, info.Size())
	if _, err = io.ReadFull(file, body); err != nil {
		return nil, err
	}
	block, _ := pem.Decode(body)
	if block == nil {
		return nil, Unavailable
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, Unavailable
	}
	return key, nil
}
func readFrame(ctx context.Context, conn *websocket.Conn, f *frame) error {
	kind, body, err := conn.Read(ctx)
	if err != nil {
		return err
	}
	if kind != websocket.MessageText {
		return Unavailable
	}
	return json.Unmarshal(body, f)
}
func (c *Connection) invalidate() {
	c.generation.Add(1)
	select {
	case c.Changes <- struct{}{}:
	default:
	}
}
func (c *Connection) readLoop() {
	defer c.Close()
	var lastSeq *uint64
	for {
		var f frame
		if readFrame(c.ctx, c.conn, &f) != nil {
			return
		}
		c.lastFrame.Store(time.Now().UnixMilli())
		if f.Type == "res" {
			c.mu.Lock()
			pending := c.pending[f.ID]
			c.mu.Unlock()
			if pending != nil {
				select {
				case pending <- f:
				default:
				}
			}
		} else if f.Type == "event" {
			if f.Seq != nil {
				if lastSeq != nil && *f.Seq != *lastSeq+1 {
					c.invalidate()
				}
				lastSeq = f.Seq
			}
			if f.Event == "shutdown" {
				return
			}
			if f.Event != "progressCard.changed" {
				continue
			}
			var event struct {
				SessionKey string          `json:"sessionKey"`
				Revision   json.RawMessage `json:"revision"`
			}
			if json.Unmarshal(f.Payload, &event) != nil {
				return
			}
			if len(event.Revision) == 0 {
				return
			}
			if string(event.Revision) != "null" {
				var revision int64
				if json.Unmarshal(event.Revision, &revision) != nil || revision < 1 {
					return
				}
			}
			c.mu.Lock()
			key := c.wireKey
			c.mu.Unlock()
			if key == "" || key == event.SessionKey {
				c.invalidate()
			}
		} else {
			return
		}
	}
}
func (c *Connection) request(ctx context.Context, method string, params any) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	id := fmt.Sprintf("notepad-%d", c.sequence.Add(1))
	response := make(chan frame, 1)
	c.mu.Lock()
	c.pending[id] = response
	c.mu.Unlock()
	defer func() { c.mu.Lock(); delete(c.pending, id); c.mu.Unlock() }()
	body, _ := json.Marshal(map[string]any{"type": "req", "id": id, "method": method, "params": params})
	if c.conn.Write(ctx, websocket.MessageText, body) != nil {
		return nil, Unavailable
	}
	select {
	case <-ctx.Done():
		return nil, Unavailable
	case <-c.ctx.Done():
		return nil, Unavailable
	case f := <-response:
		if !f.OK {
			if f.Error.Details.Code == "SESSION_PARTICIPATION_REQUIRED" || f.Error.Details.Code == "SESSION_ACCESS_DENIED" {
				return nil, Denied
			}
			code := f.Error.Details.Code
			if code == "PROTOCOL_MISMATCH" {
				return nil, Unsupported
			}
			if strings.HasPrefix(code, "AUTH_") || strings.HasPrefix(code, "DEVICE_") || code == "PAIRING_REQUIRED" || code == "CONTROL_UI_DEVICE_IDENTITY_REQUIRED" {
				return nil, Denied
			}
			return nil, Unavailable
		}
		return f.Payload, nil
	}
}
func (c *Connection) Get(ctx context.Context) (*Card, error) {
	// An invalidation racing a read retires that response. There is only one
	// trailing read at a time, bounded by the caller deadline, never a retry swarm.
	for {
		if ctx.Err() != nil {
			return nil, Unavailable
		}
		generation := c.generation.Load()
		raw, err := c.request(ctx, "progressCard.get", map[string]string{"sessionKey": c.target.SessionKey, "agentId": c.target.AgentID})
		if err != nil {
			return nil, err
		}
		card, err := parseCard(raw, c.wireKey)
		if err != nil {
			return nil, err
		}
		if generation == c.generation.Load() {
			return card, nil
		}
	}
}
func parseCard(raw json.RawMessage, key string) (*Card, error) {
	var envelope map[string]json.RawMessage
	if json.Unmarshal(raw, &envelope) != nil || len(envelope["card"]) == 0 {
		return nil, Unavailable
	}
	if string(envelope["card"]) == "null" {
		return nil, nil
	}
	var wire struct {
		SessionKey string  `json:"sessionKey"`
		Revision   int64   `json:"revision"`
		UpdatedAt  *int64  `json:"updatedAt"`
		Markdown   *string `json:"markdown"`
		Steps      []Step  `json:"steps"`
	}
	if json.Unmarshal(envelope["card"], &wire) != nil || wire.SessionKey != key || wire.Revision < 1 || wire.Revision > 9007199254740991 || wire.UpdatedAt == nil || *wire.UpdatedAt < 0 || *wire.UpdatedAt > 8640000000000000 || len(wire.Steps) > 50 {
		return nil, Unavailable
	}
	if wire.Markdown == nil && len(wire.Steps) == 0 {
		return nil, Unavailable
	}
	if wire.Markdown != nil && len(*wire.Markdown) > 8192 {
		return nil, Unavailable
	}
	for _, s := range wire.Steps {
		if s.Step == "" || len(s.Step) > 512 || !slices.Contains([]string{"pending", "in_progress", "completed"}, s.Status) {
			return nil, Unavailable
		}
	}
	return &Card{SessionKey: key, Revision: wire.Revision, UpdatedAt: *wire.UpdatedAt, Markdown: wire.Markdown, Steps: wire.Steps}, nil
}
