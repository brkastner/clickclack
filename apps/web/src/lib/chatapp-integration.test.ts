import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "svelte/compiler";

const chat = readFileSync(new URL("../ChatApp.svelte", import.meta.url), "utf8");

test("ChatApp compiles the actual legacy application and thread owner bridge", () => {
  const { warnings } = compile(chat, { filename: "ChatApp.svelte", generate: false });
  assert.deepEqual(warnings, []);
  assert.match(chat, /history=\{thread\}/);
  assert.match(chat, /const threadView = toStore/);
  assert.doesNotMatch(chat, /<GuildRail|recoverableDraftMessages|pendingDrafts/);
});

test("ChatApp retires each attachment upload on removal and workspace change", () => {
  const upload = chat.slice(
    chat.indexOf("async function uploadPendingAttachment"),
    chat.indexOf("async function enqueueFiles"),
  );
  assert.match(upload, /uploadControllers\.get\(key\)\?\.abort\(\)/);
  assert.match(upload, /uploadWorkspaceFile\([\s\S]*?controller\.signal/);
  assert.match(upload, /if \(!isCurrent\(\)\) return/);
  const remove = chat.slice(
    chat.indexOf("function removePendingAttachment"),
    chat.indexOf("async function selectDirectConversation"),
  );
  assert.match(remove, /uploadControllers\.get\(key\)\?\.abort\(\)/);
  assert.match(chat, /clearPendingUpload\(\);\s*selectedWorkspaceID = workspace\.id/);
});

test("ChatApp retains multi-upload receipts and failed-link metadata", () => {
  const dispatch = chat.slice(
    chat.indexOf("async function dispatchDraft"),
    chat.indexOf("function retryFailedMessage"),
  );
  assert.match(dispatch, /outgoing\.receipt \|\|/);
  assert.match(dispatch, /uploadsMissingAttachments\(draft\.uploads, attachedUploadIDs\)/);
  assert.match(dispatch, /delivery_failure: "attachments"/);
  assert.match(dispatch, /draft\.attachedUploadIDs = \[\.\.\.attachedUploadIDs\]/);
  assert.match(dispatch, /if \(isCurrent\(\) && shouldRevealSentMessage\)/);
});
