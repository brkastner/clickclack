import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { middleAutoscrollVelocity, pageScrollDelta } from "./chat/scrolling.ts";

const messageList = readFileSync(
  new URL("../components/messages/MessageList.svelte", import.meta.url),
  "utf8",
);

test("page scrolling advances most of a viewport with a usable minimum", () => {
  assert.equal(pageScrollDelta(1_000, 1), 850);
  assert.equal(pageScrollDelta(100, -1), -120);
});

test("middle autoscroll has a dead zone and follows vertical direction", () => {
  assert.equal(middleAutoscrollVelocity(18), 0);
  assert.equal(middleAutoscrollVelocity(-10), 0);
  assert.ok(middleAutoscrollVelocity(80) > 0);
  assert.ok(middleAutoscrollVelocity(-80) < 0);
});

test("middle autoscroll accelerates with distance and caps its speed", () => {
  assert.ok(middleAutoscrollVelocity(160) > middleAutoscrollVelocity(40));
  assert.equal(middleAutoscrollVelocity(220), 9_600);
  assert.equal(middleAutoscrollVelocity(1_000), 9_600);
});

test("message history handles page keys without stealing modal or editor navigation", () => {
  assert.match(messageList, /event\.key !== "PageUp" && event\.key !== "PageDown"/u);
  assert.match(messageList, /target\?\.closest\('\[role="dialog"\]'/u);
  assert.match(messageList, /\.composer-editor__content/u);
  assert.match(messageList, /virtualizer\.scrollBy\(pageScrollDelta/u);
});

test("middle-button scrolling captures the pointer and cleans up on release", () => {
  assert.match(messageList, /event\.button !== MIDDLE_MOUSE_BUTTON/u);
  assert.match(messageList, /scrollEl\.setPointerCapture\(event\.pointerId\)/u);
  assert.match(messageList, /scrollEl\.releasePointerCapture\(pointerID\)/u);
  assert.match(messageList, /lostpointercapture/u);
});
