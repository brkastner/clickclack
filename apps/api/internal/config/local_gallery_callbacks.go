package config

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// LocalGalleryCallback is an operator-only exception for a gallery producer on
// this host. It deliberately permits one canonical loopback endpoint for one
// installed bot, rather than weakening the general callback SSRF policy.
type LocalGalleryCallback struct {
	InstallationID string `json:"installation_id"`
	CallbackURL    string `json:"callback_url"`
}

func NormalizeLocalGalleryCallbacks(callbacks []LocalGalleryCallback) ([]LocalGalleryCallback, error) {
	seenInstallations := make(map[string]struct{}, len(callbacks))
	seenURLs := make(map[string]struct{}, len(callbacks))
	normalized := make([]LocalGalleryCallback, 0, len(callbacks))
	for _, callback := range callbacks {
		installationID := strings.TrimSpace(callback.InstallationID)
		if installationID == "" {
			return nil, fmt.Errorf("local_gallery_callbacks installation_id is required")
		}
		callbackURL, err := canonicalLocalGalleryCallbackURL(callback.CallbackURL)
		if err != nil {
			return nil, err
		}
		if _, exists := seenInstallations[installationID]; exists {
			return nil, fmt.Errorf("local_gallery_callbacks repeats installation_id %q", installationID)
		}
		if _, exists := seenURLs[callbackURL]; exists {
			return nil, fmt.Errorf("local_gallery_callbacks repeats callback_url %q", callbackURL)
		}
		seenInstallations[installationID] = struct{}{}
		seenURLs[callbackURL] = struct{}{}
		normalized = append(normalized, LocalGalleryCallback{InstallationID: installationID, CallbackURL: callbackURL})
	}
	return normalized, nil
}

func canonicalLocalGalleryCallbackURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "/gallery-actions" {
		return "", fmt.Errorf("local_gallery_callbacks callback_url must be canonical http://127.0.0.1:<port>/gallery-actions")
	}
	host, port, err := net.SplitHostPort(parsed.Host)
	if err != nil || host != "127.0.0.1" {
		return "", fmt.Errorf("local_gallery_callbacks callback_url must be canonical http://127.0.0.1:<port>/gallery-actions")
	}
	portNumber, err := strconv.ParseUint(port, 10, 16)
	if err != nil || portNumber == 0 || strconv.FormatUint(portNumber, 10) != port {
		return "", fmt.Errorf("local_gallery_callbacks callback_url must use an explicit canonical port")
	}
	canonical := "http://127.0.0.1:" + port + "/gallery-actions"
	if value != canonical {
		return "", fmt.Errorf("local_gallery_callbacks callback_url must be canonical http://127.0.0.1:<port>/gallery-actions")
	}
	return canonical, nil
}
