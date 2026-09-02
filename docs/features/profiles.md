---
read_when:
  - changing user profile fields, account settings UI, or /api/me
---

# Profiles

Each user has a display name, optional handle, a primary avatar URL, an
optional light-mode avatar URL, and per-user notification settings. The primary
avatar is used in dark mode and as the fallback in light mode. Email-backed
users without an explicit or provider-supplied primary avatar use a Gravatar
generated from their normalized email.

The handle is the human-friendly short name shown as `@name` in the app. The
API accepts it with or without the leading `@`, normalizes it to lowercase, and
stores it without the `@`.

## API

```http
GET /api/me

PATCH /api/me
{
  "display_name": "Peter Steinberger",
  "handle": "@steipete",
  "avatar_url": "https://example.com/avatar-dark.png",
  "avatar_url_light": "https://example.com/avatar-light.png",
  "notification_settings": {
    "pushover_enabled": true,
    "pushover_user_key": "uQiRzpo4DXghDmr9QzzfQu27cmVRsG"
  }
}
```

`PATCH /api/me` returns `{ "user": ... }`. Handles must be unique when set and
must be 2-32 characters using letters, numbers, `_`, or `-`. Avatar URLs can be
blank or an `http`/`https` URL. `avatar_url_light` requires a non-empty
`avatar_url`; clearing the primary URL clears the light-mode URL too. Changing a
non-empty primary URL leaves an omitted light-mode URL unchanged. An explicit
primary URL takes precedence over Gravatar; clearing it restores the
email-backed Gravatar fallback. Gravatar requests are served by `gravatar.com`,
so clients loading those images contact that external service.

Pushover notifications require `CLICKCLACK_PUSHOVER_API_TOKEN` on the server.
Each user opts in from account settings with their own 30-character Pushover
user key. Message-created pushes are delivered to opted-in workspace members
except the author; DMs are delivered only to opted-in conversation members
except the author.

## App

The current user's profile control sits at the bottom of the channel sidebar.
Click or right-click it to open account settings and edit display name, handle,
primary and light-mode avatar URLs, conversation display preferences, and
notification settings.

Conversation display preferences can hide agent commentary or tool calls and
independently place the current user's messages and other human or agent
messages on the left or right. These preferences are stored on the local
device, not in the user profile returned by `/api/me`.

Clicking a message avatar or author name opens a Slack-style profile pane in
the right rail. The pane shows the user's avatar, display name, handle,
presence, user ID, and a Message action for starting or jumping to a DM.

Viewers who can edit a bot profile get an Edit profile action that replaces the
pane with an identity editor. The editor updates the bot's own `display_name`,
`handle`, `avatar_url`, and `avatar_url_light` through
`PATCH /api/bots/{bot_user_id}`. A user-owned
bot is editable only by its owner; a service bot is editable by workspace
managers. The current user's own profile keeps routing to account settings,
which also owns notification and conversation display preferences.

Message lists, search results, threads, DMs, and profile controls all hydrate
both avatar variants from the user attached to each message or conversation
member. The shared avatar component follows the resolved light/dark theme and
falls back to `avatar_url` when the light variant is absent.
