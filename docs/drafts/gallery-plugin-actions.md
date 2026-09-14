# Generic gallery plugin actions

## Status and summary

Selected implementation plan. This documentation change does not implement, verify, or deploy the feature.

Implement installed-bot gallery action descriptors and one generic floating panel in a Worktrunk-managed ClickClack checkout. Reuse existing integration authentication, delivery, storage, and SDK patterns. Verify independently with a synthetic non-VAI bot, then hand the implemented contract to the separate face workflow.

This corrects the earlier simultaneous-two-worktree requirement: only ClickClack is prepared and changed in this first workflow. Missing VAI implementation does not block host completion. Proposed new file names below are implementation targets, not existing capabilities.

The selected Holy grail is the installed-descriptor design with explicit compatibility, authorization, invalidation, and submission-recovery guarantees. The practical installed-descriptor option is retained within it, not replaced with a larger feature set. Menu-time discovery from every bot was rejected because it adds latency, discovery traffic, and offline handling for stable action lists.

## Contracts

### Ownership

ClickClack owns generic action discovery, authorized attachment context, safe declarative rendering, session state, and submission tracking. The bot owns action labels, option semantics, choices, execution, and paid-work approval. Production host code must not contain VAI-specific commands, flags, pack conventions, or execution branches.

### Registration

Extend installed-bot capabilities with optional versioned bounded action descriptors containing stable namespaced IDs, labels, and accepted media types. Scope IDs by installation, not label. Reuse existing installation-management authorization and prevent one bot from registering for another installation. Omitted capability preserves current behavior. Reject invalid descriptors on registration and ignore unsupported versions safely on discovery.

### Discovery and invalidation

Discover registered eligible actions through the host rather than calling every bot when a menu opens. Recheck installation activity, source visibility, supported media, and destination eligibility. Capability changes or installation removal invalidate cached descriptors and affected sessions. Return only public capability data, never installation secrets.

### Interaction

Add typed open-panel, choices-query, submit, and status request/response envelopes to existing authenticated bot transport. Include protocol version, installation/action identity, actor/workspace/source/destination context, session ID, request ID, schema revision, and expiration as appropriate. The server resolves identity from authentication and stored session state rather than trusting client claims. Persist bounded submission state for recovery; add no new service.

### Rendering

One host-owned floating panel renders only a bounded schema for image multi-selection, booleans, numeric/select fields, preview, and submission status. Bots supply labels, defaults, constraints, and opaque choice IDs, not executable scripts, raw HTML, filesystem paths, arbitrary callbacks, or expressions. Reject unsupported controls and oversized schemas. Dynamic choice requests use declared field IDs and bounded pagination.

### Media

Reuse authorized ClickClack attachment/upload references for source and choice previews. Do not introduce an arbitrary URL-fetch proxy. Require the producer to expose local pack images through the supported authorized media contract in the later workflow. Revalidate source and chosen attachment access on submission; never grant access merely because a bot returned an ID.

### Authorization

Bind each session to authenticated actor, workspace, installation, accessible source attachment, and explicitly authorized destination conversation. Check source and destination independently on open, choices, submit, status, and response delivery. Resolve a destination from valid existing context or ask the user to choose among authorized destinations; never guess an arbitrary conversation.

### Submission

Validate fields against the stored schema revision and choice scope, then atomically record a submission identity and enqueue using existing durable delivery machinery. The same identity with the same payload returns existing state; a different payload conflicts. Transport retries retain that identity. Reconnect queries state rather than creating another submission. Document bot-side deduplication and approval obligations; the host cannot guarantee exactly-once provider side effects alone.

### Failure and compatibility

Define bounded pending, accepted, failed, expired, unavailable, and uncertain states with correlated responses. Timeout after possible acceptance must not automatically generate a new execution identity. Installation changes, revocation, and stale responses cannot revive a closed session. UI closure does not imply job cancellation. Older bots/hosts retain ordinary chat; unknown plugin versions disable only plugin functionality.

### Persistence and generation

Reuse existing integration and delivery records where their contracts fit. Add only necessary durable session/submission or capability fields through additive SQLite/Postgres migrations and typed queries. Edit sqlc sources and run `pnpm generate:sqlc`; regenerate protocol/SDK outputs through repository scripts. Do not hand-edit generated storedb code.

## Implementation steps

### 1. Prepare the ClickClack worktree

**Location:** Workflow-prepared Worktrunk checkout of `/home/kas/dev/clickclack`; `AGENTS.md`, `package.json`, repository Git state.

**Change:** Before implementation mutations, inspect branch, commits, dirty and staged changes, remote state, and matching PR. Create or reuse the dedicated checkout through Worktrunk, record its absolute path and base, and preserve existing changes. This workflow does not prepare face or require a second worktree.

**Check:** The checkout belongs to ClickClack, its absolute path and baseline are recorded, existing changes are identified, and the main checkout is untouched. No merge occurs.

### 2. Trace existing owners

**Location:** `apps/web/src/components/outputs/OutputGallery.svelte`; `apps/web/src/lib/integrations.ts`; `docs/features/integrations.md`; `packages/protocol/openapi.yaml`; installation, delivery, and attachment handlers under `apps/api/internal/httpapi` and store implementations.

**Change:** Trace the actual gallery context-menu owner, installation capability storage, bot delivery transport, media authorization, and durable queue lifecycle. Record exact extension owners and the supported destination-resolution path. Identify the smallest additive contract changes needed below, without introducing a parallel transport or broad framework.

**Check:** A source-backed owner map identifies the current integration methods, authentication rules, storage boundaries, generation scripts, and test harness. Proposed APIs are explicitly distinguished from existing ones.

### 3. Define the protocol and SDK contract

**Location:** `packages/protocol/openapi.yaml`; `packages/sdk-ts`; proposed `docs/features/gallery-actions.md`; existing installed-bot registration handlers.

**Change:** Define the versioned descriptors, declarative controls, media-reference rules, open/choices/submit/status envelopes, errors, bounds, and consumer deduplication obligations. Specify compatibility and installation invalidation. Extend SDK surfaces using repository generation conventions.

**Check:** Contract generation and SDK typechecks pass. Valid non-VAI examples round-trip, while invalid versions, duplicate IDs, unbounded schemas, unsupported controls, and forbidden media/callback forms are rejected by contract tests.

### 4. Implement registration and durable host state

**Location:** `apps/api/internal/httpapi` integration registration owners and proposed `gallery_actions.go`/`gallery_actions_test.go`; `apps/api/internal/store` types and SQLite/Postgres sqlc sources and migrations as necessary.

**Change:** Implement authorized descriptor registration and host-side discovery. Add minimal durable panel/submission storage where existing records cannot represent it. Bind sessions to actor, installation, source, destination, schema revision, and expiry; implement atomic idempotency and existing durable delivery enqueueing. Add no new database or service.

**Check:** SQLite/Postgres tests prove identical authorization and uniqueness behavior, concurrent duplicate handling, payload-conflict rejection, restart recovery, migration compatibility, and installation invalidation. Unauthorized cross-installation or cross-workspace requests create no session or delivery.

### 5. Connect bot requests and responses

**Location:** Existing bot delivery and response handlers under `apps/api/internal/httpapi`; proposed gallery action service module beside those handlers; SDK bot event helpers.

**Change:** Wire panel-open, choices, submit, and status exchanges through existing authenticated delivery. Validate response producer, request correlation, revision, and size. Reauthorize access before delivering results. Bound timeouts and pagination. Preserve submission IDs across retries and represent uncertain acceptance without blind re-execution.

**Check:** A synthetic bot exercises successful and delayed responses, forged or mismatched callbacks, offline operation, revocation, stale revisions, delivery retry, lost acknowledgments, and restart. Provider execution remains simulated and duplicate requests resolve to the same fixture job.

### 6. Render gallery actions and the shared panel

**Location:** `apps/web/src/components/outputs/OutputGallery.svelte`; proposed `apps/web/src/lib/gallery-actions.ts` and `apps/web/src/components/outputs/GalleryActionPanel.svelte`; `ChatApp.svelte` only at existing gallery state boundaries.

**Change:** Add contributed action entries beside existing gallery actions. Open one generic floating panel with source preview, bounded controls, dynamic image choices, effective values, and submission status. Use stable request identities, reject late responses after navigation, restore focus, support Escape and keyboard interaction, and preserve add-to-message and gallery navigation. Handle destination selection only when required by authorized context.

**Check:** Component/state tests cover value validation, schema changes, action switching, pagination, stale responses, pending and uncertain submissions, double clicks, and focus. With no installed capability, gallery behavior is unchanged.

### 7. Verify the complete host flow

**Location:** `tests/e2e` and existing isolated Electron harness; host API and SDK tests; synthetic bot fixture within ClickClack test support.

**Change:** Exercise the full registration-to-menu-to-panel-to-submission flow with a non-VAI fixture. Verify generic behavior with different labels and field choices, and test unauthorized sources/destinations, installation removal, compatibility, reconnect, and no-plugin regressions. Run focused checks followed by repository-prescribed quality gates.

**Check:** Record passing host, store, SDK, frontend, and isolated Electron results with exact commands and revision. Synthetic execution counts prove retry deduplication. No VAI process, private conversation data, or paid provider call is required.

### 8. Document the implemented interface and handoff

**Location:** `docs/features/gallery-actions.md`; `docs/features/integrations.md`; `docs/sdk.md` where relevant; workflow handoff report.

**Change:** Document the exact implemented protocol, supported controls and limits, media upload/reference flow, registration permissions, SDK usage, deduplication obligations, lifecycle errors, and capability disable procedure. Record absolute worktree, base/head revisions, changed files, checks, and a working synthetic producer example for the next face workflow.

**Check:** The handoff is sufficient to implement VAI without guessing host APIs or editing host internals. Documentation matches tested payloads and identifies all remaining consumer obligations. Report host implementation separately from end-to-end VAI completion.

### 9. Deliver only in the separate delivery stage

**Location:** Existing ClickClack deployment procedures, only in the workflow's separate delivery stage.

**Change:** Load applicable deployment skills before live status claims. If delivery is performed, apply additive backend support before compatible frontend exposure and retain rollback through capability disablement or the previous compatible application build without destructive schema rollback. Keep the unimplemented VAI capability disabled.

**Check:** Applicable deployment completion and Electron checks establish live status; otherwise state implemented and tested, not live. Merge remains disabled. The subsequent face workflow consumes the exact tested host revision and contract.

## Tests

- Descriptor validation and permission tests, including duplicate IDs, oversized payloads, unsupported versions, secret omission, and installation ownership.
- Actor/workspace/source/destination authorization across every session operation, response delivery, revocation, and installation removal.
- Declarative schema and value validation, bounded choices pagination, media-reference authorization, and rejection of executable or arbitrary-path content.
- Atomic submission identity tests for concurrent requests, payload conflicts, transport retries, lost acknowledgments, restart recovery, and uncertain acceptance.
- SQLite/Postgres parity and additive migration tests wherever storage changes are needed; generated SDK/sqlc consistency.
- Frontend session and stale-response tests plus isolated Electron pointer, keyboard, focus, dynamic controls, and no-plugin gallery regression tests.
- Synthetic non-VAI producer end-to-end contract tests and documented SDK examples for the next workflow.

## Risks and mitigations

### Sequential scope is mistaken for simultaneous two-repository work

Prepare and modify only ClickClack here. Accept the host against its synthetic bot and launch face separately afterward; do not block on absent VAI code.

### Existing transport lacks correlation or atomic enqueueing

Inspect actual owners first and extend the existing transport narrowly. Add necessary durable records in the existing stores rather than relying on in-memory state or introducing a service.

### Bot controls or media bypass security

Bot-provided controls or media references could become a code-execution, SSRF, or access-control bypass. Use bounded declarative controls and authorized attachment references. Reject arbitrary code, HTML, callbacks, and URLs requiring server fetch; reauthorize every operation.

### Lost acknowledgments duplicate external effects

Persist submission identity, retain it across delivery retries, expose uncertain status, and require consumer deduplication. Do not claim host-only exactly-once execution.

### Registration changes leave stale actions usable

Bind schema/capability revisions, invalidate on installation changes, and revalidate at submission and response delivery.

### Host completion is confused with VAI delivery

Produce an explicit tested host handoff and track the separate face workflow. Do not claim whole-feature or live completion without corresponding evidence.

## Boundaries

The planning step made no file changes. This documentation step records the selected specification and plan only; it does not implement code.

- Only a Worktrunk-managed ClickClack checkout may be mutated in this workflow. Preserve existing work; no main-checkout edits or merges.
- Face/VAI actions, pack implementation, CLI parity, and external provider integration belong to the second workflow.
- No VAI-specific production host branches, broad plugin platform, remote executable UI, arbitrary filesystem browsing, new service, or unrelated repository changes.
- Use existing authorization and approval boundaries. No paid generation or production private data is needed for host verification.
- Deployment remains separate. Verify desktop UI in Electron and report implementation, test, and live status distinctly.
