import assert from "node:assert/strict";
import { test } from "node:test";
import { Logger } from "./logger.js";

test("redacts secrets from structured logs", () => {
  const lines: string[] = [];
  const logger = new Logger((line) => lines.push(line));
  logger.info("configured", {
    botToken: "ccb_secret",
    nested: { authorization: "Bearer secret", safe: "visible" },
  });
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0]!, /ccb_secret|Bearer secret/);
  assert.match(lines[0]!, /visible/);
  assert.deepEqual(JSON.parse(lines[0]!).botToken, "[redacted]");
});
