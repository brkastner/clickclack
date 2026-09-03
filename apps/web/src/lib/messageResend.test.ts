import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { messageContentForResend } from "./messageResend.ts";
import type { Message, Upload } from "./types";

const upload: Upload = {
  id: "upl_1",
  workspace_id: "wrk_1",
  owner_id: "usr_1",
  filename: "clip.mp3",
  content_type: "audio/mpeg",
  byte_size: 42,
  created_at: "2026-09-02T00:00:00Z",
};

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_1",
    workspace_id: "wrk_1",
    channel_id: "chn_1",
    author_id: "usr_1",
    thread_root_id: "msg_1",
    body: "  send this again  ",
    body_format: "markdown",
    created_at: "2026-09-02T00:00:00Z",
    attachments: [upload],
    quoted_message_id: "msg_quoted",
    topic_id: "topic_1",
    ...overrides,
  };
}

test("copies message content and attachments into a fresh resend payload", () => {
  const source = message();
  const result = messageContentForResend(source);

  assert.deepEqual(result, {
    body: "send this again",
    quotedMessageID: "msg_quoted",
    uploads: [upload],
    workspaceID: "wrk_1",
    channelID: "chn_1",
    directConversationID: undefined,
    topicID: "topic_1",
  });
  assert.notEqual(result?.uploads, source.attachments);
});

test("does not resend pending, failed, deleted, or empty messages", () => {
  assert.equal(messageContentForResend(message({ status: "pending" })), null);
  assert.equal(messageContentForResend(message({ status: "failed" })), null);
  assert.equal(messageContentForResend(message({ deleted_at: "2026-09-02T00:01:00Z" })), null);
  assert.equal(messageContentForResend(message({ body: "   " })), null);
});

test("shows the resend shortcut only for the current user's sent messages", () => {
  const row = readFileSync(
    new URL("../components/messages/MessageRow.svelte", import.meta.url),
    "utf8",
  );

  assert.match(
    row,
    /canResendMessage = \$derived\([\s\S]*?isOwnMessage[\s\S]*?!isPending[\s\S]*?!isFailed/u,
  );
  assert.match(row, /aria-label="Resend message"/u);
  assert.match(row, /onclick=\{\(\) => onResend\?\.\(message\)\}/u);
});

test("resend fills the composer without dispatching the message", () => {
  const app = readFileSync(new URL("../ChatApp.svelte", import.meta.url), "utf8");
  const handler = app.match(
    /function resendMessage\(message: Message\) \{[\s\S]*?\n  \}\n\n  async function dispatchRegisteredCommand/u,
  )?.[0];

  assert.ok(handler, "resendMessage handler should exist");
  assert.match(handler, /messageBody = content\.body/u);
  assert.match(handler, /pendingAttachments =/u);
  assert.match(handler, /messageInput\?\.focus\(\)/u);
  assert.doesNotMatch(handler, /dispatchDraft/u);
});
