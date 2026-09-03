import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkflowRunFrame,
  isRunFinished,
  isRunWaiting,
  readWorkflowRunFrame,
  runStatusLabel,
  type WorkflowRun,
} from "./chat/workflow-run.ts";
import type { RealtimeEvent } from "./types.ts";

function frame(run: unknown, channelID = "chn_1"): RealtimeEvent {
  return {
    id: "eph_1",
    cursor: "",
    type: "workflow.run",
    workspace_id: "wsp_1",
    channel_id: channelID,
    created_at: "2026-09-03T10:00:00.000Z",
    payload: { run },
  } as RealtimeEvent;
}

function rawRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "run_1",
    workflowName: "ship-it",
    status: "running",
    reason: null,
    live: true,
    possiblyInterrupted: false,
    startedAt: "2026-09-03T10:00:00.000Z",
    finishedAt: null,
    steps: [
      {
        attemptId: "a1",
        nodeId: "plan",
        nodeType: "agent",
        outcome: "ok",
        startedAt: "2026-09-03T10:00:00.000Z",
        finishedAt: "2026-09-03T10:00:20.000Z",
      },
    ],
    stepTotal: 3,
    ...overrides,
  };
}

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: "run_1",
    workflowName: "ship-it",
    status: "running",
    reason: null,
    live: true,
    possiblyInterrupted: false,
    startedAt: null,
    finishedAt: null,
    steps: [],
    stepTotal: 0,
    ...overrides,
  };
}

test("a run frame reads into a run", () => {
  const parsed = readWorkflowRunFrame(frame(rawRun()));
  assert.equal(parsed?.runId, "run_1");
  assert.equal(parsed?.workflowName, "ship-it");
  assert.equal(parsed?.status, "running");
  assert.equal(parsed?.steps.length, 1);
  assert.equal(parsed?.stepTotal, 3);
});

// undefined means "this event says nothing about runs"; null means "the run is
// gone". Collapsing them would make an unrelated event clear the sidebar.
test("a non-run event says nothing about runs", () => {
  const other = { ...frame(rawRun()), type: "message.created" } as RealtimeEvent;
  assert.equal(readWorkflowRunFrame(other), undefined);
});

test("a frame with no run key says nothing about runs", () => {
  const empty = { ...frame(rawRun()), payload: {} } as RealtimeEvent;
  assert.equal(readWorkflowRunFrame(empty), undefined);
});

test("an explicit null run clears the conversation", () => {
  assert.equal(readWorkflowRunFrame(frame(null)), null);
});

test("a malformed run clears rather than showing half a run", () => {
  const cases: Record<string, unknown> = {
    "no run id": rawRun({ runId: undefined }),
    "empty run id": rawRun({ runId: "" }),
    "no workflow name": rawRun({ workflowName: undefined }),
    "unknown status": rawRun({ status: "vibing" }),
    "not an object": "nope",
  };
  for (const [name, value] of Object.entries(cases)) {
    assert.equal(readWorkflowRunFrame(frame(value)), null, name);
  }
});

test("an unreadable step drops without dropping the run", () => {
  const parsed = readWorkflowRunFrame(
    frame(
      rawRun({
        steps: [
          {
            attemptId: "a1",
            nodeId: "plan",
            nodeType: "agent",
            outcome: "ok",
            startedAt: "s",
            finishedAt: "f",
          },
          {
            attemptId: "a2",
            nodeId: "bad",
            nodeType: "agent",
            outcome: "vibing",
            startedAt: "s",
            finishedAt: "f",
          },
          "not a step",
          null,
        ],
      }),
    ),
  );
  assert.deepEqual(
    parsed?.steps.map((step) => step.nodeId),
    ["plan"],
  );
});

test("a run with no steps is still a run", () => {
  const parsed = readWorkflowRunFrame(frame(rawRun({ steps: undefined, stepTotal: 0 })));
  assert.deepEqual(parsed?.steps, []);
  assert.equal(parsed?.runId, "run_1");
});

test("a newer frame replaces the conversation's run outright", () => {
  let runs: ReadonlyMap<string, WorkflowRun> = new Map();
  runs = applyWorkflowRunFrame(runs, "chn_1", run({ status: "running" }));
  runs = applyWorkflowRunFrame(runs, "chn_1", run({ status: "waiting" }));
  assert.equal(runs.get("chn_1")?.status, "waiting");
  assert.equal(runs.size, 1);
});

test("runs are kept per conversation", () => {
  let runs: ReadonlyMap<string, WorkflowRun> = new Map();
  runs = applyWorkflowRunFrame(runs, "chn_1", run({ runId: "run_1" }));
  runs = applyWorkflowRunFrame(runs, "dm_1", run({ runId: "run_2" }));
  assert.equal(runs.get("chn_1")?.runId, "run_1");
  assert.equal(runs.get("dm_1")?.runId, "run_2");
});

test("a cleared run drops its conversation", () => {
  let runs: ReadonlyMap<string, WorkflowRun> = new Map();
  runs = applyWorkflowRunFrame(runs, "chn_1", run());
  runs = applyWorkflowRunFrame(runs, "chn_1", null);
  assert.equal(runs.has("chn_1"), false);
});

// Returning the same map lets a caller skip a reactive update entirely.
test("clearing a conversation that has no run changes nothing", () => {
  const runs: ReadonlyMap<string, WorkflowRun> = new Map();
  assert.equal(applyWorkflowRunFrame(runs, "chn_1", null), runs);
});

test("a frame with no conversation is ignored", () => {
  const runs: ReadonlyMap<string, WorkflowRun> = new Map();
  assert.equal(applyWorkflowRunFrame(runs, "", run()), runs);
});

test("finished and waiting runs are recognized", () => {
  for (const status of ["completed", "failed", "timed_out", "cancelled"] as const) {
    assert.equal(isRunFinished(run({ status })), true, status);
  }
  for (const status of ["queued", "running", "waiting", "paused"] as const) {
    assert.equal(isRunFinished(run({ status })), false, status);
  }
  assert.equal(isRunWaiting(run({ status: "waiting" })), true);
  assert.equal(isRunWaiting(run({ status: "running" })), false);
});

test("every status has a label", () => {
  const statuses = [
    "queued",
    "running",
    "waiting",
    "paused",
    "completed",
    "failed",
    "timed_out",
    "cancelled",
    "ambiguous",
  ] as const;
  for (const status of statuses) {
    assert.notEqual(runStatusLabel(run({ status })), "", status);
  }
  assert.equal(runStatusLabel(run({ status: "waiting" })), "Waiting on you");
});
