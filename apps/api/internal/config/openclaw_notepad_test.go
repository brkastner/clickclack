package config

import "testing"

func TestNormalizeOpenClawNotepadConfig(t *testing.T) {
	valid := func() OpenClawNotepadConfig {
		return OpenClawNotepadConfig{Gateways: []OpenClawNotepadGateway{{ID: "gateway", URL: "wss://gateway.example.test", Token: "secret", PrivateKeyFile: "/keys/device.pem"}}, Bindings: []OpenClawNotepadBinding{{WorkspaceID: "w", ChannelID: "c", GatewayID: "gateway", AgentID: "agent", SessionKey: "agent:agent:channel:one"}}}
	}
	c := valid()
	if err := normalizeOpenClawNotepadConfig(&c); err != nil {
		t.Fatal(err)
	}
	empty := OpenClawNotepadConfig{}
	if err := normalizeOpenClawNotepadConfig(&empty); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*OpenClawNotepadConfig){
		"unknown gateway":    func(c *OpenClawNotepadConfig) { c.Bindings[0].GatewayID = "other" },
		"duplicate gateway":  func(c *OpenClawNotepadConfig) { c.Gateways = append(c.Gateways, c.Gateways[0]) },
		"duplicate binding":  func(c *OpenClawNotepadConfig) { c.Bindings = append(c.Bindings, c.Bindings[0]) },
		"ambiguous target":   func(c *OpenClawNotepadConfig) { c.Bindings[0].DirectConversationID = "d" },
		"wrong owner":        func(c *OpenClawNotepadConfig) { c.Bindings[0].AgentID = "other" },
		"invalid owner":      func(c *OpenClawNotepadConfig) { c.Bindings[0].AgentID = "agent:a" },
		"empty target":       func(c *OpenClawNotepadConfig) { c.Bindings[0].SessionKey = "" },
		"credentials in url": func(c *OpenClawNotepadConfig) { c.Gateways[0].URL = "wss://u:secret@example.test" },
		"query secret":       func(c *OpenClawNotepadConfig) { c.Gateways[0].URL = "wss://example.test/?token=secret" },
		"insecure transport": func(c *OpenClawNotepadConfig) { c.Gateways[0].URL = "ws://example.test" },
		"missing token":      func(c *OpenClawNotepadConfig) { c.Gateways[0].Token = "" },
		"relative key":       func(c *OpenClawNotepadConfig) { c.Gateways[0].PrivateKeyFile = "device.pem" },
	} {
		t.Run(name, func(t *testing.T) {
			c := valid()
			mutate(&c)
			if normalizeOpenClawNotepadConfig(&c) == nil {
				t.Fatal("accepted invalid config")
			}
		})
	}
	c = valid()
	c.Gateways[0].URL = "ws://127.0.0.1:1"
	if err := normalizeOpenClawNotepadConfig(&c); err != nil {
		t.Fatal(err)
	}
}
