# VAI workspace gallery (KAS-768)

**Status: Selected for implementation. This documentation change does not implement, verify or deploy it.**

This document preserves the selected plan. The statement that the planning step changes no files records the earlier design-step boundary; this step only records that plan in documentation.

## Summary

Implement one workspace-scoped VAI gallery backed by existing ClickClack messages. Add a narrow authorized output-discovery endpoint rather than repurposing text search: inspected SQLite search explicitly returns no results for an empty query and otherwise uses FTS. Reuse its authorization and cursor conventions, not its text-search semantics. Render response cards with exact source navigation and preserved gallery return state. No external producer changes, duplicated output database, or new service is required.

## Contracts

- Add GET /api/workspaces/{workspace_id}/outputs with required author_id and optional cursor and limit. It returns {outputs: Message[], next_cursor: string|null}, using existing Message attachment and source identifiers. Supply conversation display context through existing authorized conversation data or a documented bounded response field, never per-card lookups.
- Define an output as a nondeleted ordinary message from the selected stable bot user ID in the requested workspace: kind=message, including the existing legacy default representation if storage uses one. Exclude agent_commentary and agent_tool. Include attachment-only and text-only messages. Do not claim this proves generation completion beyond the existing message-kind contract.
- Resolve the producer through an existing verified installation-to-user mapping if available. Otherwise provide a one-time gallery source selection from authorized bot identities and persist the chosen immutable user ID locally, keyed by current user and workspace. Display the selected account clearly. Do not silently select by display name, guessed ID, or message contents; missing or ambiguous mapping produces a source-selection state, not an empty gallery.
- Order by normalized created_at descending and message ID descending. Bind cursors to workspace, requester, author, ordering, and endpoint version. Recheck authorization on every page. Return only messages from conversations the requester may read, including explicit direct-conversation membership checks.
- Retain existing /api/search behavior, existing message shapes, source URLs, and ordinary chat routing. The gallery's latest action fetches a fresh first page with limit=1 using the same eligibility and permission rules.
- The API is additive and uses existing storage. No content backfill or new output table is planned. Add indexes only if query-plan evidence warrants them, with equivalent SQLite/Postgres migrations. Edit sqlc query/schema sources and regenerate with pnpm generate:sqlc.

## Implementation steps

### 1. Producer identity

**Location:** apps/web/src/lib/bots.ts, apps/web/src/lib/app-catalog.ts, existing authorized workspace bot/user retrieval, and new apps/web/src/lib/output-gallery.ts.

**Change:** Establish the gallery producer binding and output eligibility using existing bot installation/user contracts. Prefer an authoritative mapping; implement the explicit stable-ID source selector fallback when no such mapping exists. Specify deleted-account and changed-source behavior without inspecting or modifying an external VAI repository.

**Verification:** Fixtures with duplicate display names, renamed bots, missing mappings, different workspaces, and deleted bindings select only the intended immutable identity or present source selection. No guessed production IDs are committed.

### 2. API and store contracts

**Location:** packages/protocol/openapi.yaml, apps/api/internal/store/types.go, new apps/api/internal/store/output_pages.go, and packages/sdk-ts generated types/client surface as required by repository generation conventions.

**Change:** Define the additive output endpoint and store request/page types, including response eligibility, cursor semantics, limits, and errors. Keep output results based on the existing Message schema. Define invalid cursors as validation errors and inaccessible workspaces/sources using existing non-disclosing API conventions.

**Verification:** Contract generation and typechecks pass. Existing search and SDK consumers remain compatible. Unit tests prove limit normalization, cursor scope binding, deterministic tie ordering, and malformed-cursor rejection.

### 3. Message retrieval

**Location:** apps/api/internal/store/sqlite/search_pages.go and postgres/search_pages.go as authorization references; new output-page implementations and each backend's sqlc query sources; existing migration directories only for justified indexes.

**Change:** Implement bounded message-backed retrieval in both stores using typed SQL. Apply author, workspace, ordinary-kind, nondeleted, and conversation-visibility predicates before limiting. Batch existing message/attachment hydration for the page, avoiding per-result queries. Reuse or extract existing search authorization rules without changing FTS behavior. Inspect execution plans before deciding whether an additive index is needed.

**Verification:** SQLite and Postgres integration tests return identical eligible IDs and ordering, exclude inaccessible channel/DM messages, include attachment-only history, and paginate more than one page without omissions or duplicates. Query count stays bounded with page size; plans demonstrate indexed or otherwise justified bounded retrieval.

### 4. HTTP endpoint

**Location:** apps/api/internal/httpapi route registration and new output_pages.go/output_pages_test.go beside existing search_test.go.

**Change:** Wire the endpoint through existing authentication and workspace authorization. Validate the selected author as a workspace bot identity without exposing inaccessible content. Return hydrated pages, distinguish invalid requests from transient errors, and use existing safe HTTP error mapping.

**Verification:** HTTP tests cover anonymous access, nonmembers, public/private channels, member/nonmember DMs, wrong-workspace authors, activity exclusions, deleted messages, attachment-only responses, cursor reuse by another requester, and membership revocation between pages.

### 5. Source navigation

**Location:** apps/web/src/ChatApp.svelte openSearchResult/navigation handling and a small apps/web/src/lib/chat/message-source-navigation.ts helper where extraction fits existing state ownership.

**Change:** Extract only the shared source-reveal operation needed by search and gallery from existing openSearchResult behavior. Accept workspace, conversation, message, and thread identifiers; resolve authoritative source access before revealing, load off-window messages, and highlight the exact target. Preserve search behavior. Add an in-memory gallery return token with selected card, cursor pages, scroll anchor, and focus target.

**Verification:** Navigation tests cover off-window channel messages, DM messages, thread replies, duplicate navigation requests, removed/inaccessible sources, and return to the same gallery card and scroll position. Existing search source-reveal tests remain passing.

### 6. Gallery view

**Location:** apps/web/src/ChatApp.svelte, apps/web/src/components/navigation/Sidebar.svelte or its existing entry-owner component, new apps/web/src/components/outputs/OutputGallery.svelte and OutputCard.svelte, and narrowly scoped styles.

**Change:** Add a single native workspace gallery destination and entry point using the existing app navigation conventions. Implement paginated response cards, safe existing media rendering, conversation labels, ordinary text/file fallbacks, and a latest-response action. Keep the gallery out of the message timeline and avoid broad router refactoring.

**Verification:** Component and Electron tests verify gallery entry, multi-page media browsing, keyboard access, latest-response reveal, source navigation, return behavior, workspace scope labeling, and no unintended changes to conversation chronology or unread state.

### 7. Session and failure handling

**Location:** apps/web/src/lib/output-gallery.ts and existing ChatApp.svelte realtime, workspace-switch, and session-reset integration points.

**Change:** Implement isolated gallery request/session state: cancel or invalidate stale requests on workspace/source changes; retain successful pages on load-more failure; show retry, empty, source-selection, unavailable-media, and inaccessible-source states. Revalidate after reconnect, focus, and return. Apply existing message deletion/update and permission-change signals to remove or refresh affected cached cards without silently reordering a scrolled gallery. Refresh latest explicitly from the server.

**Verification:** State tests prove old requests cannot populate a new workspace or source, load-more retry does not duplicate entries, deleted/revoked content is removed on known invalidation, reconnect revalidation works, and a fresh latest request sees newly inserted eligible output.

### 8. Verification and rollout

**Location:** Store and HTTP test suites, frontend tests, tests/e2e and existing Electron verification harness, repository package scripts, and existing deployment procedures.

**Change:** Run focused store, HTTP, frontend, and existing search/navigation checks, then repository quality gates. Exercise the gallery end to end in an isolated Electron session with synthetic data. Release through the workflow's existing deployment stage, serving the additive backend before or with the gallery frontend. No desktop rebuild is required unless shell changes actually occur.

**Verification:** Record passing relevant SQLite/Postgres tests, typecheck/lint/format checks, and Electron proof for newest output, older-page browsing, exact source/thread jumps, return state, and failure handling. Load applicable deployment skills at deployment time and claim live completion only after their checks pass; otherwise report implemented and tested, not live.

## Tests

- Producer identity: renamed or duplicate-name bots, no mapping, explicit stable-ID binding, deleted account, and user/workspace-local binding isolation.
- API/store: ordinary versus activity kinds, attachment-only/text-only/multiple-attachment messages, deleted content, mixed timestamp precision, tie ordering, full-page boundaries, concurrent inserts, and bounded hydration.
- Authorization: private channels, direct-conversation membership, removed membership between pages, cross-workspace authors, and cursor scope/requester mismatches.
- Navigation: unloaded source message, DM, thread reply, source deletion or access loss, repeated clicks, and restored gallery position/focus; regress existing search behavior.
- UI/session: empty, initial failure, load-more failure and retry, unsupported/broken media, stale requests, workspace/source switch, reconnect, and fresh latest lookup.
- Electron: keyboard and pointer gallery flows with synthetic history spanning several pages, media cards and fallback cards, exact source highlighting, and return to gallery.

## Risks and mitigations

### Producer mapping

**Risk:** No verified automatic VAI identity mapping exists in the inspected evidence.

**Mitigation:** Use explicit selection of an authorized stable bot identity as a contained gallery setup fallback; never guess a production account or require producer changes.

### Response eligibility

**Risk:** Author identity alone could include progress or tool messages.

**Mitigation:** Filter using the existing ordinary-message kind contract, exclude agent_commentary and agent_tool, and describe the result as responses rather than claiming unverified generation-completion semantics.

### Text-search compatibility

**Risk:** Extending text search would change established empty-query behavior or omit attachment-only messages.

**Mitigation:** Use a separate additive output endpoint and typed message queries while sharing authorization conventions. The inspected SQLite FTS implementation makes this correction necessary.

### Conversation privacy

**Risk:** Workspace discovery could disclose private channel or DM content.

**Mitigation:** Enforce conversation visibility within the database query before pagination and on every request; test revocation, hydration, and cursor boundaries in both backends.

### Navigation complexity

**Risk:** Gallery integration could expand the already large ChatApp orchestration or break search return behavior.

**Mitigation:** Keep retrieval/session state in one small owner and extract only the source-reveal interface needed by both callers; regression-test search rather than redesigning navigation.

### Stale content

**Risk:** Cached cards or external media can become stale or unavailable.

**Mitigation:** Invalidate on known access/content events, revalidate on return and reconnect, authorize source fetches, and show explicit unavailable states. Do not promise external retention or immediate offline revocation.

## Boundaries

- All implementation remains in /home/kas/dev/clickclack or the workflow-managed checkout of that same repository. This planning step changes no files.
- Do not modify VAI, OpenClaw, pi-clickclack, upstream projects, sibling repositories, or external services.
- No output-copy database, indexing service, media proxy, thumbnail-generation service, or new infrastructure resource.
- No second conversation panel, advanced filter suite, generic asset manager, producer-protocol redesign, or unrelated UI cleanup.
- No scraping live conversation history for identity inference or test fixtures. Use authorized contracts and synthetic test data.
- Deployment uses existing procedures only; infrastructure redesign and unrelated desktop changes are excluded.
