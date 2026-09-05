import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeWorkflowRecords,
  snapshotRun,
  workflowFileTree,
  type WorkflowRunRecord,
} from "./chat/workflow-snapshots.ts";

function record(id: string, revision = 1): WorkflowRunRecord {
  return {
    id,
    workspace_id: "ws",
    channel_id: "channel",
    producer_id: "bot",
    updated_at: "2026-09-01T00:00:00Z",
    snapshot: {
      schema: "clickclack.workflow-snapshot.v1",
      source: { provider: "pi-workflows", sessionId: "session", runId: "same-run", revision },
      run: {
        workflowName: "test",
        status: "completed",
        reason: null,
        possiblyInterrupted: false,
        startedAt: null,
        finishedAt: null,
        stepTotal: 2,
        stepsComplete: true,
      },
      steps: [1, 2].map((attempt) => ({
        attemptId: String(attempt),
        nodeId: "same-node",
        nodeType: "task",
        outcome: "ok",
        startedAt: "2026-09-01T00:00:00Z",
        finishedAt: "2026-09-01T00:01:00Z",
      })),
      files: null,
    },
  };
}

test("durable records survive live clears, stale pages and later runs without mixing producers", () => {
  const first = record("wfr_1", 3);
  const second = { ...record("wfr_2"), producer_id: "other-bot" };
  const records = mergeWorkflowRecords([first], [second, record("wfr_1", 2)]);
  assert.deepEqual(
    records.map((r) => r.id),
    ["wfr_2", "wfr_1"],
  );
  assert.equal(records[1]?.snapshot.source.revision, 3);
  assert.equal(mergeWorkflowRecords(records, []).length, 2);
  assert.equal(snapshotRun(first).live, false);
  assert.equal(snapshotRun(first).steps.length, 2);
  assert.equal(snapshotRun(first).status, "completed");
  assert.equal(first.snapshot.files, null);
});

test("equal revisions do not replace accepted detail; higher revision does", () => {
  const first = record("wfr_1");
  const conflict = { ...first, producer_id: "spoof" };
  assert.equal(mergeWorkflowRecords([first], [conflict])[0], first);
  const newer = record("wfr_1", 2);
  assert.equal(mergeWorkflowRecords([first], [newer])[0], newer);
});

test("file tree preserves relative paths, rename evidence and directory/leaf collisions", () => {
  const tree = workflowFileTree({
    source: "host-git",
    basis: "cumulative-since-base",
    baseRevision: "abc",
    attribution: "includes-preexisting-changes",
    complete: false,
    truncated: true,
    entries: [
      { path: "src/main.ts", change: "modified" },
      { path: "docs/new.md", oldPath: "docs/old.md", change: "renamed" },
      { path: "src", change: "deleted" },
    ],
  });
  assert.deepEqual(
    tree.map((n) => n.name),
    ["docs", "src"],
  );
  assert.equal(tree[0]?.children[0]?.entry?.oldPath, "docs/old.md");
  assert.equal(tree[1]?.entry?.change, "deleted");
  assert.equal(tree[1]?.children[0]?.path, "src/main.ts");
});
