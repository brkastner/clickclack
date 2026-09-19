import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { piAccounts, parseQuota, SubscriptionDiagnostics } from "./subscription-diagnostics";
const now = 1780000000000;
test("Pi inventory deduplicates identical logins, preserves disabled and excludes API keys", () => {
  const credential = { type: "oauth", access: "private-access", accountId: "same-allowance" };
  const result = piAccounts(
    { "openai-codex": credential, anthropic: { type: "api_key", key: "secret" } },
    {
      providers: {
        "openai-codex": {
          accounts: [
            { id: "copy", credential: { ...credential, access: "second-token" } },
            {
              id: "disabled",
              enabled: false,
              credential: { ...credential, accountId: "different" },
            },
          ],
        },
      },
    },
  );
  assert.equal(result.length, 2);
  assert.equal(result[1].enabled, false);
  assert.equal(result[0].provider, "Codex");
});
test("Codex weekly-only primary is not mistaken for a short window", () => {
  const result = parseQuota(
    "Codex",
    {
      rate_limit: {
        primary_window: {
          used_percent: 100,
          limit_window_seconds: 604800,
          reset_at: now / 1000 + 3000,
        },
        secondary_window: null,
      },
    },
    now,
  );
  assert.equal(result.weekly?.used, 100);
  assert.equal(result.short, null);
  assert.equal(
    parseQuota("Codex", { rate_limit: { primary_window: { used_percent: 3 } } }, now).weekly,
    null,
  );
  assert.equal(parseQuota("Claude", { seven_day: { utilization: null } }, now).weekly, null);
  assert.equal(parseQuota("Claude", { seven_day: { utilization: -1 } }, now).weekly, null);
  assert.equal(
    parseQuota("Claude", { seven_day: { utilization: 0, resets_at: "bad" } }, now).weekly?.resetAt,
    null,
  );
});
test("collector caches, keeps secrets out of output/history and reports stale auth failures", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "clickclack-usage-"));
  try {
    const credential = {
      type: "oauth",
      access: "never-export-this-access",
      refresh: "never-export-this-refresh",
      accountId: "private-account",
    };
    await writeFile(path.join(dir, "auth.json"), JSON.stringify({ "openai-codex": credential }));
    let time = now,
      calls = 0,
      code = 200;
    const request = (async (url: string, options: RequestInit) => {
      calls++;
      assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
      assert.equal(options.redirect, "error");
      assert.equal(
        (options.headers as Record<string, string>).authorization,
        `Bearer ${credential.access}`,
      );
      return new Response(
        code === 200
          ? JSON.stringify({
              rate_limit: {
                primary_window: {
                  used_percent: 30,
                  limit_window_seconds: 604800,
                  reset_at: now / 1000 + 86400,
                },
              },
              email: "private@example.com",
            })
          : "upstream secret error",
        { status: code },
      );
    }) as typeof fetch;
    const history = path.join(dir, "history.json");
    const collector = new SubscriptionDiagnostics(history, dir, request, () => time);
    const [a, b] = await Promise.all([collector.get(), collector.get()]);
    assert.deepEqual(a, b);
    assert.equal(calls, 1);
    assert.equal(a.accounts[0].weekly?.used, 30);
    assert.equal(a.accounts[0].burnPerDay, null);
    await collector.get();
    assert.equal(calls, 1);
    for (const secret of [
      credential.access,
      credential.refresh,
      credential.accountId,
      "private@example.com",
    ]) {
      assert.ok(!JSON.stringify(a).includes(secret));
      assert.ok(!(await readFile(history, "utf8")).includes(secret));
    }
    time += 5 * 60_000;
    code = 401;
    const failed = await collector.get();
    assert.equal(failed.accounts[0].auth, "needs-login");
    assert.equal(failed.accounts[0].status, "stale");
    assert.equal(failed.accounts[0].weekly?.used, 30);
    assert.equal(failed.accounts[0].updatedAt, now);
    assert.ok(!JSON.stringify(failed).includes("upstream secret error"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
