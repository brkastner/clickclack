import assert from "node:assert/strict";
import test from "node:test";
import { loadNotificationMessage } from "./browser-notifications.ts";

test("notification message lookup succeeds without delaying the common path", async () => {
  const waits: number[] = [];
  const message = await loadNotificationMessage(
    async () => ({ body: "reply" }),
    async (delayMs) => waits.push(delayMs),
  );

  assert.deepEqual(message, { body: "reply" });
  assert.deepEqual(waits, []);
});

test("notification message lookup retries a transient read miss", async () => {
  let attempts = 0;
  const waits: number[] = [];
  const message = await loadNotificationMessage(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("not readable yet");
      return { body: "reply" };
    },
    async (delayMs) => waits.push(delayMs),
  );

  assert.deepEqual(message, { body: "reply" });
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [75]);
});

test("notification message lookup preserves the generic fallback after bounded retries", async () => {
  let attempts = 0;
  const waits: number[] = [];
  const message = await loadNotificationMessage(
    async () => {
      attempts += 1;
      throw new Error("unavailable");
    },
    async (delayMs) => waits.push(delayMs),
  );

  assert.equal(message, null);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [75, 150]);
});
