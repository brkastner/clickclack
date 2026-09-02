import assert from "node:assert/strict";
import test from "node:test";
import {
  directConversationIDForRecencyEvent,
  promoteDirectConversation,
} from "./directConversationRecency.ts";
import type { DirectConversation, RealtimeEvent } from "./types";

function conversation(id: string): DirectConversation {
  return {
    id,
    route_id: `route-${id}`,
    workspace_id: "workspace",
    created_at: "2026-01-01T00:00:00Z",
    members: [],
    can_send: true,
  };
}

function event(type: string, directConversationID?: string): RealtimeEvent {
  return {
    id: "event",
    cursor: "cursor",
    type,
    workspace_id: "workspace",
    created_at: "2026-01-01T00:00:00Z",
    payload: directConversationID ? { direct_conversation_id: directConversationID } : {},
  };
}

test("selects direct message and thread activity for recency updates", () => {
  assert.equal(
    directConversationIDForRecencyEvent(event("message.created", "dm-message")),
    "dm-message",
  );
  assert.equal(
    directConversationIDForRecencyEvent(event("thread.reply_created", "dm-thread")),
    "dm-thread",
  );
  assert.equal(directConversationIDForRecencyEvent(event("message.updated", "dm-update")), "");
  assert.equal(directConversationIDForRecencyEvent(event("message.created")), "");
});

test("promotes an active direct conversation to the front", () => {
  const conversations = [conversation("first"), conversation("second"), conversation("third")];

  const promoted = promoteDirectConversation(conversations, "third");

  assert.deepEqual(
    promoted.map((item) => item.id),
    ["third", "first", "second"],
  );
  assert.deepEqual(
    conversations.map((item) => item.id),
    ["first", "second", "third"],
  );
});

test("preserves the array when the conversation is already first or unknown", () => {
  const conversations = [conversation("first"), conversation("second")];

  assert.equal(promoteDirectConversation(conversations, "first"), conversations);
  assert.equal(promoteDirectConversation(conversations, "missing"), conversations);
});
