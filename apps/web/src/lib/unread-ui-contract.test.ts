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

test("marks channels and direct conversations read after navigating into them", () => {
  const applyRoute =
    chatApp.match(
      /async function applyRoute[\s\S]*?\n  async function ensureResolvedRouteTargetLoaded/u,
    )?.[0] ?? "";
  const handleHistorySettled =
    chatApp.match(
      /function handleHistorySettled[\s\S]*?\n  function currentConversationKey/u,
    )?.[0] ?? "";
  const markConversationReadOnOpen =
    chatApp.match(
      /function markConversationReadOnOpen[\s\S]*?\n  function markActiveViewRead/u,
    )?.[0] ?? "";

  // Navigation arms the receipt; the settled history fires it, so the unread
  // divider still places the scroll position before the badge clears.
  const armed = applyRoute.match(/pendingOpenReadKey = navigated \? targetID : "";/gu) ?? [];
  assert.equal(armed.length, 2);
  assert.match(
    handleHistorySettled,
    /if \(openedKey === currentConversationKey\(\) && openedKey === viewKey\) \{\s*pendingOpenReadKey = "";\s*markConversationReadOnOpen\(openedKey\);/u,
  );
  assert.match(markConversationReadOnOpen, /latestReadSeqForKey\(key\)/u);
  assert.match(markConversationReadOnOpen, /markDirectRead\(key, seq\)/u);
  assert.match(markConversationReadOnOpen, /markChannelRead\(key, seq\)/u);
  assert.match(markConversationReadOnOpen, /clearUnreadLocally\(key, seq\)/u);
});

test("keeps unread state on a cold load so a refresh never burns it", () => {
  const applyRoute =
    chatApp.match(
      /async function applyRoute[\s\S]*?\n  async function ensureResolvedRouteTargetLoaded/u,
    )?.[0] ?? "";

  assert.match(applyRoute, /const navigated = routeEverApplied;/u);
  // A cold boot at /app resolves its fallback target through a second pass, so
  // the flag only flips once a conversation route has resolved.
  const flips = applyRoute.match(/routeEverApplied = true;/gu) ?? [];
  assert.equal(flips.length, 3);
});

test("marks the channel read after successfully navigating to a topic", () => {
  const setTopicFilter =
    chatApp.match(/async function setTopicFilter[\s\S]*?\n  function commitMessageWindow/u)?.[0] ??
    "";
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
