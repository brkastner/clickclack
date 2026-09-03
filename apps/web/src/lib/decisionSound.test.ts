import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultDecisionSound,
  isDecisionEvent,
  isDecisionSound,
  readDecisionSound,
  writeDecisionSound,
} from "./decisionSound.ts";

function withStorage(entries: Record<string, string> = {}): Record<string, string> {
  const store: Record<string, string> = { ...entries };
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    },
  };
  return store;
}

test("only known sounds are accepted", () => {
  for (const sound of ["chime", "knock", "bell", "off"]) {
    assert.equal(isDecisionSound(sound), true, sound);
  }
  for (const sound of ["", "airhorn", "OFF"]) {
    assert.equal(isDecisionSound(sound), false, sound);
  }
});

test("a user with no stored preference gets the default", () => {
  withStorage();
  assert.equal(readDecisionSound("usr_1"), defaultDecisionSound);
});

test("a stored preference round-trips", () => {
  withStorage();
  assert.equal(writeDecisionSound("usr_1", "bell"), true);
  assert.equal(readDecisionSound("usr_1"), "bell");
});

test("preferences do not leak between users", () => {
  withStorage();
  writeDecisionSound("usr_1", "knock");
  assert.equal(readDecisionSound("usr_2"), defaultDecisionSound);
});

test("off is a stored preference, not a missing one", () => {
  withStorage();
  writeDecisionSound("usr_1", "off");
  assert.equal(readDecisionSound("usr_1"), "off");
});

test("an unknown stored value falls back to the default", () => {
  withStorage({ "clickclack:decision-sound:v1:usr_1": "airhorn" });
  assert.equal(readDecisionSound("usr_1"), defaultDecisionSound);
});

test("an anonymous user never stores or reads a preference", () => {
  withStorage();
  assert.equal(writeDecisionSound("", "bell"), false);
  assert.equal(readDecisionSound(""), defaultDecisionSound);
});

test("only a decision-marked agent turn counts as a decision", () => {
  assert.equal(
    isDecisionEvent({
      type: "message.created",
      payload: { kind: "agent_commentary", turn_id: "decision:request-1:3" },
    }),
    true,
  );
});

test("ordinary agent activity in the same turn stays silent", () => {
  for (const payload of [
    { kind: "agent_commentary", turn_id: "turn_abc" },
    { kind: "agent_tool", turn_id: "decision:request-1:3" },
    { kind: "message", turn_id: "decision:request-1:3" },
    { kind: "agent_commentary" },
    { kind: "agent_commentary", turn_id: 7 },
  ]) {
    assert.equal(
      isDecisionEvent({ type: "message.created", payload }),
      false,
      JSON.stringify(payload),
    );
  }
});

test("a non-message event is never a decision", () => {
  assert.equal(
    isDecisionEvent({
      type: "thread.reply_created",
      payload: { kind: "agent_commentary", turn_id: "decision:request-1:3" },
    }),
    false,
  );
  assert.equal(isDecisionEvent({ type: "message.created" }), false);
  assert.equal(isDecisionEvent({}), false);
});
