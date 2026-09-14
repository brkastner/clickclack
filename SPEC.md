# ClickClack Spec

ClickClack is a self-hostable, API-first chat app for internal testing, small teams, and communities. It mixes Slack-style productivity with Discord-style warmth, plus a light crustacean theme.

## Goals

- Run as a tiny single binary with first-class SQLite storage.
- Offer a hosted/server deployment path with Postgres later.
- Provide reliable realtime text chat with Slack-style threads.
- Keep the backend API-first and frontend-framework-independent.
- Ship a TypeScript SDK for bots, integrations, and community tooling.
- Feel playful and memorable without sacrificing dense, practical chat workflows.

## Locked V1 Decisions

- First implementation target: realtime channel chat plus Slack-style threads, not skeleton-only.
- Auth starts CLI-manageable: local owner/user bootstrap and invite/token management from `clickclack admin ...`.
- GitHub OAuth is optional V1, after local auth is usable.
- Frontend is Svelte 5 + Vite SPA. No SvelteKit server layer.
- API contract is OpenAPI-first, with `packages/protocol/openapi.yaml` as the source of truth.
- IDs use ULID-style sortable text IDs with semantic prefixes such as `usr_`, `wsp_`, `chn_`, `msg_`, `evt_`.
- Message body format starts as Markdown. Clients render a safe Markdown subset.
- Search, uploads, and DMs are V1 product scope, but come after the realtime channel/thread vertical slice is working.
- Monorepo layout is the canonical repo shape.

## Non-Goals For V1

- Voice/video rooms.
- Full Slack, Discord, or Mattermost server compatibility.
- Federation.
- End-to-end encryption.
- Enterprise compliance features.
- Multi-node websocket fanout.

## Product Shape

### Naming

- Product: ClickClack.
- Primary domain: `clickclack.chat`.
- Backend/protocol codename, if needed: Clawwire.
- Theme: lobster/crustacean accents, not renamed core UX primitives.

### First Users

- Internal testing groups.
- Self-hosted teams.
- Small communities.
- Bot-heavy hacker spaces.

### UX Model

- Multi-workspace.
- Workspace contains channels.
- Channel timeline shows root messages only.
- Every root message can have one Slack-style thread.
- Thread opens in a right-side pane.
- Thread replies are one-level only; no nested reply trees.
- Presence and typing are ephemeral.
- Light/dark themes from day one.

Use familiar terms for core navigation:

- Workspace
- Channel
- Thread
- Message
- Reaction
- Bot

Use crustacean flavor in:

- Logo/mascot.
- Empty states.
- Loading states.
- Reaction pack.
- Sounds.
- Onboarding copy.
- Optional statuses like `molting`, `lurking`, `afk`.

## V1 Vertical Slice

The first useful build should support:

- Create/select workspace.
- Create/select channel.
- Send Markdown text message.
- Realtime message delivery over WebSocket.
- Open message thread in right pane.
- Send thread reply.
- Persist everything in SQLite.
- Reload/reconnect and recover state.
- CLI-manageable local auth/bootstrap.
- Embedded web app served by Go.

After that vertical slice is stable, V1 expands to:

- Direct messages.
- SQLite FTS5 message search.
- Local file uploads and message attachments.
- GitHub OAuth as an optional login path.

## Architecture

```text
clickclack/
  apps/
    api/              # Go backend and single-binary entrypoint
    web/              # Svelte SPA
  packages/
    protocol/         # OpenAPI spec and event schemas
    sdk-ts/           # TypeScript SDK, generated client + friendly wrapper
  docs/
    architecture/
    api/
  infra/
    migrations/
      sqlite/
      postgres/       # later
```

## Backend

Language: Go.

Initial runtime:

- Single Go process.
- `modernc.org/sqlite`.
- Embedded migrations.
- Embedded Svelte build via `go:embed`.
- Local upload storage.
- In-process websocket hub.

Future hosted runtime:

- Postgres.
- Object storage.
- External queue/pubsub only when needed.
- Multi-node websocket fanout later.

### Suggested Go Libraries

- HTTP router: `chi`.
- SQLite: `modernc.org/sqlite`.
- Postgres later: `pgx`.
- Queries: start handwritten or `sqlc` once schema settles.
- Migrations: embedded SQL migrations with a tiny internal runner, or `goose` if the runner grows.
- IDs: ULID-style sortable text IDs with type prefixes.

### CLI

```text
clickclack serve
  --addr :8080
  --data ./data
  --db sqlite://./data/clickclack.db

clickclack migrate
  --db sqlite://./data/clickclack.db

clickclack admin bootstrap
  --name "Peter"
  --email steipete@gmail.com

clickclack admin user create
  --name "Ari"
  --email ari@example.com

clickclack admin invite create
  --workspace wsp_...
```

Default `clickclack serve` should be enough for local development. Production-like local use should bootstrap an owner through the CLI before exposing the instance.

## Frontend

Framework: Svelte 5 SPA.

Use plain Svelte + Vite unless SvelteKit offers clear value without adding server-side complexity. The Go server owns HTTP/API/auth and serves static assets.

Frontend responsibilities:

- Render workspace/channel/thread UI.
- Keep local client cache/projection.
- Use HTTP API for writes and fetches.
- Use WebSocket for realtime events.
- Recover by refetching from API after reconnect.

Frontend should not own durable chat truth.

### Sidebar hero rendering correction

**Status: Selected for implementation; not implemented or deployed by this documentation change.**

Sidebar hero zoom must reveal previously cropped source content when reduced below
100%, rather than shrink an already cropped strip. An opt-in hero mode in `Avatar`
will size the actual image using its natural aspect ratio and the viewport's cover
scale multiplied by zoom, clipping only at the hero viewport. The sidebar and
profile editor will share this geometry and respond to image load, source changes,
and viewport resizing. Ordinary avatars will keep their existing rendering.

Preserve the current 100% crop, horizontal pan convention, vertical positioning,
transform origin, saved x/y/zoom values, default 118% zoom, and 25–250% range.
Below the cover scale, uncovered viewport space is allowed; do not stretch the
image or re-clamp zoom to fill it.

Make sidebar hero images less faded by increasing resting image opacity from
0.72 to approximately 0.9 and reducing the scrim's panel mixing from
78/48/22/56% to approximately 55/25/10/35%. Preserve label shadows and
unread/active indicators. Tune only for readable labels in light and dark themes,
and retain subtle edge fading without masking source content before zoom.

The [selected implementation plan](docs/drafts/sidebar-hero-rendering.md) records
exact implementation steps, regression coverage, build commands, and later
Electron verification. Deployment and live verification remain separate workflow
stages; this specification does not claim either has passed.

### Sidebar hero header disclosure (KAS-890)

**Status: Selected for implementation. This documentation change does not implement or deploy it.**

Persona hero headers must independently expand or collapse their owned channel
lists instead of navigating to or starting a persona DM. Replace only the header
link with a native `type="button"` disclosure, with a visible caret,
`aria-expanded`, and `aria-controls` targeting a stable per-persona list ID.
Mouse, Enter, and Space must toggle it. Collapsing hides the entire owned list,
including selected and unread rows, and removes hidden rows from the tab order.
It must not change the selected conversation, mark messages read, or invoke DM
selection or creation. Empty sections remain toggleable. This is distinct from
the existing top-level Channels/DM priority-row disclosure behavior, which stays
unchanged.

Extend `Sidebar.svelte`'s workspace-scoped `clickclack:sidebar-sections:v1`
persistence with an optional expansion map keyed by `bot_user_id`. Preserve the
existing channels/directMessages/archived flags and old stored values. Missing
persona entries default to expanded. Malformed storage falls back safely, and
storage failures must not prevent disclosure. Pass the map and toggle callback
to the active `ChannelList`. Preferences must survive reloads and reordering by
stable persona identity and remain isolated by workspace.

Keep the sibling `+` action separate: it creates a named channel assigned to the
correct profile without toggling disclosure. Named channel rows keep their
navigation. Preserve unread summary badges, channel counts, hero geometry and
scrim, the drag handle, ordering, assignment drop targets, other DM entry points,
and existing channel pinning. Remove only `ChannelList` props/callbacks made
unused by replacing the header navigation. Limit CSS changes to button reset,
focus, and caret placement. The previous hero zoom/fading fix is deployed and
owner accepted; preserve it. The preceding rendering plan is a separate record,
not work to repeat for this request.

Scope is ClickClack only. Do not delete or migrate DMs, remove other DM entry
points, or change backend ownership/routing. KAS-891 section context-menu pinning
and KAS-892 section sorting by latest owned-channel message remain backlog work.

The [selected implementation plan](docs/drafts/sidebar-hero-disclosure.md)
preserves the exact implementation steps and validation. Add focused persistence
tests and isolated Electron coverage mounting the real Sidebar with synthetic
data and callback instrumentation. Cover keyboard and mouse disclosure, hidden
row focus, existing/no DM callbacks, empty groups, persistence and storage
failures, workspace switching, reordering, separate creation, navigation, and
preserved DM/pinning paths. Check caret, focus, images and controls in both themes
and sidebar sizes. Run web tests, typecheck, scoped lint, the canonical build to
regenerate embedded assets, and the existing Electron hero regression. Do not
use live conversations for these tests. Deployment remains a later stage.

### Explicit desktop file access

**Status: Implemented and fixture-tested in the task worktree under KAS-894. Not deployed; live owner verification remains pending.**

ClickClack must handle supported desktop-local file references through an
explicit, authorized Electron action instead of requesting a filesystem path
from the HTTP server. Create the requested Linear ticket before implementation.
First trace the reported link and verify that the intended video is accessible
on the machine running Electron. The coding host's filesystem is not proof of
that access. Replan if desktop-local access cannot solve the reported case.

The default action reveals the confirmed file in the OS file manager. It does
not provide in-app playback or automatically execute an associated application.
Verify that reveal meets the intended interaction before implementing it; replan
if it does not. An unavailable notice or a disabled link is not a successful fix.

Only positively classified local references receive this action. Recover a
malformed app-origin link only for the exact configured origin and verified
filesystem syntax, without hardcoding the reported hostname or filename. Reject
ambiguous encodings, credentials, network paths, and unsupported schemes.
Preserve ordinary web URLs, app routes, OAuth, deep links, and authenticated
attachments. Browser clients and older desktop versions must not receive a
falsely working local-file action.

Electron main owns authorization. Require a trusted main-frame caller, explicit
user activation, native confirmation of the exact target, canonical-path
validation, and regular-file checks. Keep confirmation bound to that target.
Expose only a narrow typed action returning success, cancelled, unavailable, or
denied, not file bytes or arbitrary filesystem metadata. Apply the same policy
to alternative explicit link-opening paths; redirects cannot trigger local
actions. Do not expose unrestricted filesystem methods or shell commands.

No public HTTP API, database, or generated SQL changes are planned. Do not add
arbitrary HTTP filesystem serving, a new service, broad filesystem browsing, or
automatic uploads. OpenClaw, pi-clickclack, Tailscale, DNS, and sibling repositories
remain outside scope. This plan neither asserts verified file availability nor
grants broader filesystem permissions.

The [selected implementation plan](docs/drafts/desktop-local-file-links.md)
records the implementation locations, checks, regression tests, risks, and
rollout boundaries. Verify the reported interaction in Electron and preserve
existing navigation behavior. Report implemented and tested separately from live
readiness, which requires the applicable deployment completion checks. Current
security behavior in `docs/desktop.md` remains a description of shipped behavior,
not a claim that this proposed capability already exists.

### Agent notepad (KAS-893)

**Status: Selected for implementation. This documentation change does not implement, verify or deploy it.**

Add a collapsible, read-only OpenClaw agent notepad to ClickClack using the
existing HTTP/WebSocket transport and Svelte UI conventions. OpenClaw remains
the source of truth. Keep implementation in the supplied ClickClack worktree;
OpenClaw and pi-clickclack are reference-only. The
[selected implementation plan](docs/drafts/agent-notepad.md) preserves the full
selected summary, ordered steps and validation verbatim.

#### Mapping and gateway connection

Add an optional integration under `apps/api/internal/config` and a dedicated
server adapter. Inspection found no existing gateway connection in ClickClack
configuration; pi-clickclack bridges Pi sessions, not OpenClaw. Prefer
operator-supplied server-only configuration over a new database table. Bind by
workspace plus channel/DM ID to a gateway connection identity, exact agent ID
and session key captured from authoritative OpenClaw routing. Validate duplicate,
incomplete and ambiguous bindings. Fail closed when unmapped. Never infer targets
from names or accept arbitrary gateway targets from browsers. Keep credentials
out of browser payloads, public feature responses, errors and logs.

Implement the authenticated gateway WebSocket handshake, advertised-capability
checks and typed `progressCard.get` response validation. Use persona-workstation's
gateway protocol, progress-card handler, session-observer identity helpers,
`sessions-subscriptions.ts` and native `session-progress-cards.ts` as references.
Inspect observer delivery and authorization guards before selecting subscription
calls. List subscription, target observation and participation authorization
are distinct requirements, not interchangeable guarantees.

Subscribe before reading and retain the owner-scoped wire identity. Treat matching
`progressCard.changed` events as invalidations requiring refetch, never as card
content. Coalesce in-flight refreshes with one trailing refresh, fence requests
by connection/target generation, refetch after reconnect and release obsolete
observation ownership. Never invoke `progressCard.put`.

#### Conversation authorization and transport

Add conversation-scoped read/watch/unwatch contracts through
`apps/api/internal/httpapi`, `packages/protocol` and `packages/sdk-ts`, following
existing generation conventions. Follow `workflow_snapshots.go` authorization:
current actor, `messages:read`, `dms:read` where applicable,
`GetChannel`/`GetDirectConversation` and workspace access. Recheck current
conversation access for reads, subscription creation and event delivery. Remove
watches on disconnect or revocation. Scope server cache keys by connection and
binding identity.

Extend the authenticated WebSocket lifecycle for narrowly targeted invalidations
and status, not a workspace-wide stream of card contents. Return distinct
unsupported, unmapped, denied, unavailable and successful-empty outcomes.
Unauthorized users must receive neither card reads nor invalidations.

#### Panel behavior

Add a focused lifecycle module under `apps/web/src/lib/chat` and integrate the
collapsible panel into `ChatApp.svelte` beside existing workflow panel conventions.
Fetch on opening and reconnect. Reset immediately on target changes and reject
late responses so one conversation cannot show another target's card. Render
markdown through the existing sanitized message-rendering path, optional
`pending`/`in_progress`/`completed` steps and update time.

Show loading, empty, denied, unsupported/unmapped and disconnected states. Never
present an unverified cached snapshot as current. An authoritative null card,
including after reconnect, must produce the empty state. Keep the entry point
unavailable for unbound or Pi-only conversations. Support keyboard controls,
light/dark themes and narrow layouts without obstructing chat or changing
composer or persona behavior.

#### Validation and handoff

Use synthetic gateway fixtures for adapter, HTTP/WebSocket authorization, client
lifecycle and UI regression tests. Cover two gateway/agent/session identities,
matching and unrelated events, duplicate/out-of-order invalidations, invalidation
during a read, conversation switching during a read, reconnect, remote clearing,
malformed replies, missing methods, authentication failures and disposal. Prove
current-access enforcement including revocation, credential non-disclosure and
that malicious markdown cannot execute scripts.

Run focused Go adapter and HTTP/WebSocket tests, existing workflow/agent-activity
authorization tests, focused web lifecycle/rendering tests and SDK/protocol
generation/type checks. Then run `pnpm check` (the `check:changed` alias runs the
same full gate) and `git diff --check`. If implementation requires SQL despite
the configuration-first design, edit canonical SQL and regenerate with
`pnpm generate:sqlc`; do not hand-edit generated storedb files.

Capture evidence in a task-owned isolated Electron instance at desktop and narrow
sizes in both themes. Preserve regression coverage for chat, composer drafts and
sending, attachments, persona navigation and Pi workflows. Distinguish fixture
cases from live evidence. When an already-authorized live mapping is available,
perform only a read and qualify advertised methods, authentication and observation
against that gateway. Otherwise deliver fixture evidence with the exact remaining
live qualification gap. Local source inspection alone is not live compatibility
proof.

Document the binding format, how to obtain exact routing identities, credentials
and observation requirements, configuration/activation instructions and lifecycle.
Handoff commits/worktree, mapping and transport decisions, checks/results, UI
captures, live-versus-fixture evidence, required activation steps and confirmation
that nothing was activated. Do not restart services, deploy, publish, alter live
configuration or mutate a live notepad. This plan does not add Pi-side card
production or replace chat/session ownership.

### VAI workspace gallery (KAS-768)

**Status: Selected for implementation. This documentation change does not implement, verify or deploy it.**

Add one workspace-scoped gallery for VAI responses using existing ClickClack
messages as the source of truth. Show media previews and text/file fallbacks,
provide a newest-response action, and link each response to its exact source
message and channel or direct conversation, including thread replies. Preserve
the gallery position and focus when returning from a source message. The
[selected implementation plan](docs/drafts/vai-gallery.md) preserves the complete
selected summary, contracts, ordered changes and checks, tests, risks, and boundaries.

#### Identity and retrieval

Use a verified installation-to-user mapping when available. Otherwise let the
user select an authorized bot account once and retain its immutable ID locally,
keyed by user and workspace. Show the selected account. Never guess identity from
a display name or message text. Missing or ambiguous identity requires source
selection, not an empty-gallery result.

Add `GET /api/workspaces/{workspace_id}/outputs` with required `author_id` and
optional `cursor` and `limit`. Return `{outputs: Message[], next_cursor: string|null}`
using existing message, attachment, and source identifiers. Obtain conversation
labels from authorized existing data or a documented bounded response field,
not one request per card.

Include nondeleted ordinary messages from that bot in the workspace, using
`kind=message` and its existing legacy default representation where applicable.
Include attachment-only and text-only responses. Exclude `agent_commentary` and
`agent_tool`; ordinary-message status does not prove generation completion.

Order by normalized `created_at` descending, then message ID descending. Bind
cursors to workspace, requester, author, ordering, and endpoint version. Apply
conversation visibility before pagination and recheck it on every request,
including direct-conversation membership. Batch message and attachment loading.
The latest action fetches a fresh first page with `limit=1` under the same rules.

Keep `/api/search`, message shapes, source URLs, and ordinary chat routing
compatible. Use a separate endpoint because existing SQLite text search returns
no results for an empty query and depends on FTS. Reuse authorization and paging
conventions without changing text-search semantics. Support SQLite and Postgres
with typed SQL. No output table or content backfill is planned. Add equivalent
indexes only when query-plan evidence warrants them, editing sqlc sources and
regenerating with `pnpm generate:sqlc`.

#### Navigation and failure handling

Reuse media presentation and extract only the source-reveal interface needed by
search and gallery. Load and highlight exact source messages even outside the
current message window. Preserve gallery pages, selected card, scroll anchor,
and focus during source navigation. Keep the gallery outside the timeline and
avoid a broad navigation redesign.

Handle source selection, empty results, loading, retries, unsupported or broken
media, and removed or inaccessible sources explicitly. Retain successful pages
when loading more fails. Invalidate stale requests on workspace or source changes.
Revalidate on reconnect, focus, and return. Use existing message and permission
signals to refresh or remove cached cards without silently reordering a scrolled
gallery. Do not promise external media retention or immediate offline revocation.

#### Verification, rollout, and scope

Test stable identity, response eligibility, pagination, bounded loading, and
conversation authorization in both databases. Cover private channels, DMs,
revocation between pages, cursor misuse, duplicate names, deleted accounts, and
attachment-only history. Verify exact channel, DM, and thread navigation and
return state, including stale requests and failure recovery. Preserve existing
search behavior. Run focused tests and repository quality gates, then prove the
full keyboard and pointer flow in isolated Electron with synthetic data.

Release through the existing workflow deployment stage, with the additive
backend before or alongside the frontend. Rebuild the desktop only if shell
changes require it. Load applicable deployment skills and claim live completion
only after their checks pass; before that, report implemented and tested, not live.

Keep implementation in this ClickClack repository or its workflow-managed
checkout. Do not change VAI, OpenClaw, pi-clickclack, upstream projects, sibling
repositories, or external services. Do not add duplicate output storage, indexing
or thumbnail services, a media proxy, or other infrastructure. A second conversation
panel, future filter suite, generic asset manager, producer-protocol redesign,
unrelated UI cleanup, and infrastructure redesign are excluded. Do not scrape
live conversations for identity inference or fixtures. Use existing authorized
contracts, synthetic data, and existing deployment procedures.

### Generic gallery plugin actions

**Status: Implemented host contract; see [gallery actions](docs/features/gallery-actions.md) for exact routes, limits, retention, and producer obligations.**

Installed bots may contribute gallery context-menu actions that open one shared
floating panel. ClickClack owns generic discovery, authorized attachment context,
safe rendering, session state, and submission tracking. Bots own labels, choices,
option meanings, execution, and paid-work approval. The gallery and its existing
add-to-message action remain functional without any plugin. Production host code
must not contain VAI commands, flags, pack conventions, or execution branches.

The [selected implementation plan](docs/drafts/gallery-plugin-actions.md) records
all contracts, ordered changes and checks, tests, risks, and boundaries. This is
the first of two sequential single-repository workflows. Prepare and change only
a Worktrunk-managed ClickClack checkout here. The separate face workflow consumes
the tested host contract afterward; missing VAI code does not block host acceptance.

#### Registration and interaction

Extend installed-bot capabilities with optional versioned, bounded action
descriptors containing stable namespaced IDs, labels, and accepted media types.
Scope IDs by installation. Reuse installation-management authorization; one bot
cannot register for another installation. Reject invalid descriptors and safely
ignore unsupported versions during discovery. Discover registered actions through
the host, not fresh calls to every bot when a menu opens. Recheck installation,
source, media, and destination eligibility. Invalidate descriptors and sessions
when capabilities change or an installation is removed. Never expose secrets.

Use typed open-panel, choices-query, submit, and status exchanges over existing
authenticated bot transport. Bind protocol version, action and installation,
actor, workspace, source, destination, session, request, schema revision, and
expiration as appropriate. Resolve authority from authentication and stored state,
not client claims. Render only bounded declarative image multi-selection,
boolean, numeric/select, preview, and submission controls. Bot data may supply
labels, defaults, constraints, and opaque choice IDs, but not code, raw HTML,
expressions, filesystem paths, or arbitrary callbacks. Bound dynamic queries by
declared field IDs and pagination. Reject unsupported or oversized schemas.

Reuse authorized attachment/upload references for source and choice previews.
Do not add an arbitrary URL-fetch proxy. Producers must expose local pack images
through the supported authorized media contract. Revalidate source and selected
attachment access before submission; a bot-returned ID does not grant access.

#### Authorization, durability, and compatibility

Bind every session to an authenticated actor, workspace, installation, accessible
source, and explicitly authorized destination conversation. Check source and
destination independently on open, choices, submit, status, and response delivery.
Use valid existing destination context or ask the user to choose an authorized
destination. Never guess one.

Validate submission values against stored schema revision and choice scope.
Atomically record submission identity and enqueue through existing durable
delivery. The same identity and payload return existing state; a changed payload
conflicts. Retries retain identity and reconnect queries status rather than
submitting again. Bots must deduplicate execution and retain paid-work approval;
host tracking alone cannot guarantee exactly-once external effects.

Represent pending, accepted, failed, expired, unavailable, and uncertain states
with correlated responses. A timeout after possible acceptance must not create a
new execution identity. Stale responses, revocation, and installation changes
cannot revive closed sessions. Closing the UI does not cancel a job. Older hosts
and bots retain ordinary chat; unsupported versions disable only plugin actions.
Reuse integration/delivery storage where suitable, adding only necessary durable
fields with additive SQLite/Postgres migrations and typed SQL. Regenerate SDK
and sqlc outputs through repository scripts, including `pnpm generate:sqlc`.

#### Verification and handoff

Test permissions, descriptor/schema bounds, media access, correlated responses,
concurrent duplicate submissions, lost acknowledgments, restart recovery,
revocation, installation removal, and compatibility. Prove the complete flow with
a synthetic non-VAI bot and isolated Electron pointer, keyboard, focus, and
no-plugin regression coverage. Run repository quality gates. No paid provider
calls or private production conversation data are required.

Document the exact implemented protocol, controls and limits, media flow, SDK
usage, consumer obligations, disable procedure, absolute worktree, revisions,
changed files, and checks for the next face workflow. Host completion is not
whole-feature completion. Deployment remains separate. If performed, deploy
additive backend support before compatible frontend exposure and retain rollback
through capability disablement or a compatible prior application build, without
destructive schema rollback. Keep the unimplemented VAI capability disabled.
Load applicable deployment skills and pass completion checks before claiming live
status. Preserve existing work; do not merge or edit main checkouts, face,
upstream, or unrelated repositories. Add no service, infrastructure resource,
broad plugin platform, remote executable UI, or arbitrary filesystem browser.

## API

Contract: OpenAPI first.

Source of truth:

```text
packages/protocol/openapi.yaml
```

Generate:

- Go request/response types or validators where useful.
- TypeScript API client.
- SDK docs.

Initial REST shape:

```text
GET    /api/me

GET    /api/workspaces
POST   /api/workspaces
GET    /api/workspaces/{workspace_id}

GET    /api/workspaces/{workspace_id}/channels
POST   /api/workspaces/{workspace_id}/channels
PATCH  /api/channels/{channel_id}

GET    /api/channels/{channel_id}/messages?before=&after_seq=&limit=
POST   /api/channels/{channel_id}/messages
PATCH  /api/messages/{message_id}
DELETE /api/messages/{message_id}

GET    /api/messages/{message_id}/thread
POST   /api/messages/{message_id}/thread/replies

POST   /api/messages/{message_id}/reactions
DELETE /api/messages/{message_id}/reactions/{emoji}

GET    /api/realtime/events?after_cursor=
POST   /api/realtime/ephemeral
GET    /api/realtime/ws

GET    /api/search?workspace_id=&q=&channel_id=&direct_conversation_id=&sort=&limit=&cursor=

POST   /api/uploads
GET    /api/uploads/{upload_id}

GET    /api/dms
POST   /api/dms
GET    /api/dms/{conversation_id}
DELETE /api/dms/{conversation_id}
POST   /api/dms/{conversation_id}/open
GET    /api/dms/{conversation_id}/messages?before=&after_seq=&limit=
POST   /api/dms/{conversation_id}/messages
```

## Realtime

Realtime must be recoverable.

Rules:

- WebSocket is a notification/update pipe.
- SQLite/Postgres is source of truth.
- Every durable event is recoverable through HTTP.
- Client reconnects with last seen cursor.
- If cursor is too old or unknown, server returns `resync_required`.

Send flow:

1. Client calls `POST /api/channels/{id}/messages`.
2. Server validates auth and membership.
3. Server transaction:
   - insert message
   - assign per-channel sequence
   - insert event into outbox/events table
   - update thread/channel summary state
4. In-process dispatcher broadcasts event to websocket subscribers.
5. Client reconciles optimistic message with server event.

Event shape:

```json
{
  "id": "evt_...",
  "cursor": "...",
  "type": "message.created",
  "workspace_id": "w_...",
  "channel_id": "c_...",
  "seq": 124,
  "created_at": "2026-05-08T12:00:00Z",
  "payload": {
    "message_id": "m_..."
  }
}
```

Initial durable events:

- `message.created`
- `message.updated`
- `message.deleted`
- `thread.reply_created`
- `thread.state_updated`
- `reaction.added`
- `reaction.removed`
- `channel.created`
- `channel.updated`

Ephemeral events:

- `typing.started`
- `typing.stopped`
- `presence.changed`

Ephemeral events are not persisted and may be dropped.

## Data Model

Initial tables:

```text
users
  id
  display_name
  avatar_url
  created_at

identities
  id
  user_id
  provider
  provider_subject
  email
  created_at

workspaces
  id
  name
  slug
  created_at

workspace_members
  workspace_id
  user_id
  role
  created_at

channels
  id
  workspace_id
  name
  display_title (nullable, presentation-only)
  kind
  created_at
  archived_at

messages
  id
  workspace_id
  channel_id
  author_id
  parent_message_id
  thread_root_id
  channel_seq
  thread_seq
  body
  body_format
  created_at
  edited_at
  deleted_at

thread_state
  root_message_id
  reply_count
  last_reply_at
  last_reply_author_ids_json

reactions
  message_id
  user_id
  emoji
  created_at

events
  id
  cursor
  workspace_id
  channel_id
  type
  payload_json
  created_at

uploads
  id
  workspace_id
  owner_id
  filename
  content_type
  byte_size
  storage_path
  created_at

message_attachments
  message_id
  upload_id
  created_at

direct_conversations
  id
  workspace_id
  created_at

direct_conversation_members
  conversation_id
  user_id
  created_at
```

Thread rules:

- Root message has `parent_message_id = null`.
- Root message has `thread_root_id = id`.
- Thread reply has `parent_message_id = root_message_id`.
- Thread reply has `thread_root_id = root_message_id`.
- No nested replies in V1.

## Storage

SQLite is first-class.

SQLite requirements:

- Use `modernc.org/sqlite`.
- Enable WAL mode.
- Use a single writer discipline.
- Keep transactions short.
- Prefer portable SQL.
- Avoid Postgres-only behavior in core paths.
- Add separate Postgres migrations later rather than forcing one dialect.

Local file layout:

```text
data/
  clickclack.db
  uploads/
  logs/
```

## Auth

V0:

- CLI owner bootstrap.
- CLI user/invite management.
- Dev/local auth for quick testing, gated to local/dev mode.
- CLI-generated magic-link tokens.
- Bearer session tokens and HTTP-only cookie sessions.

V1:

- Magic-link token issuance and consume flow, with CLI/local delivery first.
- GitHub OAuth as optional login, enabled via self-host config.
- SMTP or provider-backed email delivery later, once deployment mail settings are known.
- Optional local email/password only if needed for fully offline/self-hosted deployments.

Auth principles:

- Workspace membership checked on every API write.
- WebSocket subscribe validates workspace/channel access.
- Recheck permissions for channel/thread fetches.

## SDK

First SDK: TypeScript.

Location:

```text
packages/sdk-ts
```

Layering:

- Generated OpenAPI types.
- Friendly wrapper.
- WebSocket/event subscription helper.

Example API:

```ts
const client = new ClickClackClient({ baseUrl, token });

await client.channels.sendMessage(channelId, {
  body: "click clack",
});

client.events.subscribe({
  workspaceId,
  onEvent(event) {
    // handle event
  },
});
```

SDK must not depend on Svelte.

## Mattermost Compatibility

Do not clone the full Mattermost API in V1.

Do support:

- Incoming webhook compatibility.
- Simple slash-command callback shape.
- Import helpers for exports if useful.

Do not support early:

- Existing Mattermost clients connecting directly.
- Full REST API compatibility.
- Full permission/model compatibility.

## Design Direction

ClickClack should feel:

- Fast.
- Dense.
- Friendly.
- Slightly weird.
- More polished tool than joke app.

Visual direction:

- Light and dark themes.
- Neutral UI base.
- Coral, shell, brine, ink accents.
- Crustacean mascot and iconography used sparingly.
- Avoid novelty typography.
- Avoid making normal controls hard to understand.

UI layout:

```text
left sidebar: workspaces / channels
center: channel timeline
right pane: thread
bottom: composer
top: channel title, members, search
```

## Development Milestones

### M0: Skeleton

- Monorepo.
- Go server boots.
- Svelte app builds.
- Go embeds and serves web assets.
- SQLite opens and migrates.

### M1: Durable Chat

- Workspaces/channels/messages schema.
- REST create/list messages.
- Basic dev auth.
- Message timeline UI.

### M2: Realtime

- WebSocket endpoint.
- Event outbox.
- Live message updates.
- Reconnect and cursor recovery.

### M3: Threads

- Root messages and one-level replies.
- Thread pane.
- Thread reply counts and last reply state.

### M4: Search, Uploads, DMs

- SQLite FTS5 message search.
- Local upload storage.
- Message attachments.
- Direct message conversations.

### M5: Self-Host Polish

- First-run owner setup.
- CLI-generated magic-link auth.
- Config file/env.
- Docker image.
- Backups/export.

### M6: SDK And Integrations

- OpenAPI generation.
- TypeScript SDK.
- Incoming webhooks.
- Basic bot example.

## Answered Questions

- Setup starts with CLI owner bootstrap. A setup UI can be added later.
- Markdown is the initial rich text format.
- DMs are V1 scope, after channel chat and threads.
- Search starts with SQLite FTS5.
- Uploads are V1 scope, after core chat is solid.
- OpenAPI remains source of truth from the first scaffold.
- TypeScript compilation uses `tsgo`; lint/format use `oxlint` and `oxfmt`.
- GitHub OAuth ships in V1 as an optional configured auth provider.

## Open Questions

- Whether to add generated Go request/response validation from OpenAPI in V1 or keep the first backend on hand-written handlers.
