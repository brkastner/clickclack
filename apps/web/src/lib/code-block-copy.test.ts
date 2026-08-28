import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const action = readFileSync(new URL("./actions/code-block-copy.ts", import.meta.url), "utf8");
const messageRow = readFileSync(
  new URL("../components/messages/MessageRow.svelte", import.meta.url),
  "utf8",
);
const messageStyles = readFileSync(new URL("../styles/messages.css", import.meta.url), "utf8");

test("enables per-block copy controls for human and agent messages", () => {
  const uses = [...messageRow.matchAll(/use:enhanceCodeBlockCopy=\{true\}/gu)];

  assert.equal(uses.length, 2, "ordinary and voice message markdown should both enable copying");
  assert.doesNotMatch(messageRow, /enhanceCodeBlockCopy=\{message\.author\?\.kind/u);
});

test("copies code content rather than the whole message or wrapper", () => {
  assert.match(action, /clipboard\.writeText\(state\.code\.textContent \?\? ""\)/u);
  assert.doesNotMatch(action, /clipboard\.writeText\(state\.wrapper\.textContent/u);
});

test("reveals the overlaid control on block hover and keyboard focus", () => {
  assert.match(messageStyles, /\.code-block:hover \.code-block-copy/u);
  assert.match(messageStyles, /\.code-block-copy:focus-visible/u);
  assert.match(
    messageStyles,
    /\.code-block-copy\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*15px;/u,
  );
});

test("keeps the control sticky while its tall code block remains visible", () => {
  assert.match(action, /controlTrack\.append\(button\);\s*wrapper\.append\(controlTrack, pre\);/u);
  const trackStyles = messageStyles.match(/\.code-block-copy-track\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
  assert.match(trackStyles, /position:\s*absolute/u);
  assert.match(trackStyles, /inset:\s*0 0 0 auto/u);
  assert.match(trackStyles, /width:\s*42px/u);
});

test("moves the post-preamble hover timestamp to the answer's top-right", () => {
  const timestampStyles =
    messageStyles.match(
      /\.message-group\.is-agent \.message-row\.after-preamble \.row-stamp\s*\{([\s\S]*?)\}/u,
    )?.[1] ?? "";
  assert.match(timestampStyles, /right:\s*0/u);
  assert.match(timestampStyles, /left:\s*auto/u);
});
