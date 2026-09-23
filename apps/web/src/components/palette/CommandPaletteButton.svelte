<script lang="ts">
  import { onMount } from "svelte";
  import { commandPalette, openCommandPalette } from "$lib/command-palette-state.svelte";

  type Props = {
    // "icon" sits among the topbar keycaps; "pill" is the titlebar's labelled
    // button that also teaches the shortcut.
    variant?: "icon" | "pill";
  };

  let { variant = "icon" }: Props = $props();

  let shortcut = $state("Ctrl K");

  onMount(() => {
    if (/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)) shortcut = "⌘K";
  });

  const title = $derived(`Jump to… (${shortcut.replace(" ", "+")})`);
</script>

{#if variant === "pill"}
  <button
    type="button"
    class="command-palette-pill"
    {title}
    aria-label="Open command palette"
    aria-haspopup="dialog"
    aria-expanded={commandPalette.open}
    aria-keyshortcuts="Control+K Meta+K"
    onclick={openCommandPalette}
  >
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
    <span>Jump to…</span>
    <kbd>{shortcut}</kbd>
  </button>
{:else}
  <button
    type="button"
    class="command-palette-trigger"
    {title}
    aria-label="Open command palette"
    aria-haspopup="dialog"
    aria-expanded={commandPalette.open}
    aria-keyshortcuts="Control+K Meta+K"
    onclick={openCommandPalette}
  >
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path d="M4 5h16v14H4z" />
      <path d="m8 10 2.5 2L8 14M13 14h3" />
    </svg>
  </button>
{/if}

<style>
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Doubled class beats the titlebar's fixed 30px keycap sizing. */
  .command-palette-pill.command-palette-pill {
    display: inline-flex;
    width: auto;
    margin-right: 6px;
    flex: 0 0 auto;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 6px 0 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--panel-2) 84%, transparent);
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
    -webkit-app-region: no-drag;
  }

  .command-palette-pill:hover,
  .command-palette-pill[aria-expanded="true"] {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--line-strong));
    color: var(--text);
  }

  .command-palette-pill:focus-visible {
    outline: 0;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  kbd {
    display: inline-grid;
    place-items: center;
    height: 20px;
    padding: 0 5px;
    border: 1px solid var(--line-strong);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
    background: var(--panel);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1;
  }

  @media (max-width: 900px) {
    .command-palette-pill span {
      display: none;
    }
  }
</style>
