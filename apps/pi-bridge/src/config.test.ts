import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, loadConfig } from "./config.js";

const validEnv = {
  CLICKCLACK_URL: "https://clickclack.test",
  CLICKCLACK_BOT_TOKEN: "secret",
  CLICKCLACK_WORKSPACE_ID: "wrk_test",
  CLICKCLACK_OWNER_IDS: "usr_one, usr_two",
  CLICKCLACK_PROJECTS: JSON.stringify({ clickclack: "/srv/clickclack" }),
  PI_MODEL: "openai-codex/gpt-5.6-sol",
} satisfies NodeJS.ProcessEnv;

test("loads and normalizes bridge configuration", () => {
  const config = loadConfig(validEnv);
  assert.deepEqual(config.clickclack.ownerIds, ["usr_one", "usr_two"]);
  assert.equal(config.projects.clickclack, "/srv/clickclack");
  assert.equal(config.invocationMode, "mention");
  assert.equal(config.thinkingLevel, "medium");
});

test("reports all invalid configuration fields without exposing token values", () => {
  assert.throws(
    () =>
      loadConfig({
        ...validEnv,
        CLICKCLACK_URL: "ftp://nope",
        CLICKCLACK_PROJECTS: '{"bad":"relative"}',
        PI_THINKING_LEVEL: "huge",
      }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /CLICKCLACK_URL/);
      assert.match(error.message, /absolute path/);
      assert.match(error.message, /PI_THINKING_LEVEL/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    },
  );
});
