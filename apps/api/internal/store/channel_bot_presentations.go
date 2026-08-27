package store

import (
	"errors"
	"net/url"
	"strings"
	"unicode/utf8"
)

const (
	MaxChannelBotPresentationNameRunes = 200
	MaxChannelBotPresentationAvatarURL = 500
)

func NormalizeChannelBotPresentation(displayName, avatarURL string) (string, string, error) {
	name := strings.TrimSpace(displayName)
	if name == "" {
		return "", "", errors.New("display_name is required")
	}
	if !utf8.ValidString(name) || strings.IndexByte(name, 0) >= 0 {
		return "", "", errors.New("display_name must be valid UTF-8 without NUL")
	}
	if utf8.RuneCountInString(name) > MaxChannelBotPresentationNameRunes {
		return "", "", errors.New("display_name is too long")
	}

	avatar := strings.TrimSpace(avatarURL)
	if len(avatar) > MaxChannelBotPresentationAvatarURL {
		return "", "", errors.New("avatar_url is too long")
	}
	if avatar != "" {
		parsed, err := url.Parse(avatar)
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
			return "", "", errors.New("avatar_url must be an http or https URL")
		}
	}
	return name, avatar, nil
}
