// Live workflow run state for a conversation.
//
// A bot running a workflow on a conversation's behalf publishes its run as an
// ephemeral workflow.run frame. The frame is the current state, not an update to
// apply, so the newest one for a conversation wins outright and no history is
// accumulated here.
//
// Ephemeral means there is no replay: a client that reloads sees nothing until
// the next frame. That is deliberate. The run belongs to the workflow host, and
// a client inventing state from a stale frame would be worse than showing none.

import type { RealtimeEvent } from "../types";

export type RunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "paused"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "ambiguous";

export type StepOutcome = "ok" | "timed_out" | "failed" | "cancelled";

export type RunStep = {
  attemptId: string;
  nodeId: string;
  nodeType: string;
  outcome: StepOutcome;
  startedAt: string;
  finishedAt: string;
};

export type WorkflowRun = {
  runId: string;
  workflowName: string;
  status: RunStatus;
  /** Host-authored explanation of the current status, when there is one. */
  reason: string | null;
  live: boolean;
  /** The host cannot confirm this run survived its last write. */
  possiblyInterrupted: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Steps taken so far, oldest first. May be a window rather than the whole run. */
  steps: RunStep[];
  /** Total steps taken, which can exceed steps.length. */
  stepTotal: number;
};

const runStatuses = new Set<string>([
  "queued",
  "running",
  "waiting",
  "paused",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "ambiguous",
]);

const stepOutcomes = new Set<string>(["ok", "timed_out", "failed", "cancelled"]);

/** Statuses where the run is over and nothing further will happen. */
const terminalStatuses = new Set<RunStatus>(["completed", "failed", "timed_out", "cancelled"]);

export function isRunFinished(run: WorkflowRun): boolean {
  return terminalStatuses.has(run.status);
}

/** True when the run is stopped waiting for a person. */
export function isRunWaiting(run: WorkflowRun): boolean {
  return run.status === "waiting";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a workflow.run frame.
 *
 * Returns undefined for any event that is not one, and null for a frame
 * explicitly clearing the conversation's run. The two are different: undefined
 * means this event says nothing about runs, null means the run is gone.
 *
 * A malformed run reads as null rather than as a partial run. Showing half a run
 * confidently is worse than showing none.
 */
export function readWorkflowRunFrame(event: RealtimeEvent): WorkflowRun | null | undefined {
  if (event.type !== "workflow.run") return undefined;
  const payload = event.payload as Record<string, unknown> | undefined;
  if (!isRecord(payload)) return undefined;
  if (!("run" in payload)) return undefined;
  return readRun(payload.run);
}

function readRun(value: unknown): WorkflowRun | null {
  if (!isRecord(value)) return null;

  const { runId, workflowName, status } = value;
  if (typeof runId !== "string" || runId === "") return null;
  if (typeof workflowName !== "string" || workflowName === "") return null;
  if (typeof status !== "string" || !runStatuses.has(status)) return null;

  return {
    runId,
    workflowName,
    status: status as RunStatus,
    reason: typeof value.reason === "string" ? value.reason : null,
    live: value.live === true,
    possiblyInterrupted: value.possiblyInterrupted === true,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null,
    steps: readSteps(value.steps),
    stepTotal: typeof value.stepTotal === "number" ? value.stepTotal : 0,
  };
}

function readSteps(value: unknown): RunStep[] {
  if (!Array.isArray(value)) return [];
  const steps: RunStep[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { attemptId, nodeId, nodeType, outcome, startedAt, finishedAt } = entry;
    if (typeof attemptId !== "string") continue;
    if (typeof nodeId !== "string") continue;
    if (typeof nodeType !== "string") continue;
    if (typeof outcome !== "string" || !stepOutcomes.has(outcome)) continue;
    if (typeof startedAt !== "string" || typeof finishedAt !== "string") continue;
    steps.push({
      attemptId,
      nodeId,
      nodeType,
      outcome: outcome as StepOutcome,
      startedAt,
      finishedAt,
    });
  }
  return steps;
}

/**
 * Applies one frame to the per-conversation run map.
 *
 * Returns the same map when the event changes nothing, so a caller can skip a
 * reactive update. A cleared run drops its conversation rather than storing
 * null, keeping "no run" as one representation.
 */
export function applyWorkflowRunFrame(
  runs: ReadonlyMap<string, WorkflowRun>,
  conversationID: string,
  run: WorkflowRun | null,
): ReadonlyMap<string, WorkflowRun> {
  if (conversationID === "") return runs;
  if (run === null) {
    if (!runs.has(conversationID)) return runs;
    const next = new Map(runs);
    next.delete(conversationID);
    return next;
  }
  const next = new Map(runs);
  next.set(conversationID, run);
  return next;
}

/** Human-facing label for a run status. */
export function runStatusLabel(run: WorkflowRun): string {
  switch (run.status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting on you";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "timed_out":
      return "Timed out";
    case "cancelled":
      return "Cancelled";
    case "ambiguous":
      return "Unknown";
  }
}
