// Render-time presentation of durable agent activity rows.
//
// Commentary is narration, so it renders as ordinary message text. Consecutive
// tool rows collapse into one preamble block. A commentary row closes the
// current tool block; later tools start a new block. This repeats for the full
// turn: commentary, tools, commentary, tools, final answer.
//
// Activity stays in the supplied conversation order, including late activity.
// Only contiguous tools with the same conversation/author/turn key coalesce;
// ordinary messages and other turns separate blocks without relocating rows.
//
// A tool block is final (collapsed) when another commentary/tool segment follows
// it, when the turn's ordinary final answer exists, or when the turn is stale.
// Only the trailing tool block of a live turn remains expanded.
//
// Two independent operator flags control visibility:
//   hideCommentary  - drop narration rows
//   hideToolCalls   - drop collapsible tool blocks
// Commentary still splits tool groups when hidden, preserving chronology.

import type { Message, PreambleBlock, PreambleItem } from "../types";

export type {
  PreambleBlock,
  PreambleCommentaryItem,
  PreambleItem,
  PreambleToolItem,
} from "../types";

export type AgentActivityFlags = {
  hideCommentary: boolean;
  hideToolCalls: boolean;
};

const ACTIVITY_KINDS = new Set(["agent_commentary", "agent_tool"]);

// A turn with no new activity rows for this long is treated as finished even
// when no later message proves it. Generous: real turns emit frames at least
// every debounce interval (~seconds) while running.
const TURN_STALE_MS = 3 * 60 * 1000;

export function isAgentActivity(message: Message): boolean {
  return message.kind !== undefined && ACTIVITY_KINDS.has(message.kind);
}

function isOrdinaryMessage(message: Message): boolean {
  return message.kind === undefined || message.kind === "message";
}

function authorKey(message: Message): string {
  return message.author?.id || message.author_id || "";
}

function turnKey(message: Message): string {
  const scope = message.channel_id
    ? `channel:${message.channel_id}`
    : `direct:${message.direct_conversation_id || ""}`;
  return `${scope}\u0000${authorKey(message)}\u0000${message.turn_id || message.id}`;
}

// Parse a stored activity body into a tool name + optional detail. The bridge
// writes tool rows as "**head**\n\ndetail", "**head**", or a bare string. The
// head is often a coalesced step chain ("command print text -> run ps -> ...");
// to avoid surfacing the full chain (which reads as noise), we take the first
// token of the head as the tool name and fold the remainder into the detail,
// which renders as a single ellipsis-truncated line.
type ParsedToolBody = {
  name: string;
  detail?: string;
  expandable: boolean;
};

const TOOL_RECEIPT_PREFIXES: Array<{
  prefix: string;
  name: string;
  label: RegExp;
}> = [
  { prefix: "🛠️", name: "exec", label: /^(?:exec|bash|shell|command)\b\s*:?\s*/i },
  { prefix: "🛠", name: "exec", label: /^(?:exec|bash|shell|command)\b\s*:?\s*/i },
  { prefix: "🩹", name: "apply_patch", label: /^apply\s+patch\b\s*:?\s*/i },
  { prefix: "📖", name: "read", label: /^read\b\s*:?\s*/i },
  { prefix: "🧰", name: "process", label: /^process\b\s*:?\s*/i },
];

function parseToolBody(body: string): ParsedToolBody {
  const trimmed = body.trim();
  let head = "";
  let text = "";
  let expandable = false;
  const withText = trimmed.match(/^\*\*([^*]+)\*\*\s*\n+([\s\S]+)$/);
  const headOnly = trimmed.match(/^\*\*([^*]+)\*\*$/);
  if (withText) {
    head = withText[1].trim();
    text = collapseWhitespace(withText[2]);
    expandable = true;
  } else if (headOnly) {
    head = headOnly[1].trim();
  } else {
    const [firstLine = "", ...bodyLines] = trimmed.replace(/\*\*/g, "").split("\n");
    head = firstLine.trim();
    text = collapseWhitespace(bodyLines.join("\n"));
    expandable = text.length > 0;
  }
  const receipt = TOOL_RECEIPT_PREFIXES.find(({ prefix }) => head.startsWith(prefix));
  if (receipt) {
    const label = head.slice(receipt.prefix.length).trim();
    const headDetail = label.replace(receipt.label, "").trim();
    return joinToolDetail(receipt.name, headDetail, text, expandable);
  }
  return splitHead(head, text, expandable);
}

// Split a head into a leading tool-name token and a folded detail. The first
// whitespace-delimited word is treated as the tool verb (command, exec, read,
// message); the rest of the head, plus any body text, becomes the detail.
function splitHead(head: string, text: string, expandable: boolean): ParsedToolBody {
  const collapsedHead = collapseWhitespace(head);
  const spaceIdx = collapsedHead.indexOf(" ");
  if (spaceIdx === -1) return joinToolDetail(collapsedHead, "", text, expandable);
  return joinToolDetail(
    collapsedHead.slice(0, spaceIdx),
    collapsedHead.slice(spaceIdx + 1).trim(),
    text,
    expandable,
  );
}

function joinToolDetail(
  name: string,
  headDetail: string,
  text: string,
  expandable: boolean,
): ParsedToolBody {
  const detail = [headDetail, text].filter((part) => part.length > 0).join(" · ");
  return { name, detail: detail || undefined, expandable };
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildToolBlock(turnId: string, rows: Message[], final: boolean): PreambleBlock {
  const items: PreambleItem[] = [];
  for (const row of rows) {
    const parsed = parseToolBody(row.body);
    const prior = items.at(-1);
    if (
      prior?.type === "tool" &&
      !prior.detail &&
      !parsed.detail &&
      prior.name === parsed.name &&
      !prior.expandable &&
      !parsed.expandable
    ) {
      prior.count += 1;
      continue;
    }
    items.push({
      type: "tool",
      id: row.id,
      name: parsed.name,
      ...(parsed.detail ? { detail: parsed.detail } : {}),
      full: row.body.trim(),
      count: 1,
      expandable: parsed.expandable,
    });
  }
  return { turnId, items, final };
}

type TurnAccumulator = {
  rows: Message[];
  firstIndex: number;
  lastIndex: number;
  author: string;
};

// Track turn finality independently, then replace contiguous tool runs in place.
// Ordinary messages pass through untouched; visibility never erases a boundary.
export function coalesceAgentActivity(
  messages: Message[],
  flags: AgentActivityFlags,
  now = Date.now(),
): Message[] {
  const turns = new Map<string, TurnAccumulator>();
  const lastOrdinaryIndexByAuthor = new Map<string, number>();
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!isAgentActivity(message)) {
      if (isOrdinaryMessage(message)) lastOrdinaryIndexByAuthor.set(authorKey(message), i);
      continue;
    }
    const key = turnKey(message);
    const turn = turns.get(key);
    if (turn) {
      turn.rows.push(message);
      turn.lastIndex = i;
    } else {
      turns.set(key, {
        rows: [message],
        firstIndex: i,
        lastIndex: i,
        author: authorKey(message),
      });
    }
  }
  if (turns.size === 0) return messages;

  // Decide turn finality: a same-author ordinary message (the final answer)
  // after the turn opened, anything after the turn's last activity row, or
  // staleness (no new frames for TURN_STALE_MS).
  const finals = new Map<string, boolean>();
  for (const [key, turn] of turns) {
    let final =
      turn.lastIndex < messages.length - 1 ||
      (lastOrdinaryIndexByAuthor.get(turn.author) ?? -1) > turn.firstIndex;
    if (!final) {
      const newest = Date.parse(turn.rows[turn.rows.length - 1].created_at);
      if (Number.isFinite(newest) && now - newest > TURN_STALE_MS) final = true;
    }
    finals.set(key, final);
  }

  const out: Message[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!isAgentActivity(message)) {
      out.push(message);
      continue;
    }
    if (message.kind === "agent_commentary") {
      if (!flags.hideCommentary && message.body.trim()) {
        out.push({ ...message, body: message.body.trim() });
      }
      continue;
    }
    const key = turnKey(message);
    const start = i;
    while (
      i + 1 < messages.length &&
      messages[i + 1].kind === "agent_tool" &&
      turnKey(messages[i + 1]) === key
    ) {
      i += 1;
    }
    if (flags.hideToolCalls) continue;
    out.push({
      ...message,
      body: "",
      attachments: undefined,
      quoted_message_id: undefined,
      preamble_block: buildToolBlock(
        message.turn_id || message.id,
        messages.slice(start, i + 1),
        finals.get(key) === true || i < messages.length - 1,
      ),
    });
  }
  return out;
}
