import assert from "node:assert/strict";
import test from "node:test";
import { defaultSections, parseSectionState, sectionStorageKey } from "./sidebar-sections.ts";

test("legacy section state preserves flags and defaults personas to expanded", () => {
  assert.deepEqual(parseSectionState('{"channels":false,"directMessages":true}'), {
    channels: false, directMessages: true, archived: true, personas: {},
  });
});

test("persona disclosure round trips by identity without losing top-level flags", () => {
  const state = { channels: false, directMessages: false, archived: false, personas: { kai: false, liz: true } };
  assert.deepEqual(parseSectionState(JSON.stringify(state)), state);
  assert.notEqual(sectionStorageKey("one"), sectionStorageKey("two"));
});

test("invalid storage falls back safely and invalid persona entries are ignored", () => {
  for (const raw of [null, "", "bad", "null", "[]", "{}", '{"channels":1}']) {
    assert.deepEqual(parseSectionState(raw), defaultSections());
  }
  assert.deepEqual(parseSectionState('{"channels":true,"directMessages":false,"personas":{"kai":false,"bad":"false"}}').personas, { kai: false });
  assert.deepEqual(parseSectionState('{"channels":true,"directMessages":true,"personas":[]}').personas, {});
  const first = defaultSections();
  first.personas.kai = false;
  assert.deepEqual(defaultSections().personas, {});
});
