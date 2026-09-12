package notepad

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/coder/websocket"
	"github.com/openclaw/clickclack/apps/api/internal/config"
	"github.com/openclaw/clickclack/apps/api/internal/notepad/notepadtest"
	"testing"
	"time"
)

func TestGatewayIdentityLifecycle(t *testing.T) {
	g := notepadtest.New(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	a := "agent:alice:global"
	b := "agent:bob:global"
	g.Set(a, notepadtest.Card(a, "alice", 1))
	g.Set(b, notepadtest.Card(b, "bob", 2))
	ca, err := Dial(ctx, g.Config, config.OpenClawNotepadBinding{AgentID: "alice", SessionKey: "global"})
	if err != nil {
		t.Fatal(err)
	}
	defer ca.Close()
	cb, err := Dial(ctx, g.Config, config.OpenClawNotepadBinding{AgentID: "bob", SessionKey: "global"})
	if err != nil {
		t.Fatal(err)
	}
	defer cb.Close()
	card, err := ca.Get(ctx)
	if err != nil || *card.Markdown != "alice" {
		t.Fatalf("alice: %v %v", card, err)
	}
	card, err = cb.Get(ctx)
	if err != nil || *card.Markdown != "bob" {
		t.Fatalf("bob: %v %v", card, err)
	}
	g.Change("agent:other:global", 9)
	select {
	case <-ca.Changes:
		t.Fatal("unrelated event delivered")
	case <-time.After(20 * time.Millisecond):
	}
	g.Set(a, nil)
	g.Change(a, nil)
	select {
	case <-ca.Changes:
	case <-ctx.Done():
		t.Fatal("missing clear invalidation")
	}
	card, err = ca.Get(ctx)
	if err != nil || card != nil {
		t.Fatalf("clear: %v %v", card, err)
	}
	select {
	case <-cb.Changes:
		t.Fatal("cross-owner invalidation")
	default:
	}
	g.Disconnect()
	select {
	case <-ca.Done():
	case <-ctx.Done():
		t.Fatal("disconnect not detected")
	}
	ca.Close()
	g.Set(a, notepadtest.Card(a, "reconnected", 1))
	next, err := Dial(ctx, g.Config, config.OpenClawNotepadBinding{AgentID: "alice", SessionKey: "global"})
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	card, err = next.Get(ctx)
	if err != nil || *card.Markdown != "reconnected" {
		t.Fatal(card, err)
	}
}
func TestGatewayInvalidationDuringRead(t *testing.T) {
	g := notepadtest.New(t)
	key := "agent:alice:global"
	g.Set(key, notepadtest.Card(key, "old", 1))
	g.BeforeRead = func(socket *websocket.Conn, key string, reads int) {
		if reads == 1 {
			g.Set(key, notepadtest.Card(key, "new", 2))
			g.Change(key, 2)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, err := Dial(ctx, g.Config, config.OpenClawNotepadBinding{AgentID: "alice", SessionKey: "global"})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	card, err := c.Get(ctx)
	if err != nil || *card.Markdown != "new" {
		t.Fatalf("stale response accepted: %v %v", card, err)
	}
}
func TestGatewayMissingMethodsAndDenied(t *testing.T) {
	for _, missing := range []bool{true, false} {
		t.Run(map[bool]string{true: "unsupported", false: "denied"}[missing], func(t *testing.T) {
			g := notepadtest.New(t)
			if missing {
				g.Methods = []string{}
			} else {
				g.Deny = true
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			c, err := Dial(ctx, g.Config, config.OpenClawNotepadBinding{AgentID: "alice", SessionKey: "global"})
			if missing {
				if !errors.Is(err, Unsupported) {
					t.Fatal(err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			_, err = c.Get(ctx)
			if !errors.Is(err, Denied) {
				t.Fatal(err)
			}
		})
	}
}
func TestParseCardValidation(t *testing.T) {
	key := "agent:a:global"
	for _, body := range []string{`{}`, `{"card":{}}`, `{"card":{"sessionKey":"agent:b:global","revision":1,"updatedAt":1,"markdown":"secret"}}`, `{"card":{"sessionKey":"agent:a:global","revision":1,"updatedAt":1,"steps":[{"step":"x","status":"bad"}]}}`, `{"card":{"sessionKey":"agent:a:global","revision":1.5,"updatedAt":1,"markdown":"x"}}`} {
		if _, err := parseCard(json.RawMessage(body), key); err == nil {
			t.Errorf("accepted %s", body)
		}
	}
	if card, err := parseCard(json.RawMessage(`{"card":null}`), key); err != nil || card != nil {
		t.Fatal(card, err)
	}
}

func TestGatewayConnectFailures(t *testing.T) {
	for code, want := range map[string]State{"AUTH_TOKEN_MISMATCH": Denied, "PAIRING_REQUIRED": Denied, "PROTOCOL_MISMATCH": Unsupported} {
		t.Run(code, func(t *testing.T) {
			g := notepadtest.New(t)
			g.ConnectError = code
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			c, err := Dial(ctx, g.Config, config.OpenClawNotepadBinding{AgentID: "a", SessionKey: "global"})
			if c != nil {
				c.Close()
				t.Fatal("accepted rejected gateway connection")
			}
			if !errors.Is(err, want) {
				t.Fatalf("want %s, got %v", want, err)
			}
		})
	}
}

func TestGatewayConnectionsDoNotShareSnapshots(t *testing.T) {
	first := notepadtest.New(t)
	second := notepadtest.New(t)
	key := "agent:a:global"
	first.Set(key, notepadtest.Card(key, "first gateway", 9))
	second.Set(key, notepadtest.Card(key, "second gateway", 1))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, test := range []struct {
		gateway config.OpenClawNotepadGateway
		want    string
	}{{first.Config, "first gateway"}, {second.Config, "second gateway"}} {
		c, err := Dial(ctx, test.gateway, config.OpenClawNotepadBinding{AgentID: "a", SessionKey: "global"})
		if err != nil {
			t.Fatal(err)
		}
		card, err := c.Get(ctx)
		c.Close()
		if err != nil || card == nil || *card.Markdown != test.want {
			t.Fatal(card, err)
		}
	}
}
