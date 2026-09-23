<script lang="ts">
  import { onDestroy } from "svelte";
  import { api } from "../../lib/api";
  import type { BotRuntimeStatus, BotRuntimeStatusTarget } from "../../lib/types";

  type Props = { target: BotRuntimeStatusTarget; update?: BotRuntimeStatus | null };
  let { target, update = null }: Props = $props();

  let status = $state<BotRuntimeStatus | null>(null);
  let loaded = $state(false);
  let requestSerial = 0;
  let targetKey = $derived(`${target.kind}:${target.id}:${target.botUserID}`);
  let requestedKey = "";

  async function refresh(key: string) {
    const serial = ++requestSerial;
    try {
      const result = await api<{ statuses: BotRuntimeStatus[] }>(
        `/api/${target.kind}/${encodeURIComponent(target.id)}/bot-runtime-status`,
      );
      if (serial !== requestSerial || key !== targetKey) return;
      const fetched = result.statuses.find((candidate) => candidate.bot_user_id === target.botUserID) ?? null;
      if (!status || !fetched || Date.parse(fetched.updated_at) >= Date.parse(status.updated_at)) status = fetched;
    } catch {
      if (serial !== requestSerial || key !== targetKey) return;
      status = null;
    } finally {
      if (serial === requestSerial && key === targetKey) loaded = true;
    }
  }

  $effect(() => {
    const key = targetKey;
    if (key === requestedKey) return;
    requestedKey = key;
    loaded = false;
    status = null;
    void refresh(key);
  });

  $effect(() => {
    if (!update || !loaded) return;
    if (update.bot_user_id !== target.botUserID ||
      (target.kind === "channels" ? update.channel_id : update.direct_conversation_id) !== target.id) return;
    ++requestSerial;
    status = update;
  });

  const interval = setInterval(() => void refresh(targetKey), 30_000);
  onDestroy(() => clearInterval(interval));

  let fresh = $derived(Boolean(status && Date.parse(status.expires_at) > Date.now()));
</script>

{#if loaded && fresh && status}
  <div class="bot-runtime-status" aria-label="Bot runtime status" aria-live="polite">
    <span class="bot-runtime-status__value" title={`${status.model_provider}/${status.model_id}`}>{status.model_id}</span>
    <span class="bot-runtime-status__separator" aria-hidden="true">•</span>
    <span class="bot-runtime-status__value">{status.reasoning}</span>
    {#if status.fast_mode === true}
      <span class="bot-runtime-status__separator" aria-hidden="true">•</span>
      <em>fast</em>
    {/if}
  </div>
{/if}

<style>
  .bot-runtime-status {
    display: flex;
    min-width: 0;
    max-width: 100%;
    height: 40px;
    box-sizing: border-box;
    flex: 0 1 auto;
    align-items: center;
    gap: 0.4rem;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    background: color-mix(in srgb, var(--panel) 85%, var(--bg));
    color: var(--muted);
    font-size: 12px;
    line-height: 16px;
    white-space: nowrap;
  }

  .bot-runtime-status__value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bot-runtime-status__value:first-child {
    flex: 1 1 auto;
    direction: rtl;
    text-align: left;
  }

  .bot-runtime-status__value:not(:first-child) {
    flex: none;
  }

  .bot-runtime-status__separator {
    flex: none;
    color: var(--muted-2);
    font-size: 9px;
  }

  .bot-runtime-status em {
    flex: none;
    color: var(--accent);
    font-style: normal;
    font-weight: 600;
  }
</style>
