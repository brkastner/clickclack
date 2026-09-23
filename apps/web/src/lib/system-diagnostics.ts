export type QuotaWindow = { used: number; resetAt: number | null; seconds: number | null };
export type UsageObservation = { at: number; used: number; resetAt: number };
export type SubscriptionAccount = {
  id: string;
  provider: "Claude" | "Codex";
  label: string;
  enabled: boolean;
  isDefault: boolean;
  auth: "connected" | "needs-login" | "unknown";
  status: "fresh" | "stale" | "unavailable";
  issue: string | null;
  checkedAt: number;
  updatedAt: number | null;
  weekly: QuotaWindow | null;
  short: QuotaWindow | null;
  resetsAvailable: number | null;
  burnPerDay: number | null;
  deltaPerDay: number | null;
};
export type SystemDiagnostics = {
  accounts: SubscriptionAccount[];
  issue: string | null;
  capturedAt: number;
  desktopVersion: string;
  desktopUptimeSeconds: number;
};

export function sortSubscriptionAccounts(
  accounts: SubscriptionAccount[],
  now: number,
): SubscriptionAccount[] {
  const rank = (a: SubscriptionAccount) =>
    a.status === "fresh" &&
    a.updatedAt !== null &&
    now - a.updatedAt <= 15 * 60_000 &&
    a.weekly &&
    (a.weekly.resetAt === null || a.weekly.resetAt > now)
      ? a.weekly.used
      : Infinity;
  return [...accounts].sort((a, b) => {
    if (a.provider !== b.provider) return a.provider === "Claude" ? -1 : 1;
    if (a.provider !== "Codex") return 0;
    const left = rank(a),
      right = rank(b);
    if (left !== right) return left < right ? -1 : 1;
    const resetA = a.weekly?.resetAt ?? Infinity,
      resetB = b.weekly?.resetAt ?? Infinity;
    return resetA === resetB ? 0 : resetA < resetB ? -1 : 1;
  });
}

export function remainingColor(used: number): string {
  const remaining = 100 - used;
  return remaining <= 20 ? "var(--rp-love)" : remaining <= 40 ? "var(--warn)" : "var(--rp-foam)";
}

const DAY = 86_400_000;
// Require complete, comparable 24h windows. Never infer a trend across a reset,
// a decrease in usage, or a large gap in observations.
export function usageTrend(
  samples: UsageObservation[],
  now: number,
): {
  burnPerDay: number | null;
  deltaPerDay: number | null;
} {
  const none = { burnPerDay: null, deltaPerDay: null };
  const sorted = samples.filter((s) => s.at <= now).sort((a, b) => a.at - b.at);
  const last = sorted.at(-1);
  if (!last || now - last.at > 15 * 60_000 || last.resetAt <= now) return none;
  const sameWindow = sorted.filter((s) => Math.abs(s.resetAt - last.resetAt) < 60_000);
  function rate(endAt: number): number | null {
    const end = [...sameWindow].reverse().find((s) => s.at <= endAt);
    const start = [...sameWindow].reverse().find((s) => s.at <= endAt - DAY);
    if (!start || !end || endAt - end.at > 15 * 60_000 || endAt - DAY - start.at > 15 * 60_000)
      return null;
    const segment = sameWindow.filter((s) => s.at >= start.at && s.at <= end.at);
    if (
      segment.some(
        (s, i) => i > 0 && (s.used < segment[i - 1].used || s.at - segment[i - 1].at > 30 * 60_000),
      )
    )
      return null;
    return ((end.used - start.used) * DAY) / (end.at - start.at);
  }
  const current = rate(last.at);
  const previous = rate(last.at - DAY);
  return {
    burnPerDay: current,
    deltaPerDay: current !== null && previous !== null ? current - previous : null,
  };
}

export function hourlyBurnRate(burnPerDay: number | null): number | null {
  return burnPerDay === null ? null : burnPerDay / 24;
}

export function quotaForecast(
  account: SubscriptionAccount,
  now: number,
): { text: string; risk: boolean } {
  if (account.status !== "fresh" || !account.updatedAt || now - account.updatedAt > 15 * 60_000)
    return { text: "forecast unavailable", risk: false };
  const q = account.weekly;
  if (!q || !q.resetAt || q.resetAt <= now)
    return { text: "waiting for quota reading", risk: false };
  const left = Math.max(0, 100 - q.used);
  if (left === 0) return { text: "weekly allowance exhausted", risk: true };
  if (account.burnPerDay === null) return { text: "collecting 24h burn history", risk: false };
  const daysLeft = (q.resetAt - now) / DAY;
  const burn = account.burnPerDay;
  if (burn > 0 && left / burn < daysLeft)
    return { text: `estimated empty in ${duration((left / burn) * DAY)}`, risk: true };
  return {
    text: `~${Math.round(Math.max(0, left - burn * daysLeft))}% buffer at reset`,
    risk: false,
  };
}

export function duration(ms: number): string {
  if (ms <= 0) return "now";
  const minutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days) return `${days}d ${hours % 24}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
