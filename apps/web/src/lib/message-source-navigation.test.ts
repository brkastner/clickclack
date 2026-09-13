import assert from "node:assert/strict";
import test from "node:test";
import {
  revealMessageSource,
  sourceConversationID,
  type SourceRevealPorts,
} from "./chat/message-source-navigation.ts";
import type { Message } from "./types.ts";
function fixture(reply = false, direct = false) {
  const message = {
    id: "output",
    workspace_id: "workspace",
    channel_id: direct ? undefined : "channel",
    direct_conversation_id: direct ? "dm" : undefined,
    parent_message_id: reply ? "root" : undefined,
    thread_root_id: "root",
    channel_seq: 5,
    thread_seq: 120,
  } as Message;
  const calls: string[] = [];
  const ports: SourceRevealPorts = {
    workspaceID: "workspace",
    conversationID: direct ? "dm" : "channel",
    isCurrent: () => true,
    fetchMessage: async () => message,
    revealTimeline: async (value) => {
      calls.push(`timeline:${value.id}:${value.channel_seq}`);
    },
    revealThread: async (value) => {
      calls.push(`thread:${value.thread_root_id}:${value.id}:${value.thread_seq}`);
      return true;
    },
  };
  return { message, ports, calls };
}
test("exact off-window channel and DM messages use the authoritative message sequence", async () => {
  for (const direct of [false, true]) {
    const { ports, calls } = fixture(false, direct);
    assert.equal(await revealMessageSource("output", ports), true);
    assert.deepEqual(calls, ["timeline:output:5"]);
  }
});
test("thread replies reveal the exact reply in its root", async () => {
  const { ports, calls } = fixture(true);
  await revealMessageSource("output", ports);
  assert.deepEqual(calls, ["thread:root:output:120"]);
});
test("superseded navigation never reveals the old target", async () => {
  const { ports, calls } = fixture();
  ports.isCurrent = () => false;
  assert.equal(await revealMessageSource("output", ports), false);
  assert.deepEqual(calls, []);
});
test("deleted, inaccessible and cross-workspace sources fail without revealing content", async () => {
  for (const field of ["deleted_at", "workspace_id", "channel_id"] as const) {
    const { ports, message, calls } = fixture();
    message[field] = "unavailable";
    await assert.rejects(revealMessageSource("output", ports), /Source unavailable/);
    assert.deepEqual(calls, []);
  }
  const { ports } = fixture();
  ports.fetchMessage = async () => {
    throw new Error("forbidden");
  };
  await assert.rejects(revealMessageSource("output", ports), /forbidden/);
});
test("failed reply hydration reports inaccessible source", async () => {
  const { ports } = fixture(true);
  ports.revealThread = async () => false;
  await assert.rejects(revealMessageSource("output", ports), /Thread source unavailable/);
  assert.equal(sourceConversationID({ direct_conversation_id: "dm" }), "dm");
});
