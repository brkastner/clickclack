import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const messageStyles = readFileSync(new URL("../styles/messages.css", import.meta.url), "utf8");
const messageRow = readFileSync(
  new URL("../components/messages/MessageRow.svelte", import.meta.url),
  "utf8",
);
const chatApp = readFileSync(new URL("../ChatApp.svelte", import.meta.url), "utf8");

test("keeps the unread overlay above elevated virtualized message rows", () => {
  const unreadBlock = messageStyles.match(/\.unread-bar\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
  const unreadZIndex = Number(unreadBlock.match(/z-index:\s*(\d+)/u)?.[1] ?? "0");
  const elevatedRowZIndex = Number(
    messageRow.match(/item\.style\.zIndex\s*=\s*"(\d+)"/u)?.[1] ?? "0",
  );

  assert.ok(
    unreadZIndex > elevatedRowZIndex,
    `unread overlay z-index ${unreadZIndex} must exceed elevated row z-index ${elevatedRowZIndex}`,
  );
});

test("marks channels and direct conversations read when they are opened", () => {
  const applyRoute = chatApp.match(/async function applyRoute[\s\S]*?\n  async function ensureResolvedRouteTargetLoaded/u)?.[0] ?? "";
  const selectChannel = chatApp.match(/async function selectChannel[\s\S]*?\n  async function loadChannelNotifPreference/u)?.[0] ?? "";
  const selectDirect = chatApp.match(/async function selectDirectConversation[\s\S]*?\n  async function startDirectWithUser/u)?.[0] ?? "";
  const markConversationReadOnOpen =
    chatApp.match(/function markConversationReadOnOpen[\s\S]*?\n  function markActiveViewRead/u)?.[0] ?? "";

  assert.equal(
    applyRoute.match(/markConversationReadOnOpen\(targetID\);/gu)?.length,
    2,
    "channel and direct route branches must both mark their target read",
  );
  assert.match(selectChannel, /markConversationReadOnOpen\(channelID\);/u);
  assert.match(selectDirect, /markConversationReadOnOpen\(conversationID\);/u);
  assert.match(markConversationReadOnOpen, /latestReadSeqForKey\(key\)/u);
  assert.match(markConversationReadOnOpen, /markDirectRead\(key, seq\)/u);
  assert.match(markConversationReadOnOpen, /markChannelRead\(key, seq\)/u);
  assert.match(markConversationReadOnOpen, /clearUnreadLocally\(key, seq\)/u);
});

test("marks the channel read after successfully navigating to a topic", () => {
  const setTopicFilter =
    chatApp.match(/async function setTopicFilter[\s\S]*?\n  function pageToWindow/u)?.[0] ?? "";
  const markActiveViewRead =
    chatApp.match(/function markActiveViewRead[\s\S]*?\n  function clearUnreadLocally/u)?.[0] ?? "";

  assert.match(
    setTopicFilter,
    /await loadLatestMessages\(\);[\s\S]*?markActiveViewRead\(\{ all: true, allowTopicFilter: true \}\);/u,
  );
  assert.match(
    markActiveViewRead,
    /if \(\s*!options\.allowTopicFilter\s*&&\s*activeTopicFilterID[\s\S]*?\) \{\s*return;\s*\}/u,
  );
});
