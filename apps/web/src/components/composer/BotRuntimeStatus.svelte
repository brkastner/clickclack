<script lang="ts">
  import { onDestroy } from "svelte";
  import { api } from "../../lib/api";
  import type { BotRuntimeStatus, BotRuntimeStatusTarget } from "../../lib/types";

  type Props = { target: BotRuntimeStatusTarget };
  let { target }: Props = $props();

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
      status = result.statuses.find((candidate) => candidate.bot_user_id === target.botUserID) ?? null;
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

  const interval = setInterval(() => void refresh(targetKey), 30_000);
  onDestroy(() => clearInterval(interval));

  let fresh = $derived(Boolean(status && Date.parse(status.expires_at) > Date.now()));
  let modelText = $derived(fresh && status ? status.model_id : "unavailable");
  let reasoningText = $derived(fresh && status ? status.reasoning : "unavailable");
</script>

{#if loaded}
  <div class="bot-runtime-status" aria-label="Bot runtime status" aria-live="polite">
    <span><strong>Model</strong> <span title={fresh && status ? `${status.model_provider}/${status.model_id}` : undefined}>{modelText}</span></span>
    <span><strong>Thinking</strong> {reasoningText}{#if fresh && status?.fast_mode === true} <em>fast</em>{/if}</span>
  </div>
{/if}

<style>
  .bot-runtime-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.35rem 0.35rem 0;
    color: var(--muted);
    font-size: 0.72rem;
    line-height: 1.3;
  }

  .bot-runtime-status strong {
    color: var(--muted-strong, var(--muted));
    font-weight: 600;
  }

  .bot-runtime-status em {
    color: var(--accent);
    font-style: normal;
    font-weight: 600;
  }

  @media (max-width: 520px) {
    .bot-runtime-status {
      align-items: flex-start;
      flex-direction: column;
      gap: 0.15rem;
    }
  }
</style>
