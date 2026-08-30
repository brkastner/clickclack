import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const channelList = readFileSync(
  new URL("../components/navigation/ChannelList.svelte", import.meta.url),
  "utf8",
);
const sidebarStyles = readFileSync(new URL("../styles/sidebar.css", import.meta.url), "utf8");

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return sidebarStyles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "u"))?.[1] ?? "";
}

test("shows a profile disclosure caret only when it has nested channels", () => {
  assert.match(channelList, /\{@const hasNestedChannels = group\.channels\.length > 0\}/u);
  assert.match(
    channelList,
    /\{#if group\.sourceChannel && hasNestedChannels\}[\s\S]*?class="channel-subgroup-caret"/u,
  );
  assert.match(
    channelList,
    /\{#if !group\.sourceChannel && hasNestedChannels\}\s*<span class="caret"/u,
  );
});

test("aligns nested channel hashtags with profile avatars", () => {
  const profileHeader = cssRule(".profile-channel-group .channel-subgroup-toggle");
  const nestedChannel = cssRule(".profile-channel-group .channel-row.reorderable .nav-item");
  const profileCaret = cssRule(".profile-subgroup-header .channel-subgroup-caret");
  const nestedDragHandle = cssRule(
    ".profile-channel-group .channel-row.reorderable .channel-drag-handle",
  );

  assert.match(profileHeader, /padding-left:\s*4px/u);
  assert.match(nestedChannel, /padding-left:\s*4px/u);
  assert.match(profileCaret, /position:\s*absolute/u);
  assert.match(profileCaret, /left:\s*-10px/u);
  assert.match(nestedDragHandle, /position:\s*absolute/u);
  assert.match(nestedDragHandle, /left:\s*-10px/u);
});
