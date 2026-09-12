# Agent notepad

ClickClack can show an OpenClaw conversation's durable agent notepad in a collapsible, read-only panel above its messages. OpenClaw remains the source of truth. There is no Pi-side notepad, editing, history, Control UI embedding or database scraping.

This implementation is not activated by default. It requires explicit server configuration, an existing paired gateway device and an exact conversation binding. No deployment or live configuration change was performed for KAS-893.

## Server configuration

Pass the following optional `openclaw_notepad` section through ClickClack's existing configuration file. Keep that file private, mode `0600`; do not put credentials in source control. All example values are synthetic.

```json
{
  "openclaw_notepad": {
    "gateways": [
      {
        "id": "workstation",
        "url": "wss://gateway.example.test",
        "token": "OPERATOR_PROVISIONED_GATEWAY_TOKEN",
        "private_key_file": "/absolute/private/clickclack-device.pem"
      }
    ],
    "bindings": [
      {
        "workspace_id": "wsp_example",
        "channel_id": "chn_example",
        "gateway_id": "workstation",
        "agent_id": "example-agent",
        "session_key": "agent:example-agent:clickclack:group:chn_example"
      }
    ]
  }
}
```

The device key must be an existing operator-provisioned Ed25519 PKCS#8 PEM file with no group/other permissions. Provision and approve the device using OpenClaw's supported administration flow, independently of ClickClack. The key's SHA-256 raw public-key fingerprint identifies the device. ClickClack does not generate keys, approve pairings, persist returned device tokens, weaken device verification, or request admin scopes. It signs the nonce-bound v3 device payload and requests `operator.read` as `gateway-client`, mode `backend`, platform `server`. The gateway must authorize that paired device and its session participation. A shared gateway token alone is insufficient.

Use `wss://` outside exact loopback hosts (`localhost`, `127.0.0.1`, `::1`). TLS uses normal certificate verification. URL userinfo, query strings and fragments are rejected. The token belongs in the private configuration, not a URL. No gateway credentials, handshake snapshots, canonical session keys or upstream error messages are forwarded to browsers.

Each gateway ID must be unique. Each binding must reference a configured gateway and identify exactly one channel or DM. For DMs, replace `channel_id` with `direct_conversation_id`. Bindings are unique by workspace and conversation. Agent IDs must use the gateway's normalized spelling; owner-qualified session keys must agree with the configured agent ID. Missing or ambiguous mappings fail closed.

### Obtaining the target

Capture the exact resolved agent ID and session key from the OpenClaw ClickClack channel's authoritative routing metadata. The reference is `persona-workstation/extensions/clickclack/src/access.ts` and its resolved inbound route, not the ClickClack bot's display name, persona section or channel name. `pi-clickclack` routes Pi sessions and cannot supply an OpenClaw target. Do not infer a binding from visual ownership. An operator must confirm the target before activation.

The gateway's `sessions.messages.subscribe` response resolves canonical session identity. ClickClack retains its owner-scoped wire form for subsequent response and event matching. Bare keys such as `global` stay explicitly bound to their supplied agent. Two gateways or agents may therefore use the same bare key without sharing client state.

## Transport and lifecycle

- `GET /api/channels/{channel_id}/notepad` and `GET /api/dms/{conversation_id}/notepad` return `{ state, card }` with `Cache-Control: no-store`. A ready result with `card: null` means there is no card.
- The corresponding `/notepad/watch` endpoints upgrade to an authenticated WebSocket using the same cookie or `clickclack.bearer.TOKEN` subprotocol and Origin checks as the existing realtime transport. They require `realtime:read` in addition to read access. A successful watch sends `{ type: "notepad.changed", state: "ready" }`; every such notice requires a refetch. Notices have no card content or replay cursor. Closing the socket unwatches.
- Both paths require `messages:read`, `dms:read` for DMs, and current conversation/workspace access. Reads recheck access after gateway work. Watch sends and the idle recheck revalidate exact credentials, refreshed scopes and current membership. Revocation closes the watch and releases its gateway connection.
- Each read/watch owns one gateway connection and one captured binding. There is no shared card cache or database projection. Gateway subscriptions are released on connection close. Separate scoped watch sockets do not alter the chat realtime queue or composer transport.
- The adapter requires advertised `progressCard.get`, `sessions.messages.subscribe`, `sessions.messages.unsubscribe` and `progressCard.changed`. It subscribes before reading and checks participation through `progressCard.get`. The gateway's subscription and participation checks are distinct. Only matching progress invalidations are forwarded. The adapter ignores unrelated event contents, coalesces pending invalidations and detects sequence gaps.
- The panel fetches after the watch is established and after reconnect. Changes during a read retire its response and queue a trailing read. Closing or switching the panel aborts outstanding requests. Invalidated/disconnected content is removed rather than shown as current. A fresh null result clears the panel, even after missed events or a revision reset.
- Gateway heartbeat loss and request deadlines become unavailable/disconnected states. The browser reconnects with bounded exponential delay. Unsupported, unmapped and denied states stop retries until the panel is reopened. Pi-only and unbound conversations show an explicit unavailable mapping explanation on opening.

Markdown uses the same DOMPurify/marked rendering path as messages. Progress steps display pending, in-progress and completed states. Native disclosure keyboard controls, independent content scrolling and bounded height preserve room for chat and the composer in both themes.

## Protocol reference and qualification

The adapter implements the inspected OpenClaw Gateway **v4** contract, not an inferred generic provider API. The reference checkout was `persona-workstation` at `a7eadb5de68f001ebf8792ec1119f5df6f34607c`. References are its local sources:

- `packages/gateway-protocol/src/version.ts`, `client-info.ts`, `schema/frames.ts`, `schema/progress-card.ts`.
- `packages/gateway-client/src/device-auth.ts` and the client connect assembly.
- `src/gateway/server-methods/progress-card.ts`, `sessions-subscriptions.ts`, `session-observer-model.ts`, `session-method-policy.ts`, and `server-broadcast.ts`.

The signed gateway fixture verifies the handshake, target separation, interleaved events, authorization errors, remote clearing, reconnect and in-flight invalidations. It does not prove a deployed gateway has the same version, advertised features, paired device or session permissions.

Before activation, independently verify the deployed gateway version, advertised methods/events, authentication, paired device and exact mapped session access using a read only. Do not edit a user's live notepad for testing. If no authorized mapping and device are available, retain the fixture evidence and report live qualification as pending. No live credentials or mapping were supplied to this implementation run, so no live read or gateway mutation was attempted.

## Verification

From the prepared ClickClack checkout:

```sh
go test -race ./apps/api/internal/notepad/... ./apps/api/internal/config ./apps/api/internal/httpapi -run 'Test(Gateway|ParseCard|NormalizeOpenClaw|Notepad)' -count=1
pnpm --filter @clickclack/web exec node --test src/lib/notepad.test.ts
pnpm --filter @clickclack/web typecheck
node scripts/test-agent-notepad-electron.mjs
pnpm check
pnpm build
git diff --check
```

The isolated Electron fixture mounts the real panel, verifies sanitized markdown, structured and markdown-only cards, clearing, reconnect, keyboard disclosure and preservation of a synthetic composer draft. Captures are written under `test-results/notepad/` at desktop and narrow widths in light/dark themes. This is fixture evidence, not a live conversation or full ChatApp interaction proof. Existing repository chat, composer, attachment, persona and workflow tests remain part of `pnpm check`.

Activation requires separate authorization to install the built ClickClack artifact and supply the private configuration. Nothing in this guide authorizes deployment, service restarts, live configuration changes, publishing or merging. The selected implementation contract remains in [the plan](../drafts/agent-notepad.md) and [SPEC.md](../../SPEC.md#agent-notepad-kas-893).
