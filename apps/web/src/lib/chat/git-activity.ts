import type { Message } from "../types";

const FENCE = /(?:^|\n)```clickclack-git-activity\s*\n([\s\S]*?)\n```(?:\n|$)/u;
const ACTIONS = new Set(["commit", "push", "merge"]);
const OUTCOMES = new Set(["succeeded", "failed"]);

export type GitActivity = {
  v: 1;
  action: "commit" | "push" | "merge";
  outcome: "succeeded" | "failed";
  repository: {
    name: string;
    url?: string;
  };
  branch?: string;
  commit?: {
    sha: string;
    subject: string;
    url?: string;
  };
  project: string;
  session: {
    id: string;
    turnId: string;
  };
  occurredAt: string;
};

export function readGitActivity(message: Message): GitActivity | null {
  if (message.kind !== undefined && message.kind !== "message") return null;
  if (message.author?.kind !== "bot") return null;
  const match = FENCE.exec(message.body);
  if (!match?.[1]) return null;
  let value: unknown;
  try {
    value = JSON.parse(match[1]);
  } catch {
    return null;
  }
  return isGitActivity(value) ? value : null;
}

export function stripGitActivityBlock(body: string): string {
  return body.replace(FENCE, "\n").trim();
}

function isGitActivity(value: unknown): value is GitActivity {
  if (!isRecord(value) || value.v !== 1) return false;
  if (typeof value.action !== "string" || !ACTIONS.has(value.action)) return false;
  if (typeof value.outcome !== "string" || !OUTCOMES.has(value.outcome)) return false;
  if (!isRecord(value.repository) || !nonempty(value.repository.name)) return false;
  if (value.repository.url !== undefined && !safeWebURL(value.repository.url)) return false;
  if (!nonempty(value.project) || !nonempty(value.occurredAt)) return false;
  if (!isRecord(value.session) || !nonempty(value.session.id) || !nonempty(value.session.turnId)) {
    return false;
  }
  if (value.branch !== undefined && !nonempty(value.branch)) return false;
  if (value.commit !== undefined) {
    if (!isRecord(value.commit) || !nonempty(value.commit.sha)) return false;
    if (typeof value.commit.subject !== "string") return false;
    if (value.commit.url !== undefined && !safeWebURL(value.commit.url)) return false;
  }
  return true;
}

function safeWebURL(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
