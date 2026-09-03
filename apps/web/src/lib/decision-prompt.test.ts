import assert from "node:assert/strict";
import test from "node:test";
import {
  isDecisionMessage,
  readDecisionPrompt,
  stripDecisionBlock,
} from "./chat/decision-prompt.ts";

// Mirrors what the Pi bridge's renderDecisionPrompt emits: prose first, then the
// fenced block naming the same choices as data.
function prompt(block: string): string {
  return [
    "**Approve the implementation plan**",
    "",
    "Review the implementation plan.",
    "",
    "1. Yes, continue",
    "2. No, stop",
    "3. Replan _(reply with your answer after the number)_",
    "",
    "_Reply with a number to answer. Reply `cancel` to leave it pending._",
    "",
    "```clickclack-decision",
    block,
    "```",
  ].join("\n");
}

const validBlock = JSON.stringify({
  v: 1,
  choices: [
    { n: 1, key: "continue", label: "Yes, continue", input: false },
    { n: 2, key: "stop", label: "No, stop", input: false },
    { n: 3, key: "replan", label: "Replan", input: true },
  ],
  dismiss: "cancel",
});

test("a decision prompt is recognized by kind and turn marker", () => {
  assert.equal(
    isDecisionMessage({ kind: "agent_commentary", turn_id: "decision:request-1:3" }),
    true,
  );
});

test("ordinary activity is not a decision prompt", () => {
  const cases = [
    { kind: "agent_commentary", turn_id: "turn_abc" },
    { kind: "agent_tool", turn_id: "decision:request-1:3" },
    { kind: "message", turn_id: "decision:request-1:3" },
    { kind: "agent_commentary" },
    {},
  ];
  for (const message of cases) {
    assert.equal(isDecisionMessage(message), false, JSON.stringify(message));
  }
});

test("the choices come out with the replies an operator would type", () => {
  assert.deepEqual(readDecisionPrompt(prompt(validBlock)), {
    choices: [
      { reply: "1", label: "Yes, continue", needsInput: false },
      { reply: "2", label: "No, stop", needsInput: false },
      { reply: "3", label: "Replan", needsInput: true },
    ],
    dismiss: "cancel",
  });
});

// The prose is always present and always answerable by typing, so anything this
// side does not recognize falls back to it rather than rendering half a control.
test("an unrecognized block falls back to the prose", () => {
  const cases: Record<string, string> = {
    "no block": "1. Yes, continue\n2. No, stop",
    "malformed json": prompt("{not json"),
    "future version": prompt(JSON.stringify({ v: 2, choices: [], dismiss: "cancel" })),
    "missing version": prompt(JSON.stringify({ choices: [], dismiss: "cancel" })),
    "no choices": prompt(JSON.stringify({ v: 1, choices: [], dismiss: "cancel" })),
    "choices not an array": prompt(JSON.stringify({ v: 1, choices: {}, dismiss: "cancel" })),
    "missing dismissal": prompt(JSON.stringify({ v: 1, choices: [{ n: 1, label: "Go" }] })),
    "empty dismissal": prompt(
      JSON.stringify({ v: 1, choices: [{ n: 1, label: "Go" }], dismiss: "" }),
    ),
    "unlabelled choice": prompt(JSON.stringify({ v: 1, choices: [{ n: 1 }], dismiss: "cancel" })),
    "unnumbered choice": prompt(
      JSON.stringify({ v: 1, choices: [{ label: "Go" }], dismiss: "cancel" }),
    ),
    "zero-numbered choice": prompt(
      JSON.stringify({ v: 1, choices: [{ n: 0, label: "Go" }], dismiss: "cancel" }),
    ),
  };
  for (const [name, body] of Object.entries(cases)) {
    assert.equal(readDecisionPrompt(body), null, name);
  }
});

test("an ordinary fenced code block is not read as a decision", () => {
  const body = ["Here is some json:", "", "```json", validBlock, "```"].join("\n");
  assert.equal(readDecisionPrompt(body), null);
});

test("the rendered body keeps the prose and drops the block", () => {
  const stripped = stripDecisionBlock(prompt(validBlock));
  assert.match(stripped, /1\. Yes, continue/u);
  assert.match(stripped, /Reply with a number to answer/u);
  assert.doesNotMatch(stripped, /clickclack-decision/u);
  assert.doesNotMatch(stripped, /"v":1/u);
});

test("a body with no block is left alone", () => {
  const body = "1. Yes, continue\n2. No, stop";
  assert.equal(stripDecisionBlock(body), body);
});
