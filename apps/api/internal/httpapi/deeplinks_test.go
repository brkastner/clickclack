package httpapi

import (
	"context"
	"net/url"
	"path/filepath"
	"testing"

	"github.com/openclaw/clickclack/apps/api/internal/realtime"
	"github.com/openclaw/clickclack/apps/api/internal/store"
	sqlitestore "github.com/openclaw/clickclack/apps/api/internal/store/sqlite"
)

func TestParseAppLinkMode(t *testing.T) {
	t.Parallel()
	for input, want := range map[string]AppLinkMode{
		"":      DefaultAppLinkMode,
		"app":   AppLinkModeApp,
		" Web ": AppLinkModeWeb,
		"OFF":   AppLinkModeOff,
	} {
		got, err := ParseAppLinkMode(input)
		if err != nil {
			t.Fatalf("ParseAppLinkMode(%q): %v", input, err)
		}
		if got != want {
			t.Fatalf("ParseAppLinkMode(%q) = %q, want %q", input, got, want)
		}
	}
	if _, err := ParseAppLinkMode("email"); err == nil {
		t.Fatal("expected an unknown app link mode to be rejected")
	}
}

func TestMessageAppRoute(t *testing.T) {
	t.Parallel()
	parent := "msg_parent"
	for name, test := range map[string]struct {
		message store.Message
		want    string
	}{
		"channel message": {
			message: store.Message{WorkspaceID: "wsp_1", ChannelID: "chn_1"},
			want:    "/app/wsp_1/chn_1",
		},
		"direct message": {
			message: store.Message{WorkspaceID: "wsp_1", DirectConversationID: "dm_1"},
			want:    "/app/wsp_1/dm_1",
		},
		"thread reply lands in its thread": {
			message: store.Message{
				WorkspaceID:     "wsp_1",
				ChannelID:       "chn_1",
				ParentMessageID: &parent,
				ThreadRootID:    "msg_root",
			},
			want: "/app/wsp_1/msg_root",
		},
		"message with no target": {
			message: store.Message{WorkspaceID: "wsp_1"},
			want:    "",
		},
		"message with no workspace": {
			message: store.Message{ChannelID: "chn_1"},
			want:    "",
		},
	} {
		if got := messageAppRoute(test.message); got != test.want {
			t.Fatalf("%s: messageAppRoute = %q, want %q", name, got, test.want)
		}
	}
}

func TestAppDeepLink(t *testing.T) {
	t.Parallel()
	route := "/app/wsp_1/chn_1"
	if got := appDeepLink(AppLinkModeApp, "https://chat.example.com", route); got != "clickclack://open?path=%2Fapp%2Fwsp_1%2Fchn_1" {
		t.Fatalf("unexpected app link %q", got)
	}
	if got := appDeepLink(AppLinkModeWeb, "https://chat.example.com", route); got != "https://chat.example.com/app/wsp_1/chn_1" {
		t.Fatalf("unexpected web link %q", got)
	}
	if got := appDeepLink(AppLinkModeWeb, "https://chat.example.com/", route); got != "https://chat.example.com/app/wsp_1/chn_1" {
		t.Fatalf("unexpected web link for a trailing slash %q", got)
	}
	if got := appDeepLink(AppLinkModeOff, "https://chat.example.com", route); got != "" {
		t.Fatalf("expected no link when links are off, got %q", got)
	}
	if got := appDeepLink(AppLinkModeApp, "https://chat.example.com", ""); got != "" {
		t.Fatalf("expected no link without a route, got %q", got)
	}
	// Web links need a public URL to be absolute; a relative one is no link.
	if got := appDeepLink(AppLinkModeWeb, "", route); got != "" {
		t.Fatalf("expected no web link without a public URL, got %q", got)
	}
	if got := appDeepLink(AppLinkModeWeb, "not a url", route); got != "" {
		t.Fatalf("expected no web link for an unusable public URL, got %q", got)
	}
}

func TestAppLinkModeOrDefault(t *testing.T) {
	t.Parallel()
	if got := appLinkModeOrDefault(""); got != DefaultAppLinkMode {
		t.Fatalf("unset app link mode = %q, want %q", got, DefaultAppLinkMode)
	}
	if got := appLinkModeOrDefault(AppLinkModeOff); got != AppLinkModeOff {
		t.Fatalf("configured app link mode = %q, want %q", got, AppLinkModeOff)
	}
}

func TestPushNotificationsCarryADeepLink(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	dataDir := t.TempDir()
	st, err := sqlitestore.Open("sqlite://" + filepath.Join(dataDir, "clickclack.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	owner, err := st.EnsureBootstrap(ctx, "Owner", "owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	workspaces, err := st.ListWorkspaces(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	channels, err := st.ListChannels(ctx, workspaces[0].ID, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	member, err := st.CreateUser(ctx, store.CreateUserInput{DisplayName: "Member", Email: "member@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddWorkspaceMember(ctx, workspaces[0].ID, member.ID, store.WorkspaceRoleMember); err != nil {
		t.Fatal(err)
	}
	if _, err := st.UpdateCurrentUser(ctx, store.UpdateCurrentUserInput{
		UserID: member.ID,
		NotificationSettings: &store.NotificationSettings{
			PushoverEnabled: true,
			PushoverUserKey: "m12345678901234567890123456789",
		},
	}); err != nil {
		t.Fatal(err)
	}
	message, _, err := st.CreateMessage(ctx, store.CreateMessageInput{
		ChannelID: channels[0].ID,
		AuthorID:  owner.ID,
		Body:      "ping",
	})
	if err != nil {
		t.Fatal(err)
	}

	wantRoute := "/app/" + workspaces[0].ID + "/" + channels[0].ID
	for name, test := range map[string]struct {
		mode     AppLinkMode
		wantLink string
	}{
		"default mode deep-links the installed app": {
			wantLink: "clickclack://open?path=" + url.QueryEscape(wantRoute),
		},
		"web mode links the public app": {
			mode:     AppLinkModeWeb,
			wantLink: "https://chat.example.com" + wantRoute,
		},
		"off mode sends no link": {mode: AppLinkModeOff},
	} {
		notifier := &recordingNotifier{}
		server := New(st, realtime.NewHub(), Options{
			PushNotifier: notifier,
			FrontendURL:  "https://chat.example.com",
			AppLinkMode:  test.mode,
		})
		server.notifyMessageCreated(ctx, message, nil)
		if len(notifier.notifications) != 1 {
			t.Fatalf("%s: expected one notification, got %#v", name, notifier.notifications)
		}
		got := notifier.notifications[0]
		if got.URL != test.wantLink {
			t.Fatalf("%s: notification URL = %q, want %q", name, got.URL, test.wantLink)
		}
		wantTitle := pushNotificationURLTitle
		if test.wantLink == "" {
			wantTitle = ""
		}
		if got.URLTitle != wantTitle {
			t.Fatalf("%s: notification URL title = %q, want %q", name, got.URLTitle, wantTitle)
		}
	}
}
