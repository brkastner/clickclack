// Reads the machine-readable half of a workflow decision prompt.
//
// A decision that stops a workflow arrives as agent_commentary carrying a
// namespaced turn_id (see decisionSound.ts, which alerts on the same marker).
// The body is a numbered list, and the Pi bridge appends a fenced block naming
// the same choices as data.
//
// The block exists so this client never parses prose the bridge just formatted.
// Each choice carries the reply text explicitly rather than this side rebuilding
// it from list position, so the string a button sends is byte-identical to the
// string an operator would type. The prose stays authoritative: a prompt with no
// parseable block renders as it always did and is answered by typing.

const DECISION_TURN_PREFIX = "decision:";
const FENCE_LANGUAGE = "clickclack-decision";

// Tolerates the trailing newline variations a markdown author can emit and
// anchors on the fence itself, so ordinary code blocks in a body cannot match.
const FENCE = new RegExp("^```" + FENCE_LANGUAGE + "\\s*\\n([\\s\\S]*?)\\n?^```\\s*$", "m");

export type DecisionChoice = {
  /** The reply an operator would type to pick this choice. */
  reply: string;
  label: string;
  /**
   * True when the choice needs text after the number.
   *
   * The bridge treats a bare number on such a choice as unmatched, so a button
   * cannot send it. It prefills the composer instead.
   */
  needsInput: boolean;
};

export type DecisionPrompt = {
  choices: DecisionChoice[];
  /** Reply that leaves the decision pending for another presenter. */
  dismiss: string;
};

type RawBlock = {
  v?: unknown;
  choices?: unknown;
  dismiss?: unknown;
};

/** True when this message is a workflow decision prompt awaiting an answer. */
export function isDecisionMessage(message: {
  kind?: string;
  turn_id?: string;
}): boolean {
  if (message.kind !== "agent_commentary") return false;
  return typeof message.turn_id === "string" && message.turn_id.startsWith(DECISION_TURN_PREFIX);
}

/**
 * Extracts the choices a decision prompt advertises.
 *
 * Returns null for anything not recognized: a missing block, a version this
 * client does not know, malformed JSON, or a block naming no choices. Every one
 * of those falls back to the prose, which is always present.
 */
export function readDecisionPrompt(body: string): DecisionPrompt | null {
  const fence = FENCE.exec(body);
  if (fence === null) return null;

  let raw: RawBlock;
  try {
    raw = JSON.parse(fence[1] ?? "") as RawBlock;
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object") return null;
  // Unknown future versions fall back rather than guessing at a shape.
  if (raw.v !== 1) return null;
  if (!Array.isArray(raw.choices)) return null;
  if (typeof raw.dismiss !== "string" || raw.dismiss === "") return null;

  const choices: DecisionChoice[] = [];
  for (const entry of raw.choices) {
    if (entry === null || typeof entry !== "object") return null;
    const { n, label, input } = entry as { n?: unknown; label?: unknown; input?: unknown };
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return null;
    if (typeof label !== "string" || label === "") return null;
    choices.push({ reply: String(n), label, needsInput: input === true });
  }
  if (choices.length === 0) return null;

  return { choices, dismiss: raw.dismiss };
}

/**
 * Finds the one decision prompt whose buttons should still be live.
 *
 * Only the newest message can be it. The bridge parks a decision waiting for
 * the *next* matching reply, so once anything else has been said the buttons
 * stop offering an answer: a reply to an already-answered decision is not
 * matched, it falls through as an ordinary message and starts an agent turn on
 * the body "1". Being conservative costs nothing, because the prose is still
 * there and typing still works.
 */
export function activeDecisionID(
  messages: readonly { id: string; kind?: string; turn_id?: string }[],
): string | null {
  const newest = messages[messages.length - 1];
  if (newest === undefined) return null;
  return isDecisionMessage(newest) ? newest.id : null;
}

/** Strips the machine block so the rendered body shows only the prose. */
export function stripDecisionBlock(body: string): string {
  return body.replace(FENCE, "").trimEnd();
}
