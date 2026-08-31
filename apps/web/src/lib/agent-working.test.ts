import test from "node:test";
import assert from "node:assert/strict";
import {
  agentProgressWorkingSignal,
  isFinalAgentMessageEvent,
  realtimeConversationID,
  reduceConversationAgentWork,
  type AgentWorkingTurn,
  type ConversationAgentWork,
} from "./agent-working.ts";
import type { RealtimeEvent, User } from "./types";

function event(
  type: string,
  payload: Record<string, unknown> = {},
  channelID?: string,
): RealtimeEvent {
  return {
    id: "evt_1",
    cursor: "cur_1",
    type,
    workspace_id: "wsp_1",
    channel_id: channelID,
    created_at: "2026-01-01T00:00:00Z",
    payload,
  };
}

const bot = { id: "bot_1", kind: "bot" } as User;
const human = { id: "usr_1", kind: "human" } as User;
const turn = (userID: string, turnID: string): AgentWorkingTurn => ({
  key: `${userID}\u0000${turnID}`,
  turnID,
  userID,
});

test("resolves channel and direct-message working targets", () => {
  assert.equal(realtimeConversationID(event("agent.progress", {}, "chn_1")), "chn_1");
  assert.equal(
    realtimeConversationID(event("agent.progress", { direct_conversation_id: "dm_1" })),
    "dm_1",
  );
});

test("keeps working through progress-line finalization", () => {
  assert.equal(agentProgressWorkingSignal(event("agent.progress", { op: "append" })), "start");
  assert.equal(agentProgressWorkingSignal(event("agent.progress", { op: "update" })), "start");
  assert.equal(agentProgressWorkingSignal(event("agent.progress", { op: "finalize" })), "start");
  assert.equal(agentProgressWorkingSignal(event("agent.progress", { op: "clear" })), "stop");
});

test("only treats an ordinary bot message or thread reply as the final response", () => {
  assert.equal(isFinalAgentMessageEvent(event("message.created"), bot), true);
  assert.equal(isFinalAgentMessageEvent(event("thread.reply_created"), bot), true);
  assert.equal(
    isFinalAgentMessageEvent(event("message.created", { kind: "agent_commentary" }), bot),
    false,
  );
  assert.equal(
    isFinalAgentMessageEvent(event("message.created", { kind: "agent_tool" }), bot),
    false,
  );
  assert.equal(isFinalAgentMessageEvent(event("message.created"), human), false);
  assert.equal(
    isFinalAgentMessageEvent(
      event("thread.reply_created", { turn_id: "source-message" }),
      undefined,
    ),
    true,
  );
  assert.equal(isFinalAgentMessageEvent(event("thread.reply_created"), undefined), false);
  assert.equal(isFinalAgentMessageEvent(event("message.updated"), bot), false);
});

test("keeps concurrent pending sends and agent turns independent", () => {
  let work: ConversationAgentWork | undefined;
  work = reduceConversationAgentWork(work, {
    type: "pending.start",
    sendID: "send-a",
    agentIDs: ["bot-a"],
  });
  work = reduceConversationAgentWork(work, {
    type: "pending.start",
    sendID: "send-b",
    agentIDs: ["bot-b"],
  });
  work = reduceConversationAgentWork(work, {
    type: "progress.start",
    turn: turn("bot-a", "send-a"),
  });
  work = reduceConversationAgentWork(work, {
    type: "progress.start",
    turn: turn("bot-b", "send-b"),
  });

  work = reduceConversationAgentWork(work, {
    type: "response.final",
    turnID: "send-a",
    userID: "bot-a",
  });
  assert.deepEqual(work, {
    pendingSends: [{ id: "send-b", agentIDs: ["bot-b"], correlated: true }],
    turns: [turn("bot-b", "send-b")],
    completedTurns: [{ turnID: "send-a", userID: "bot-a" }],
  });

  work = reduceConversationAgentWork(work, {
    type: "progress.stop",
    turn: turn("bot-b", "send-b"),
  });
  assert.deepEqual(work, {
    pendingSends: [],
    turns: [],
    completedTurns: [
      { turnID: "send-a", userID: "bot-a" },
      { turnID: "send-b", userID: "bot-b" },
    ],
  });
});

test("unrelated progress and bot responses do not consume a correlated pending send", () => {
  let work = reduceConversationAgentWork(undefined, {
    type: "pending.start",
    sendID: "send-b",
    agentIDs: ["bot-b"],
  });
  work = reduceConversationAgentWork(work, {
    type: "progress.start",
    turn: turn("bot-b", "send-b"),
  });
  work = reduceConversationAgentWork(work, {
    type: "progress.stop",
    turn: turn("bot-a", "send-a"),
  });
  work = reduceConversationAgentWork(work, {
    type: "response.final",
    turnID: "send-b",
    userID: "bot-a",
  });
  work = reduceConversationAgentWork(work, {
    type: "response.final",
    userID: "bot-b",
  });
  work = reduceConversationAgentWork(work, {
    type: "response.final",
    turnID: "scheduled-message",
    userID: "bot-b",
  });
  assert.deepEqual(work, {
    pendingSends: [{ id: "send-b", agentIDs: ["bot-b"], correlated: true }],
    turns: [turn("bot-b", "send-b")],
    completedTurns: [{ turnID: "scheduled-message", userID: "bot-b" }],
  });
});

test("completion tombstones preserve expected-agent identity across send-response races", () => {
  let work = reduceConversationAgentWork(undefined, {
    type: "pending.start",
    sendID: "nonce-a",
    agentIDs: ["bot-a"],
  });
  work = reduceConversationAgentWork(work, {
    type: "pending.start",
    sendID: "nonce-b",
    agentIDs: ["bot-b"],
  });
  work = reduceConversationAgentWork(work, {
    type: "response.final",
    turnID: "message-b",
    userID: "bot-a",
  });
  work = reduceConversationAgentWork(work, {
    type: "pending.replace",
    sendID: "nonce-b",
    replacementID: "message-b",
  });
  assert.deepEqual(work, {
    pendingSends: [
      { id: "nonce-a", agentIDs: ["bot-a"], correlated: false },
      { id: "message-b", agentIDs: ["bot-b"], correlated: false },
    ],
    turns: [],
    completedTurns: [{ turnID: "message-b", userID: "bot-a" }],
  });
});

test("a failed request removes only its pending send and preserves accepted progress", () => {
  let work = reduceConversationAgentWork(undefined, {
    type: "pending.start",
    sendID: "nonce-a",
    agentIDs: ["bot-a"],
  });
  work = reduceConversationAgentWork(work, {
    type: "progress.start",
    turn: turn("bot-a", "message-a"),
  });
  work = reduceConversationAgentWork(work, { type: "pending.fail", sendID: "nonce-a" });
  assert.deepEqual(work, {
    pendingSends: [],
    turns: [turn("bot-a", "message-a")],
    completedTurns: [],
  });
});

test("an unambiguous legacy bot final clears an uncorrelated pending send", () => {
  let work = reduceConversationAgentWork(undefined, {
    type: "pending.start",
    sendID: "legacy-send",
    agentIDs: ["bot-a"],
  });
  work = reduceConversationAgentWork(work, {
    type: "response.final",
    userID: "bot-a",
  });
  assert.equal(work, undefined);
});

test("pre-response progress from an unexpected bot does not disable legacy fallback", () => {
  let work = reduceConversationAgentWork(undefined, {
    type: "pending.start",
    sendID: "nonce-a",
    agentIDs: ["bot-a"],
  });
  work = reduceConversationAgentWork(work, {
    type: "progress.start",
    turn: turn("bot-b", "message-a"),
  });
  work = reduceConversationAgentWork(work, {
    type: "pending.replace",
    sendID: "nonce-a",
    replacementID: "message-a",
  });
  work = reduceConversationAgentWork(work, {
    type: "progress.stop",
    turn: turn("bot-b", "message-a"),
  });
  work = reduceConversationAgentWork(work, {
    type: "response.final",
    userID: "bot-a",
  });
  assert.deepEqual(work, {
    pendingSends: [],
    turns: [],
    completedTurns: [{ turnID: "message-a", userID: "bot-b" }],
  });
});

test("replacing a pending nonce never resurrects an already-finished send", () => {
  let work = reduceConversationAgentWork(undefined, {
    type: "pending.start",
    sendID: "nonce-a",
    agentIDs: ["bot-a"],
  });
  work = reduceConversationAgentWork(work, {
    type: "response.final",
    turnID: "message-a",
    userID: "bot-a",
  });
  work = reduceConversationAgentWork(work, {
    type: "pending.replace",
    sendID: "nonce-a",
    replacementID: "message-a",
  });
  work = reduceConversationAgentWork(work, {
    type: "progress.start",
    turn: turn("bot-a", "message-a"),
  });
  assert.deepEqual(work, {
    pendingSends: [],
    turns: [],
    completedTurns: [{ turnID: "message-a", userID: "bot-a" }],
  });
});
