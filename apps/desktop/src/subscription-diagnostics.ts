import { createHash } from "node:crypto";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import {
  usageTrend,
  type QuotaWindow,
  type SubscriptionAccount,
  type UsageObservation,
} from "../../web/src/lib/system-diagnostics";

type RecordValue = Record<string, unknown>;
type Credential = { type?: string; access?: string; accountId?: string };
type Account = {
  id: string;
  provider: "Claude" | "Codex";
  label: string;
  enabled: boolean;
  credential: Credential;
};
const PERIOD = 5 * 60_000;
const MAX_FILE = 4 * 1024 * 1024;
const object = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const percent = (value: unknown): number | null =>
  finite(value) && value >= 0 && value <= 100 ? value : null;

async function jsonFile(file: string): Promise<RecordValue> {
  try {
    const bytes = await readFile(file);
    if (bytes.length > MAX_FILE) throw new Error("oversized file");
    return object(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("local data could not be read");
  }
}

// Read only. Pi remains the sole owner of refresh tokens and credential writes.
export function piAccounts(auth: unknown, multi: unknown): Account[] {
  const primary = object(auth);
  const pools = object(object(multi).providers);
  const accounts: Account[] = [];
  const seen = new Set<string>();
  for (const [key, provider] of [
    ["anthropic", "Claude"],
    ["openai-codex", "Codex"],
  ] as const) {
    const pool = object(pools[key]);
    const upstream = object(pool.upstream);
    const rows = [
      {
        id: "upstream",
        label: upstream.label ?? "Pi default",
        enabled: pool.includeUpstream !== false && upstream.enabled !== false,
        credential: primary[key],
      },
      ...(Array.isArray(pool.accounts) ? pool.accounts.map(object) : []),
    ];
    for (const row of rows) {
      const credential = object(row.credential) as Credential;
      if (
        credential.type !== "oauth" ||
        typeof credential.access !== "string" ||
        !credential.access
      )
        continue;
      // Codex account ID identifies the allowance, not an individual login token.
      // Opaque Claude tokens can only be safely deduplicated by exact match.
      const identity =
        provider === "Codex" && typeof credential.accountId === "string"
          ? credential.accountId
          : credential.access;
      const fingerprint = hash(`${key}:${identity}`);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const stable = provider === "Codex" ? fingerprint : hash(`${key}:${String(row.id)}`);
      accounts.push({
        id: stable,
        provider,
        label: typeof row.label === "string" ? row.label.slice(0, 100) : "Pi account",
        enabled: row.enabled !== false,
        credential,
      });
    }
  }
  return accounts;
}

export function parseQuota(
  provider: "Claude" | "Codex",
  data: unknown,
  now: number,
): { weekly: QuotaWindow | null; short: QuotaWindow | null } {
  const value = object(data);
  function window(
    raw: unknown,
    anthropic: boolean,
    seconds: number | null = null,
  ): QuotaWindow | null {
    const w = object(raw);
    const used = percent(anthropic ? w.utilization : w.used_percent);
    if (used === null) return null;
    const timestamp = anthropic
      ? typeof w.resets_at === "string"
        ? Date.parse(w.resets_at)
        : NaN
      : finite(w.reset_at)
        ? w.reset_at * (w.reset_at > 100_000_000_000 ? 1 : 1000)
        : finite(w.reset_after_seconds)
          ? now + w.reset_after_seconds * 1000
          : NaN;
    return {
      used,
      resetAt: Number.isFinite(timestamp) ? timestamp : null,
      seconds: anthropic ? seconds : finite(w.limit_window_seconds) ? w.limit_window_seconds : null,
    };
  }
  if (provider === "Claude")
    return {
      weekly: window(value.seven_day, true, 604800),
      short: window(value.five_hour, true, 18000),
    };
  const bucket = object(value.rate_limit);
  const windows = [
    window(bucket.primary_window, false),
    window(bucket.secondary_window, false),
  ].filter((w): w is QuotaWindow => w !== null);
  // Never label a short or unknown-duration allowance as weekly.
  return {
    weekly: windows.find((w) => w.seconds === 604800) ?? null,
    short: windows.find((w) => w.seconds !== null && w.seconds < 86400) ?? null,
  };
}

export class SubscriptionDiagnostics {
  private cache: { accounts: SubscriptionAccount[]; issue: string | null } | undefined;
  private lastAttempt = -Infinity;
  private pending: Promise<{ accounts: SubscriptionAccount[]; issue: string | null }> | undefined;
  private history: Record<string, UsageObservation[]> = {};
  private loaded = false;
  constructor(
    private readonly historyFile: string,
    private readonly agentDir = process.env.PI_CODING_AGENT_DIR ||
      path.join(homedir(), ".pi", "agent"),
    private readonly request: typeof fetch = fetch,
    private readonly clock = Date.now,
  ) {}

  async get() {
    if (this.pending) return this.pending;
    if (this.cache && this.clock() - this.lastAttempt < PERIOD) return this.cache;
    this.lastAttempt = this.clock();
    this.pending = this.collect().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async collect() {
    const now = this.clock();
    try {
      const [auth, multi] = await Promise.all([
        jsonFile(path.join(this.agentDir, "auth.json")),
        jsonFile(path.join(this.agentDir, "multiprovider-auth.json")),
      ]);
      if (!this.loaded) {
        try {
          const saved = await jsonFile(this.historyFile);
          for (const [id, rows] of Object.entries(saved)) {
            if (!/^[a-f0-9]{24}$/.test(id) || !Array.isArray(rows)) continue;
            this.history[id] = rows
              .filter(
                (s): s is UsageObservation =>
                  finite(s?.at) &&
                  percent(s?.used) !== null &&
                  finite(s?.resetAt) &&
                  s.at <= now &&
                  s.at > now - 3 * 86400_000,
              )
              .slice(-900);
          }
        } catch {
          /* Missing/corrupt history starts a fresh observation window. */
        }
        this.loaded = true;
      }
      const inventory = piAccounts(auth, multi);
      const accounts: SubscriptionAccount[] = [];
      // Small batches bound provider traffic, including on large account pools.
      for (let i = 0; i < inventory.length; i += 3) {
        accounts.push(
          ...(await Promise.all(inventory.slice(i, i + 3).map((a) => this.readAccount(a, now)))),
        );
      }
      const active = new Set(accounts.map((a) => a.id));
      this.history = Object.fromEntries(
        Object.entries(this.history).filter(([id]) => active.has(id)),
      );
      let issue: string | null = null;
      try {
        await mkdir(path.dirname(this.historyFile), { recursive: true, mode: 0o700 });
        const temporary = `${this.historyFile}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(this.history), { mode: 0o600 });
        await rename(temporary, this.historyFile);
      } catch {
        issue = "burn history could not be saved";
      }
      this.cache = { accounts, issue };
    } catch {
      this.cache = {
        accounts: (this.cache?.accounts ?? []).map((a) => ({
          ...a,
          status: "stale" as const,
          auth: "unknown" as const,
          burnPerDay: null,
          deltaPerDay: null,
        })),
        issue: "Pi account files could not be read",
      };
    }
    return this.cache;
  }

  private async readAccount(account: Account, now: number): Promise<SubscriptionAccount> {
    const previous = this.cache?.accounts.find((a) => a.id === account.id);
    const result: SubscriptionAccount = {
      id: account.id,
      provider: account.provider,
      label: account.label,
      enabled: account.enabled,
      auth: "unknown",
      status: previous?.weekly ? "stale" : "unavailable",
      issue: null,
      checkedAt: now,
      updatedAt: previous?.updatedAt ?? null,
      weekly: previous?.weekly ?? null,
      short: previous?.short ?? null,
      burnPerDay: null,
      deltaPerDay: null,
    };
    try {
      const headers: Record<string, string> = {
        authorization: `Bearer ${account.credential.access}`,
        accept: "application/json",
      };
      const claude = account.provider === "Claude";
      if (claude) headers["anthropic-beta"] = "oauth-2025-04-20";
      else if (typeof account.credential.accountId === "string")
        headers["chatgpt-account-id"] = account.credential.accountId;
      const response = await this.request(
        claude
          ? "https://api.anthropic.com/api/oauth/usage"
          : "https://chatgpt.com/backend-api/wham/usage",
        { headers, redirect: "error", signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) {
        result.auth = response.status === 401 ? "needs-login" : "unknown";
        result.issue =
          response.status === 401
            ? "refresh this login in Pi"
            : response.status === 403
              ? "usage access denied"
              : response.status === 429
                ? "usage endpoint rate limited"
                : "usage provider unavailable";
        return result;
      }
      const raw = await response.text();
      if (raw.length > MAX_FILE) throw new Error("oversized response");
      const quota = parseQuota(account.provider, JSON.parse(raw), now);
      Object.assign(result, quota, { auth: "connected", status: "fresh", updatedAt: now });
      if (!quota.weekly) result.issue = "weekly quota not reported";
      if (quota.weekly?.resetAt && quota.weekly.resetAt > now) {
        const rows = (this.history[account.id] ?? []).filter((s) => s.at > now - 3 * 86400_000);
        rows.push({ at: now, used: quota.weekly.used, resetAt: quota.weekly.resetAt });
        this.history[account.id] = rows.slice(-900);
        Object.assign(result, usageTrend(rows, now));
      }
    } catch {
      result.issue = "usage reading unavailable";
    }
    return result;
  }
}
