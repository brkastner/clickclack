import test from "node:test";
import assert from "node:assert/strict";
import { findMentionRanges } from "./actions/mention-highlight.ts";

const handles = new Set(["alice", "openclaw-bot", "ботик"]);

test("finds known handles at token boundaries", () => {
  assert.deepEqual(findMentionRanges("@alice please ask @openclaw-bot", handles), [
    { start: 0, end: 6, handle: "alice" },
    { start: 18, end: 31, handle: "openclaw-bot" },
  ]);
});

test("does not highlight unknown handles, emails, or URL paths", () => {
  assert.deepEqual(
    findMentionRanges(
      "email a@alice.test, see https://example.com/@alice, /users/@alice, docs/path/@alice?tab=1, then @unknown",
      handles,
    ),
    [],
  );
});

test("matches handles case-insensitively", () => {
  assert.deepEqual(findMentionRanges("Please ask @ALICE", handles), [
    { start: 11, end: 17, handle: "alice" },
  ]);
});

test("matches unicode handles", () => {
  assert.deepEqual(findMentionRanges("привет @ботик", handles), [
    { start: 7, end: 13, handle: "ботик" },
  ]);
});
