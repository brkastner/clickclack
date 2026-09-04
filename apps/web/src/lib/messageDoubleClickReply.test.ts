import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canReplyOnMessageDoubleClick } from "./chat/messageDoubleClickReply.ts";
import type { Message } from "./types";

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    body: "hello",
    author_id: "other-user",
    created_at: "2026-09-04T00:00:00Z",
    ...overrides,
  } as Message;
}

test("double-click reply accepts only settled messages from another author", () => {
  assert.equal(canReplyOnMessageDoubleClick(message(), "current-user"), true);
  assert.equal(
    canReplyOnMessageDoubleClick(message({ author_id: "current-user" }), "current-user"),
    false,
  );
  assert.equal(canReplyOnMessageDoubleClick(message({ status: "pending" }), "current-user"), false);
  assert.equal(canReplyOnMessageDoubleClick(message({ status: "failed" }), "current-user"), false);
  assert.equal(
    canReplyOnMessageDoubleClick(message({ deleted_at: "2026-09-04T00:01:00Z" }), "current-user"),
    false,
  );
  assert.equal(canReplyOnMessageDoubleClick(message(), undefined), false);
});

test("double-click reply prefers the expanded author identity", () => {
  const expanded = message({
    author_id: "stale-author",
    author: { id: "current-user", display_name: "Kas" } as Message["author"],
  });
  assert.equal(canReplyOnMessageDoubleClick(expanded, "current-user"), false);
});

test("timeline and thread message surfaces wire double-click reply", () => {
  const messageRow = readFileSync(
    new URL("../components/messages/MessageRow.svelte", import.meta.url),
    "utf8",
  );
  const threadPanel = readFileSync(
    new URL("../components/thread/ThreadPanel.svelte", import.meta.url),
    "utf8",
  );
  assert.match(messageRow, /ondblclick=\{handleMessageDoubleClick\}/u);
  assert.match(messageRow, /target\?\.closest\(MESSAGE_DOUBLE_CLICK_INTERACTIVE_TARGETS\)/u);
  assert.match(threadPanel, /ondblclick=\{\(event\) => handleMessageDoubleClick\(event, root\)\}/u);
  assert.match(
    threadPanel,
    /ondblclick=\{\(event\) => handleMessageDoubleClick\(event, reply\)\}/u,
  );
});
