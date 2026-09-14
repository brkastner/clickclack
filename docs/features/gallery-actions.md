# Gallery actions

Installed bots contribute bounded declarative actions to image and video gallery cards. ClickClack owns authorization, panel rendering, durable session/request storage, and callback delivery. Producers own execution and approval.

## Setup and routes

A human workspace owner or moderator creates an app installation bound to a bot member, then creates an event subscription using `POST /api/workspaces/{workspace_id}/event-subscriptions` with `app_installation_id`, `callback_url`, and `event_types: ["gallery_action.open", "gallery_action.choices", "gallery_action.submit"]`. Save the returned one-time signing secret. See [integrations](integrations.md#outgoing-event-subscriptions) for callback URL restrictions and secret rotation.

The installed bot token needs `gallery_actions:write`. Register with `PUT /api/bots/self/gallery-actions`, supplying both `installation_id` and `gallery_actions`. Replacing capabilities changes their generation and invalidates existing sessions, even if the schema revision stays the same.

| Method and route | Input and result |
| --- | --- |
| `PUT /api/bots/self/gallery-actions` | Bot-authenticated `{installation_id, gallery_actions}`; returns descriptors. |
| `GET /api/workspaces/{workspace_id}/gallery-actions?source_upload_id=...&destination_id=...` | Actor-authenticated discovery; returns eligible `gallery_actions`, without secrets. |
| `POST /api/workspaces/{workspace_id}/gallery-actions/open` | Actor-authenticated `{session_id, installation_id, action_id, source_upload_id, destination_id}`; returns `{session, request}`. |
| `POST /api/gallery-actions/sessions/{session_id}/choices` | `{request_id, schema_revision, field_id, offset, limit}`; returns `{session, request}`. |
| `POST /api/gallery-actions/sessions/{session_id}/submit` | `{request_id, schema_revision, values}`; returns `{session, request}`. |
| `GET /api/gallery-actions/sessions/{session_id}?request_id=...` | Actor-authenticated status; defaults to submission or open request; returns `{session, request}`. |
| `POST /api/bots/self/gallery-actions/requests/{request_id}/response` | Installed-bot-token-authenticated `{session_id, schema_revision, state, choices?, preview_upload_id?}`; state is `accepted` or `failed`; returns `{request}`. |

## TypeScript SDK example

```ts
await bot.bots.setGalleryActions(installationId, [{
  version: 1, id: "studio.adjust", label: "Adjust media",
  accepted_media_types: ["image/png", "video/mp4"], schema_revision: 1,
  fields: [{ id: "amount", kind: "number", label: "Amount", min: 0, max: 10, step: 1, default: 1 }],
}]);
const sessionId = actor.galleryActions.newSessionId();
// Persist this ID before sending; reuse it after a lost open acknowledgement.
const opened = await actor.galleryActions.open(workspaceId, {
  session_id: sessionId, installation_id: installationId, action_id: "studio.adjust",
  source_upload_id: uploadId, destination_id: channelId,
});
// The producer verifies the signed callback, then responds using its bot client:
await bot.galleryActions.respond(opened.request.request_id, {
  session_id: sessionId, schema_revision: 1, state: "accepted",
});
const submission = { request_id: crypto.randomUUID(), schema_revision: 1, values: { amount: 2 } };
// Persist submission before sending; retry these exact values and request_id.
await actor.galleryActions.submit(sessionId, submission);
await actor.galleryActions.status(sessionId, submission.request_id);
```

The callback is a signed gallery envelope (not the ordinary event-log wrapper). It contains `version`, `event_id`, `type`, `installation_id`, `action_id`, `actor_id`, `workspace_id`, `source_upload_id`, `destination_id`, `session_id`, `request_id`, `submission_id`, `schema_revision`, `expires_at`, and `payload`. Verify `X-ClickClack-Timestamp` and `X-ClickClack-Signature` using the subscription signing secret. HTTP acknowledgement alone does not accept a request: the producer must POST the correlated authenticated response above. Only the bound producer can answer; no producer-selected callback URL is accepted in a descriptor or request.

## Authorization and limits

Discovery, open, choices, submit, status, response, and dispatch recheck current authority. Actor and bot must both retain workspace access, readable source media, and permission to send to the explicitly supplied destination. Installation, registration token, matching subscription, capability generation, schema, expiry, and moderation remain authoritative. Archival, source deletion, revocation, and membership loss invalidate access. No callback grants access to an upload.

Source, choice thumbnails, and preview references must be authorized ClickClack upload IDs. Source previews use a native video element for video MIME types. Choice/response previews must be images accessible to both actor and bot in the same workspace. Arbitrary URLs, HTML, executable expressions, paths, or producer-selected destinations are unsupported.

Version 1 allows 32 actions per installation, 1–8 exact MIME types per action, 16 fields per action, 100 choices per field, and labels up to 100 characters. Field kinds are `boolean`, bounded `number`, `select`, and `images`. Stable action/field/choice IDs use lowercase letters, digits, underscores, dots, and hyphens, up to 64 characters. Numeric magnitudes are bounded by 1e12. Dynamic choices use declared fields and bounded pagination, with at most 100 accumulated choices. JSON request bodies are capped at 128 KiB. Sessions allow at most 128 requests and one submission identity.

## Durability, retention, and producer obligations

SQLite and Postgres atomically persist the session revision, payload-bound request, and outbox enqueue. Duplicate identity with identical payload returns the recorded outcome; a changed payload conflicts. Pending, accepted, failed, expired, unavailable, and uncertain states are durable. Closing the panel does not cancel execution. Reopening recovers the saved identity and status.

Sessions expire 30 minutes after open. New session IDs are `unix-seconds.random`, with at least 16 random characters (the SDK/UI use a UUID suffix). The issue time must be within the preceding 30 minutes and no more than 60 seconds ahead. Retained legacy opaque IDs can only retry their existing row. Once a row is cleaned, its old timestamp cannot open another session. A genuinely new ID represents a new action, never an automatic retry.

Both stores index `retain_until`, set atomically to expiry plus 24 hours. The existing dispatcher deletes at most 32 due sessions per one-second pass; foreign keys cascade to requests and outbox rows. Retention is a cleanup eligibility deadline, so a backlog may delay deletion. Terminal outcomes remain within that diagnostic window. The time-bound identity preserves replay rejection after deduplication rows are deleted.

Dispatch claims at most 32 due requests per pass, with 30-second leases, a 10-second callback timeout, and at most five delivery attempts. Retries retain the exact envelope, event, request, and submission identities. Lost acknowledgements and exhausted retries are uncertain and must not create another execution identity. Producers must durably deduplicate external effects by submission identity, bind it to the payload, return original outcomes on retries, reject expired work, and retain their own approval and paid-work controls. Host storage and cleanup do not provide exactly-once external effects or erase producer obligations.
