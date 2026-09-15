package httpapi

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/openclaw/clickclack/apps/api/internal/store"
)

// appLinkScheme is the URL scheme the desktop and mobile clients register. One
// scheme across every ClickClack shell means a single server-issued link opens
// the conversation on whichever client the operating system hands it to.
const appLinkScheme = "clickclack"

// AppLinkMode selects the link a push notification carries.
type AppLinkMode string

const (
	// AppLinkModeApp issues clickclack:// links, which open the desktop or
	// mobile client directly. This is the default: push notifications are read
	// on a phone, where the installed app is the useful destination.
	AppLinkModeApp AppLinkMode = "app"
	// AppLinkModeWeb issues https links to the configured public URL, for
	// deployments whose members read notifications without an installed client.
	AppLinkModeWeb AppLinkMode = "web"
	// AppLinkModeOff sends notifications with no link at all.
	AppLinkModeOff AppLinkMode = "off"
)

// DefaultAppLinkMode is used when nothing is configured.
const DefaultAppLinkMode = AppLinkModeApp

// ParseAppLinkMode validates a configured mode. An empty value takes the default.
func ParseAppLinkMode(value string) (AppLinkMode, error) {
	switch AppLinkMode(strings.ToLower(strings.TrimSpace(value))) {
	case "":
		return DefaultAppLinkMode, nil
	case AppLinkModeApp:
		return AppLinkModeApp, nil
	case AppLinkModeWeb:
		return AppLinkModeWeb, nil
	case AppLinkModeOff:
		return AppLinkModeOff, nil
	default:
		return "", fmt.Errorf("app link mode must be one of app, web, off (got %q)", value)
	}
}

// messageAppRoute is the in-app route that shows a message: its thread for a
// reply, otherwise the channel or direct conversation it landed in. Raw
// identifiers are used deliberately — the app canonicalizes a legacy route pair
// into the shareable route, and allocating route IDs here would put a database
// write on the notification path.
func messageAppRoute(message store.Message) string {
	if message.WorkspaceID == "" {
		return ""
	}
	var target string
	switch {
	case message.ParentMessageID != nil && message.ThreadRootID != "":
		target = message.ThreadRootID
	case message.ChannelID != "":
		target = message.ChannelID
	default:
		target = message.DirectConversationID
	}
	if target == "" {
		return ""
	}
	return "/app/" + url.PathEscape(message.WorkspaceID) + "/" + url.PathEscape(target)
}

// appDeepLink renders an in-app route as a link for the configured mode, or ""
// when no link can be built. The clickclack://open?path= shape matches what the
// desktop client already accepts and what the web app parses back out.
func appDeepLink(mode AppLinkMode, frontendURL, route string) string {
	if route == "" || mode == AppLinkModeOff {
		return ""
	}
	if mode == AppLinkModeWeb {
		base := strings.TrimSpace(frontendURL)
		if base == "" {
			return ""
		}
		parsed, err := url.Parse(base)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return ""
		}
		reference, err := url.Parse(route)
		if err != nil {
			return ""
		}
		return parsed.ResolveReference(reference).String()
	}
	return appLinkScheme + "://open?path=" + url.QueryEscape(route)
}

// appLinkModeOrDefault keeps an unset server option on the documented default.
func appLinkModeOrDefault(mode AppLinkMode) AppLinkMode {
	if mode == "" {
		return DefaultAppLinkMode
	}
	return mode
}
