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
  assert.match(messageStyles, /position:\s*absolute;[\s\S]*?top:\s*7px;[\s\S]*?right:\s*7px;/u);
});
