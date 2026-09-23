package store

import (
	"errors"
	"strings"
	"unicode/utf8"
)

const BotRuntimeStatusTTLSeconds = 90

type BotRuntimeStatusSnapshot struct {
	Runtime       string `json:"runtime"`
	ModelProvider string `json:"model_provider"`
	ModelID       string `json:"model_id"`
	Reasoning     string `json:"reasoning"`
	FastMode      *bool  `json:"fast_mode"`
}

type BotRuntimeStatus struct {
	WorkspaceID          string `json:"workspace_id"`
	ChannelID            string `json:"channel_id,omitempty"`
	DirectConversationID string `json:"direct_conversation_id,omitempty"`
	BotUserID            string `json:"bot_user_id"`
	BotRuntimeStatusSnapshot
	UpdatedAt string `json:"updated_at"`
	ExpiresAt string `json:"expires_at"`
}

type PublishBotRuntimeStatusInput struct {
	WorkspaceID          string
	ChannelID            string
	DirectConversationID string
	BotUserID            string
	Snapshot             BotRuntimeStatusSnapshot
}

func (s BotRuntimeStatusSnapshot) Validate() error {
	validText := func(value string, max int) bool {
		return strings.TrimSpace(value) != "" && utf8.ValidString(value) && utf8.RuneCountInString(value) <= max && !strings.ContainsRune(value, 0)
	}
	if (s.Runtime != "pi" && s.Runtime != "openclaw") || !validText(s.ModelProvider, 128) || !validText(s.ModelID, 256) || !validText(s.Reasoning, 64) {
		return errors.New("invalid bot runtime status")
	}
	return nil
}
