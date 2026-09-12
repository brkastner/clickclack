package config

import (
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
)

var notepadAgentID = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

func normalizeOpenClawNotepadConfig(c *OpenClawNotepadConfig) error {
	gateways := map[string]bool{}
	for i, g := range c.Gateways {
		u, err := url.Parse(g.URL)
		if g.ID == "" || gateways[g.ID] {
			return fmt.Errorf("openclaw_notepad.gateways[%d]: missing or duplicate id", i)
		}
		if err != nil || u.Host == "" || (u.Scheme != "ws" && u.Scheme != "wss") || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
			return fmt.Errorf("openclaw_notepad.gateways[%d]: require ws/wss URL without credentials, query or fragment", i)
		}
		if u.Scheme == "ws" && !isLoopbackHost(u.Hostname()) {
			return fmt.Errorf("openclaw_notepad.gateways[%d]: require wss outside loopback", i)
		}
		hasToken := strings.TrimSpace(g.Token) != ""
		hasPassword := strings.TrimSpace(g.Password) != ""
		if hasToken == hasPassword || !filepath.IsAbs(g.PrivateKeyFile) {
			return fmt.Errorf("openclaw_notepad.gateways[%d]: exactly one nonblank token or password and an absolute private_key_file required", i)
		}
		gateways[g.ID] = true
	}
	seen := map[string]bool{}
	for i, b := range c.Bindings {
		if b.WorkspaceID == "" || !gateways[b.GatewayID] || !notepadAgentID.MatchString(b.AgentID) || strings.TrimSpace(b.SessionKey) != b.SessionKey || b.SessionKey == "" || strings.ContainsAny(b.SessionKey, "\x00\r\n") {
			return fmt.Errorf("openclaw_notepad.bindings[%d]: invalid target or unknown gateway", i)
		}
		if (b.ChannelID == "") == (b.DirectConversationID == "") {
			return fmt.Errorf("openclaw_notepad.bindings[%d]: exactly one channel_id or direct_conversation_id required", i)
		}
		if strings.HasPrefix(b.SessionKey, "agent:") {
			parts := strings.SplitN(b.SessionKey, ":", 3)
			if len(parts) != 3 || parts[1] != b.AgentID || parts[2] == "" {
				return fmt.Errorf("openclaw_notepad.bindings[%d]: session owner differs from agent_id", i)
			}
		}
		key := b.WorkspaceID + "\x00" + b.ChannelID + "\x00" + b.DirectConversationID
		if seen[key] {
			return fmt.Errorf("openclaw_notepad.bindings[%d]: duplicate conversation", i)
		}
		seen[key] = true
	}
	return nil
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
