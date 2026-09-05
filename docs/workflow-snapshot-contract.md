# KAS-769 workflow snapshot contract

Implementation contract, not a shipped-state claim.

## Scope and ownership

ClickClack owns conversation-authorized durable presentation history. pi-clickclack publishes a safe projection of host-authored data. The workflow host owns run status, step records and workspace provenance. Decisions still travel through the existing conversation reply and host presentation-claim path. No new approve/control endpoint.

The API stores one current snapshot per authenticated bot, conversation, provider, session and run. Terminal runs remain readable after reload, another run starts, watcher shutdown or a null ephemeral frame. Step history contains attempts, not the graph's latest attempt per node.

## Snapshot v1

The authenticated envelope contains `workspace_id` and exactly one of `channel_id` or `direct_conversation_id`, plus `snapshot`. The server derives producer identity from authentication.

```ts
type Snapshot = {
  schema: "clickclack.workflow-snapshot.v1";
  source: { provider: "pi-workflows"; sessionId: string; runId: string; revision: number };
  run: {
    workflowName: string;
    status: "queued" | "running" | "waiting" | "paused" | "completed" | "failed" | "timed_out" | "cancelled" | "ambiguous";
    reason: string | null;
    possiblyInterrupted: boolean;
    startedAt: string | null;
    finishedAt: string | null;
    stepTotal: number;
    stepsComplete: boolean;
  };
  steps: Array<{
    attemptId: string; nodeId: string; nodeType: string;
    outcome: "ok" | "timed_out" | "failed" | "cancelled";
    startedAt: string; finishedAt: string;
  }>;
  files: null | {
    source: "host-git";
    basis: "cumulative-since-base";
    baseRevision: string;
    attribution: "clean-baseline" | "includes-preexisting-changes";
    complete: boolean;
    truncated: boolean;
    entries: Array<{
      path: string;
      change: "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed" | "unmerged" | "untracked";
      oldPath?: string;
    }>;
  };
};
```

`files: null` means unavailable, never an observed clean workspace. No absolute roots, file content, patches, commands, prompts, arbitrary state, or model-authored file claims enter this contract. File metadata is only from a host-validated prepared workspace and base revision. The host exposes the same files shape as optional `WorkflowRunView.operatorArtifacts.changedFiles`; it must freeze it consistently with the run revision, not recalculate changing Git state under an unchanged revision. Unsupported workflows report unavailable.

## API and ordering

Proposed SDK-facing routes: `POST /api/workflow-runs`, `GET /api/channels/{channelID}/workflow-runs`, and `GET /api/dms/{directConversationID}/workflow-runs`. Implementers may align the direct-conversation route spelling with existing router conventions, then record the final routes here before handing off the bridge.

Publishing requires a bot token and explicit `agent_activity:write` in addition to existing workspace/target write checks. Reads require current conversation membership/access. Use server-derived direct-message recipients for notifications. No workspace-wide frame.

A higher revision replaces the current snapshot transactionally. A lower revision is a harmless stale replay. Equal revision and canonical payload digest is idempotent; equal revision with different content is a conflict. Namespace every uniqueness/order decision by authenticated producer and target. Bound page sizes and return an explicit cursor or has-more signal.

Bound all fields: identifiers 256 characters, workflow name 256, reason 4096, paths 1024, steps 1000, files 500, serialized snapshot 512 KiB. Timestamps must parse, revisions/totals must be nonnegative safe integers, attempt IDs must be unique, stepTotal cannot be below supplied count. Reject unknown status/outcome/file enums and invalid paths (absolute, traversal, controls, NUL). `complete` cannot coexist with `truncated`. Incomplete history must be labeled, never silently presented as complete. Required bounds may be made stricter for existing platform request limits.

The bridge pages host `state.steps`, verifies a consistent revision, and publishes a bounded full projection with truthful stepsComplete. It retains retryable publication state and never marks delivered before acknowledgment. A transient disconnect is not completion. A stopped watcher does not delete durable history. Final host snapshots must be persisted before the active pointer is cleared.

## UI and verification

Use the existing run side panel and decision buttons. Add a durable run list/current detail, chronological attempt activity, conversation activity where appropriate, and an expandable relative-path file tree with explicit unavailable/truncated/pre-existing-change states. Keep the existing conservative active-decision eligibility check. Read-only panel controls may navigate to the actual prompt; never submit a host decision directly.

Test storage/API authorization for both database backends, stale/equal revision handling, pagination, invalid payloads, target isolation, completed-run reload, attempt history and file validation. Add browser-independent reducer tests and Electron end-to-end coverage. Verify a real disposable workflow through host, bridge, API and Electron before deployment completion. Mocked fixtures alone aren't live proof.

## Work lanes

- ClickClack API/storage/SDK/UI: `/home/kas/dev/clickclack.kas-769-workflow-activity`, sole writer.
- Host/SDK: isolated source checkout of `osolmaz/pi-workflows` matching installed `0.16.0`, sole writer. No installed package edits during implementation.
- pi-clickclack: separate Worktrunk worktree after the ClickClack contract and host projection are ready.
- Parent owns integration, review, final live checks, deployment coordination and the customization ledger.

## Final ClickClack API / SDK handoff (KAS-769)

- `POST /api/workflow-runs`: JSON `PublishWorkflowSnapshotRequest`, snake-case envelope `{ workspace_id, channel_id?, direct_conversation_id?, snapshot }`. Exactly one target. `snapshot` is the camel-case v1 shape above, including required nullable `files`, reason and timestamps. Response 200 `PublishWorkflowSnapshotResponse`: `{ record: WorkflowRunRecord, changed: boolean }`. `changed=false` acknowledges a lower revision (returns stored newer record) or an identical equal revision. Equal revision with a different canonical typed JSON SHA-256 digest is 409. Key order is irrelevant; array order is significant. Unknown snapshot fields are rejected. No answer endpoint.
- `GET /api/channels/{channel_id}/workflow-runs` and `GET /api/dms/{conversation_id}/workflow-runs`: response `WorkflowRunPage` `{ runs: WorkflowRunRecord[], next_cursor?: string }`. Query `limit` defaults to 10, must be 1..20; pass opaque `next_cursor` as `cursor`. Ordering is descending stable server-generated first-publication ULID, not update time; newer revisions do not move a run between pages. Records include full detail, so no separate detail request is needed.
- `WorkflowRunRecord`: `{ id, workspace_id, channel_id?, direct_conversation_id?, producer_id, snapshot, updated_at }`. IDs and `producer_id` are server-authored. Namespace: workspace + exact target + authenticated bot user + provider + sessionId + runId. Stop/null ephemeral frames do not modify these records.
- TypeScript SDK exports: `WorkflowSnapshot`, `WorkflowFiles`, `WorkflowRunRecord`, `WorkflowRunPage`, `PublishWorkflowSnapshotRequest`, `PublishWorkflowSnapshotResponse`. Client methods: `client.workflowRuns.publish(input)`, `.listChannel(channelId, {cursor?,limit?})`, `.listDirect(conversationId, {cursor?,limit?})`.
- Publishing requires a bot token with explicit `agent_activity:write` and `messages:write`; DMs also require `dms:write`. Workspace token restriction and current target membership/write/moderation checks apply. Reads require `messages:read` (and `dms:read` for DMs) for bot tokens, token workspace scope and current conversation access for all actors.
- Scoped cursorless realtime event `workflow.snapshot`: payload `{ record, channel_id, direct_conversation_id, user_id }`, only after a changed write commits. Channel ID is on the event envelope; DM recipients are server-derived. This is an optimization, not durable replay: reload/reconnect reads authoritative pages.
- Additional safe-path restrictions: no backslashes, colons, empty/`.` path segments; all relative path segments must be non-traversing and control-free. `stepsComplete=true` requires `stepTotal===steps.length`. Identifiers/name bounds count Unicode code points. Files may be null; no inferred clean state or tool-derived evidence.

## Implementation verification handoff

`tests/electron/workflow-history.mjs` stages production web assets and the candidate API in a temporary tree, uses a fresh SQLite database and an isolated Electron `userData` path, and launches the actual worktree desktop main/preload. Run with Node 24.20.0 and pinned pnpm after `pnpm build:web && pnpm build:desktop`:

```
CLICKCLACK_ELECTRON_EXECUTABLE=/path/to/existing/electron xvfb-run -a node tests/electron/workflow-history.mjs
```

The harness does not install Electron, touch installed app settings or a live service, or claim a real host/bridge execution. It covers reload history, repeated attempts, realtime durable updates, retained history after null live frames, file-tree expansion and rename provenance, incomplete/unavailable states, and existing conversation decision replies/stale suppression. Production embedded assets are intentionally left to the parent deployment step.
