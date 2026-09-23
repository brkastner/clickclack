<script lang="ts">
  import HomeDiagnostics from "../views/HomeDiagnostics.svelte";

  let { connected, voiceStatus, navigationKey }: {
    connected: boolean;
    voiceStatus: string;
    navigationKey: string;
  } = $props();

  let open = $state(false);
  let root: HTMLDivElement;
  let previousNavigationKey = navigationKey;

  $effect(() => {
    if (navigationKey !== previousNavigationKey) {
      previousNavigationKey = navigationKey;
      open = false;
    }
  });

  function dismissOutside(event: PointerEvent) {
    if (open && !root.contains(event.target as Node)) open = false;
  }

  function dismissFocus(event: FocusEvent) {
    if (open && !root.contains(event.relatedTarget as Node | null)) open = false;
  }
</script>

<svelte:window
  onpointerdown={dismissOutside}
  onkeydown={(event) => { if (event.key === "Escape" && open) open = false; }}
  onblur={() => (open = false)}
/>

<div class="usage-peek" bind:this={root} onfocusout={dismissFocus}>
  <button
    type="button"
    title="Subscription usage"
    aria-label="Subscription usage"
    aria-expanded={open}
    aria-controls="subscription-usage-peek"
    aria-haspopup="dialog"
    class:active={open}
    onclick={() => (open = !open)}
  >
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 18V9m5 9V5m5 13v-7m5 7V8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  </button>
  {#if open}
    <div id="subscription-usage-peek" class="usage-peek-panel" role="dialog" aria-label="Subscription usage">
      <HomeDiagnostics {connected} {voiceStatus} />
    </div>
  {/if}
</div>

<style>
  .usage-peek { position: relative; display: flex; flex: 0 0 auto; -webkit-app-region: no-drag; }
  .usage-peek-panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 20;
    width: min(360px, calc(100vw - 24px));
    max-height: min(720px, calc(100vh - 72px));
    overflow: auto;
    border-radius: 10px;
    background: var(--panel);
    box-shadow: 0 14px 38px rgba(0, 0, 0, .3);
    -webkit-app-region: no-drag;
    user-select: text;
  }
</style>
