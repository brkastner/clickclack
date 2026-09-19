import assert from "node:assert/strict";
import test from "node:test";
import {
  remainingColor,
  sortSubscriptionAccounts,
  usageTrend,
  quotaForecast,
  type SubscriptionAccount,
} from "./system-diagnostics.ts";
const DAY = 86400_000;
const now = 10 * DAY;
const account: SubscriptionAccount = {
  id: "a",
  provider: "Claude",
  label: "test",
  enabled: true,
  isDefault: false,
  auth: "connected",
  status: "fresh",
  issue: null,
  checkedAt: now,
  updatedAt: now,
  weekly: { used: 72, resetAt: now + 3.5 * DAY, seconds: 604800 },
  short: null,
  burnPerDay: 12,
  deltaPerDay: 3,
};
test("Codex sorts by remaining allowance then nearest reset without mutating input", () => {
  const codex = (id: string, used: number, reset: number): SubscriptionAccount => ({
    ...account,
    id,
    provider: "Codex",
    weekly: { used, resetAt: now + reset * DAY, seconds: 604800 },
  });
  const rows = [
    codex("late", 100, 4),
    codex("most", 3, 6),
    codex("soon", 100, 1),
    { ...codex("unknown", 0, 1), status: "stale" as const },
    account,
  ];
  assert.deepEqual(
    sortSubscriptionAccounts(rows, now).map((a) => a.id),
    ["a", "most", "soon", "late", "unknown"],
  );
  assert.equal(rows[0].id, "late");
});

test("remaining capacity controls color at both boundaries", () => {
  for (const [used, token] of [
    [0, "foam"],
    [59, "foam"],
    [60, "warn"],
    [79, "warn"],
    [80, "love"],
    [100, "love"],
  ] as const)
    assert.match(remainingColor(used), new RegExp(token));
});
test("forecasts distinguish exhaustion, buffer, unknown and stale", () => {
  assert.deepEqual(quotaForecast(account, now), { text: "estimated empty in 2d 8h", risk: true });
  assert.equal(
    quotaForecast(
      { ...account, weekly: { used: 38, resetAt: now + 4 * DAY, seconds: 604800 }, burnPerDay: 8 },
      now,
    ).text,
    "~30% buffer at reset",
  );
  assert.match(quotaForecast({ ...account, burnPerDay: null }, now).text, /collecting/);
  assert.match(quotaForecast({ ...account, status: "stale" }, now).text, /unavailable/);
  assert.match(quotaForecast(account, now + DAY).text, /unavailable/);
});
test("trends require full continuous windows and never span resets", () => {
  const samples = Array.from({ length: 577 }, (_, i) => ({
    at: now - 2 * DAY + i * 5 * 60_000,
    used: i / 24,
    resetAt: now + DAY,
  }));
  const result = usageTrend(samples, now);
  assert.equal(result.burnPerDay, 12);
  assert.equal(result.deltaPerDay, 0);
  assert.equal(usageTrend(samples.slice(-12), now).burnPerDay, null);
  assert.equal(
    usageTrend(
      samples.filter((_, i) => i < 310 || i > 330),
      now,
    ).burnPerDay,
    null,
  );
  assert.equal(
    usageTrend(
      samples.map((s, i) => (i > 300 ? { ...s, used: s.used - 12, resetAt: now + 7 * DAY } : s)),
      now,
    ).burnPerDay,
    null,
  );
  assert.equal(usageTrend(samples, now + DAY).burnPerDay, null);
});
