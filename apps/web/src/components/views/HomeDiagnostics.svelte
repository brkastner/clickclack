<script lang="ts">
  import { onMount } from "svelte";
  import { desktop } from "$lib/desktop";
  import { voiceBaseURL } from "$lib/api";
  import { duration, hourlyBurnRate, quotaForecast, remainingColor, sortSubscriptionAccounts, type SystemDiagnostics } from "$lib/system-diagnostics";

  let { connected = false, voiceStatus = "unknown" }: { connected?: boolean; voiceStatus?: string } = $props();
  let data = $state<SystemDiagnostics | null>(null);
  let now = $state(Date.now());
  let issue = $state("");
  let loading = $state(true);
  let kassetteStatus = $state("checking…");
  const accounts = $derived(sortSubscriptionAccounts(data?.accounts ?? [], now));
  onMount(() => {
    let stopped = false;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        if (!desktop?.systemDiagnostics) {
          if (!stopped) issue = "local Pi usage requires an updated ClickClack desktop app";
          return;
        }
        const result = await desktop.systemDiagnostics();
        if (!stopped) { data = result; issue = result?.issue ?? (result ? "" : "local telemetry unavailable"); }
      } catch { if (!stopped) issue = "local telemetry unavailable"; }
      finally { pending = false; if (!stopped) loading = false; }
    }
    const controller = new AbortController();
    async function checkKassette() {
      try {
        const response = await fetch(`${voiceBaseURL()}/status`, { credentials: "omit", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4_000)]) });
        const status = response.ok ? await response.json() : null;
        if (!stopped) kassetteStatus = status?.status === "ready" ? "ready" : "unavailable";
      } catch { if (!stopped) kassetteStatus = "unreachable"; }
    }
    void refresh();
    void checkKassette();
    const poll = window.setInterval(() => { void refresh(); void checkKassette(); }, 60_000);
    const clock = window.setInterval(() => (now = Date.now()), 30_000);
    return () => { stopped = true; controller.abort(); window.clearInterval(poll); window.clearInterval(clock); };
  });
</script>

<aside class="system-rail" aria-label="System information">
  <header class="system-heading">
    <h2>system</h2>
    <span class="sample">local diagnostics</span>
  </header>
  <div class="runtime"><span>desktop <b>{data ? `v${data.desktopVersion}` : "unavailable"}</b></span><span>{data ? `up ${duration(data.desktopUptimeSeconds * 1000 + Math.max(0, now - data.capturedAt))}` : ""}</span></div>

  <section class="subscriptions" aria-labelledby="subscriptions-title">
    <div class="section-heading"><h3 id="subscriptions-title">subscriptions</h3><span>via Pi · every 5m</span></div>
    {#if loading}<p class="source-note" role="status">reading local accounts…</p>{/if}
    {#if issue}<p class="source-note" role="status">{issue}</p>{/if}
    {#if !loading && !issue && !accounts.length}<p class="source-note">no Claude or Codex OAuth connections found in Pi.</p>{/if}
    <p class="hint">weekly allowance · bars show remaining</p>
    {#each accounts as account (account.id)}
      {@const quota = account.weekly}
      {@const stale = account.status !== "fresh" || !account.updatedAt || now - account.updatedAt > 15 * 60_000 || (quota?.resetAt != null && quota.resetAt <= now)}
      {@const forecast = quotaForecast(account, now)}
      {@const burnPerHour = hourlyBurnRate(account.burnPerDay)}
      <details class="account">
        <summary>
          <div class="account-heading"><strong>{account.provider} <span>{account.label === "Pi default" && account.isDefault ? "" : account.label}</span>{#if account.isDefault}<small class="default-badge" title="Current default login in Pi">Pi default</small>{/if}</strong><span class="remaining" style:color={quota && !stale ? remainingColor(quota.used) : "var(--muted)"}>{quota ? `${Math.round(100 - quota.used)}% left` : "unknown"} <i aria-hidden="true">⌄</i></span></div>
          {#if quota}
            <div class="usage" role="meter" aria-label={`${account.provider} ${account.label} weekly allowance remaining${stale ? " (last reading, stale)" : ""}`} aria-valuenow={100 - quota.used} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${quota.used}% used, ${100 - quota.used}% left${stale ? ", stale" : ""}`}><span style:background={stale ? "var(--muted)" : remainingColor(quota.used)} style:width={`${100 - quota.used}%`}></span></div>
            <div class="account-meta"><span>{quota.used}% used {stale ? "· stale" : ""}</span><span>{quota.resetAt ? `reset ${quota.resetAt > now ? "in " : "due · "}${duration(quota.resetAt - now)}` : "reset unknown"}</span></div>
          {/if}
          {#if account.issue}<p class="stale-note">{account.issue}</p>{/if}
          <p class="forecast" class:at-risk={forecast.risk}>{forecast.risk ? "↗" : "↳"} {forecast.text}</p>
          {#if account.short}<p class="stale-note">{account.short.seconds ? `${account.short.seconds / 3600}h window` : "short window"}: {Math.round(100 - account.short.used)}% left{account.short.resetAt ? ` · reset in ${duration(account.short.resetAt - now)}` : ""}</p>{/if}
          <p class="stale-note">manual resets: {account.resetsAvailable === null ? "not reported" : `${account.resetsAvailable} available${stale ? " (last reading)" : ""}`}</p>
        </summary>
        <div class="account-detail">
          <dl>
            <div><dt>burn / day</dt><dd>{account.burnPerDay !== null && !stale ? `${account.burnPerDay.toFixed(1)} pp` : "collecting 24h history"}</dd></div>
            <div><dt>burn / hour (24h avg)</dt><dd>{burnPerHour !== null && !stale ? `${burnPerHour.toFixed(2)} pp` : "collecting 24h history"}</dd></div>
            <div><dt>vs prior day</dt><dd>{account.deltaPerDay !== null && !stale ? `${account.deltaPerDay >= 0 ? "+" : ""}${account.deltaPerDay.toFixed(1)} pp/day` : "needs 48h history"}</dd></div>
            <div><dt>OAuth</dt><dd>{account.auth === "connected" && stale ? "last check connected" : account.auth}</dd></div>
            <div><dt>Pi pool</dt><dd>{account.enabled ? "enabled" : "disabled"}</dd></div>
            <div><dt>last reading</dt><dd>{account.updatedAt ? `${duration(now - account.updatedAt)} ago` : "unavailable"}</dd></div>
          </dl>
          <p>forecast uses the last 24h. separate model and short-window limits may still apply.</p>
        </div>
      </details>
    {/each}
    <p class="source-note">accounts from Pi, independent of chat providers.<br />forecasts are estimates, not reserved capacity.</p>
  </section>

  <details class="services" open>
    <summary><h3>connections & services</h3><span><i aria-hidden="true">⌄</i></span></summary>
    <dl>
      <div><dt>chat connection</dt><dd>{#if connected}<i class="dot"></i>{/if}{connected ? "connected" : "disconnected"}</dd></div>
      <div><dt>kassette</dt><dd>{#if kassetteStatus === "ready"}<i class="dot"></i>{/if}{kassetteStatus}</dd></div>
      <div><dt>voice session</dt><dd>{voiceStatus}</dd></div>
    </dl>
  </details>
  <p class="prototype-note">Pi owns logins · credentials stay on this device</p>
</aside>

<style>
  .system-rail { color: var(--text); font-size: 13px; min-width: 0; align-self: start; border: 1px solid var(--line); border-radius: 10px; background: color-mix(in srgb, var(--panel) 95%, transparent); }
  .system-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 16px 16px 8px; }
  h2 { margin: 0; font: 750 20px var(--font-display); color: var(--text-strong); }
  .sample { color: var(--muted); font: 10px var(--font-mono); }
  .runtime { display: flex; justify-content: space-between; padding: 0 16px 16px; color: var(--muted); font: 11px var(--font-mono); }
  .runtime b { color: var(--text); font-weight: 400; }
  .subscriptions { border-top: 1px solid var(--line); }
  .section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 16px 16px 0; }
  h3 { margin: 0; font: 700 15px var(--font-display); color: var(--text-strong); }
  .section-heading > span { color: var(--muted); font: 10px var(--font-mono); }
  .hint { color: var(--muted); margin: 5px 16px 4px; font-size: 11px; }
  .account { margin: 0 16px; border-bottom: 1px solid var(--line); }
  summary { cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 3px; }
  .account > summary { padding: 16px 0 12px; }
  .account-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .account-heading strong { color: var(--text-strong); font-size: 13px; font-weight: 650; }
  .account-heading strong span { color: var(--muted); font-size: 12px; font-weight: 400; margin-left: 4px; }
  .default-badge { display: inline-block; margin-left: 6px; padding: 2px 4px; border: 1px solid var(--line-strong); border-radius: 4px; color: var(--accent); font: 9px var(--font-mono); vertical-align: middle; }
  .account-heading strong { min-width: 0; overflow-wrap: anywhere; }
  .remaining { flex-shrink: 0; font: 11px var(--font-mono); color: var(--text); }
  summary i { display: inline-block; font-style: normal; margin-left: 5px; color: var(--muted); }
  details[open] > summary i { transform: rotate(180deg); }
  .usage { height: 4px; margin-top: 11px; background: var(--line); border-radius: 2px; overflow: hidden; }
  .usage > span { display: block; height: 100%; background: var(--accent); border-radius: inherit; opacity: .75; }
  .account-meta { display: flex; justify-content: space-between; color: var(--muted); font: 10px var(--font-mono); margin-top: 7px; }
  .forecast { margin: 10px 0 0; font-size: 12px; color: var(--text); }
  .at-risk { color: var(--rp-love); }
  .account-detail { padding: 0 0 12px; }
  dl { margin: 0; }
  dl > div { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 4px 0; }
  dt { color: var(--muted); font-size: 11px; }
  dd { margin: 0; font-size: 11px; text-align: right; }
  .account-detail p, .source-note { color: var(--muted); font-size: 11px; line-height: 1.5; margin: 6px 0 0; }
  .stale-note { color: var(--muted); font-size: 11px; margin: 7px 0 0; }
  .source-note { margin: 12px 16px 16px; }
  .services { border-top: 1px solid var(--line); padding: 14px 16px; }
  .services summary { display: flex; align-items: center; justify-content: space-between; }
  .services summary > span { font-size: 10px; color: var(--muted); }
  .services dl { margin-top: 10px; }
  .services dl > div { padding: 6px 0; }
  .dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--rp-foam); margin-right: 6px; }
  .prototype-note { margin: 0; padding: 10px 16px; border-top: 1px solid var(--line); color: var(--muted); font: 10px var(--font-mono); }
</style>
