import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const action = readFileSync(new URL("./actions/code-block-copy.ts", import.meta.url), "utf8");
const messageRow = readFileSync(
  new URL("../components/messages/MessageRow.svelte", import.meta.url),
  "utf8",
);
const messageStyles = readFileSync(new URL("../styles/messages.css", import.meta.url), "utf8");

test("enables per-block copy controls only for human messages", () => {
  const uses = [
    ...messageRow.matchAll(/use:enhanceCodeBlockCopy=\{message\.author\?\.kind === "human"\}/gu),
  ];

  assert.equal(uses.length, 2, "ordinary and voice message markdown should share the guard");
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
