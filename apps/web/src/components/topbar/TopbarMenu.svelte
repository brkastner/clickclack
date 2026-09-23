<script lang="ts">
  import { registerDismissLayer } from "$lib/dismissal";
  import { avatarSize, setAvatarSize } from "$lib/avatar-size";
  import { resolvedColorMode, setColorMode } from "$lib/appearance";
  import {
    INTERFACE_SCALE_STEP,
    MAX_INTERFACE_SCALE,
    MIN_INTERFACE_SCALE,
    interfaceScale,
    setInterfaceScale,
  } from "$lib/interface-scale";
  import type { ChannelNotificationPreference } from "$lib/types";

  // The phone top bar's tools, folded into one menu so the conversation title
  // keeps the width. Rows carry labels because an icon grid in a menu reads as
  // a puzzle on a touch screen.
  type Props = {
    threadOpen: boolean;
    pinsAvailable: boolean;
    pinnedOpen: boolean;
    runAvailable: boolean;
    runOpen: boolean;
    runWaiting: boolean;
    externalHref?: string;
    channelNotifPreference?: ChannelNotificationPreference | null;
    channelNotifSaving: boolean;
    channelSettingsAvailable: boolean;
    onToggleThread: () => void;
    onPinnedItems: () => void;
    onToggleRun: () => void;
    onOpenChannelSettings: () => void;
    onToggleChannelNotifications: () => void;
  };

  let {
    threadOpen,
    pinsAvailable,
    pinnedOpen,
    runAvailable,
    runOpen,
    runWaiting,
    externalHref,
    channelNotifPreference,
    channelNotifSaving,
    channelSettingsAvailable,
    onToggleThread,
    onPinnedItems,
    onToggleRun,
    onOpenChannelSettings,
    onToggleChannelNotifications,
  }: Props = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let menu = $state<HTMLDivElement>();

  const scalePercent = $derived(Math.round($interfaceScale * 100));
  const doubled = $derived($avatarSize === "double");
  const targetMode = $derived($resolvedColorMode === "light" ? "dark" : "light");
  const notifLabel = $derived(
    channelNotifPreference === "muted" ? "Muted" : channelNotifPreference === "mentions" ? "Mentions only" : "All messages",
  );

  function close(returnFocus = false) {
    if (!open) return;
    open = false;
    if (returnFocus) trigger?.focus();
  }

  function toggle() {
    open = !open;
    if (open) queueMicrotask(() => menu?.querySelector<HTMLElement>("[role^='menuitem']")?.focus({ preventScroll: true }));
  }

  /** Run an action that opens something else, then get out of its way. */
  function runAndClose(action: () => void) {
    close();
    action();
  }

  function items(): HTMLElement[] {
    return [...(menu?.querySelectorAll<HTMLElement>("[role^='menuitem']:not([disabled])") ?? [])];
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const list = items();
    if (list.length === 0) return;
    event.preventDefault();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home" ? 0
      : event.key === "End" ? list.length - 1
      : event.key === "ArrowDown" ? (index + 1) % list.length
      : (index - 1 + list.length) % list.length;
    list[next]?.focus();
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!open || !root) return;
    if (event.target instanceof Node && root.contains(event.target)) return;
    close();
  }

  $effect(() => {
    if (!open) return;
    return registerDismissLayer(() => {
      if (!open) return false;
      close(true);
      return true;
    });
  });
</script>

<svelte:window onpointerdowncapture={handleWindowPointerDown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="topbar-menu" bind:this={root} data-handles-escape={open ? "" : undefined} onkeydown={handleKeydown}>
  <button
    bind:this={trigger}
    type="button"
    class="topbar-menu-trigger"
    class:active={open}
    class:attention={runWaiting && !open}
    title="More tools"
    aria-label="More tools"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls="topbar-menu"
    onclick={toggle}
  >
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  </button>

  {#if open}
    <div class="topbar-menu-panel" id="topbar-menu" role="menu" aria-label="More tools" bind:this={menu}>
      <button type="button" role="menuitemcheckbox" aria-checked={threadOpen} onclick={() => runAndClose(onToggleThread)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.16L3 21l1.84-6.4A8 8 0 1 1 21 12Z" /></svg>
        <span>{threadOpen ? "Close thread" : "Threads"}</span>
      </button>
      {#if runAvailable}
        <button type="button" role="menuitemcheckbox" aria-checked={runOpen} class:attention={runWaiting} onclick={() => runAndClose(onToggleRun)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h4v4H5zM15 14h4v4h-4zM9 8h4a2 2 0 0 1 2 2v6" /></svg>
          <span>{runOpen ? "Close workflow run" : "Workflow run"}</span>
          {#if runWaiting}<small>needs you</small>{/if}
        </button>
      {/if}
      {#if pinsAvailable}
        <button type="button" role="menuitemcheckbox" aria-checked={pinnedOpen} onclick={() => runAndClose(onPinnedItems)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 4 6 6-4 4v5l-2 2-5-5-4 4-1-1 4-4-5-5 2-2h5l4-4Z" /></svg>
          <span>Pinned items</span>
        </button>
      {/if}
      {#if channelNotifPreference}
        <button
          type="button"
          role="menuitem"
          aria-busy={channelNotifSaving}
          disabled={channelNotifSaving}
          onclick={onToggleChannelNotifications}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            {#if channelNotifPreference === "muted"}<path d="M3 3l18 18" />{/if}
          </svg>
          <span>Notifications</span>
          <small>{notifLabel}</small>
        </button>
      {/if}
      {#if channelSettingsAvailable}
        <button type="button" role="menuitem" onclick={() => runAndClose(onOpenChannelSettings)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4" />
          </svg>
          <span>Channel settings</span>
        </button>
      {/if}
      {#if externalHref}
        <a href={externalHref} target="_blank" rel="noopener" role="menuitem" onclick={() => close()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6m0-6-9 9m7 0v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></svg>
          <span>Open external channel</span>
        </a>
      {/if}

      <hr />

      <button type="button" role="menuitem" onclick={() => setColorMode(targetMode)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {#if targetMode === "dark"}
            <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.7 6.7 0 0 0 21 12.8Z" />
          {:else}
            <circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
          {/if}
        </svg>
        <span>{targetMode === "dark" ? "Dark mode" : "Light mode"}</span>
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={doubled} onclick={() => setAvatarSize(doubled ? "regular" : "double")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.25" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>
        <span>Large avatars</span>
        <span class="topbar-menu-switch" aria-hidden="true"></span>
      </button>
      <div class="topbar-menu-scale" role="group" aria-label="Interface scale">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3" /></svg>
        <span>Scale</span>
        <button
          type="button"
          role="menuitem"
          aria-label="Decrease interface scale"
          disabled={$interfaceScale <= MIN_INTERFACE_SCALE + 0.001}
          onclick={() => setInterfaceScale($interfaceScale - INTERFACE_SCALE_STEP)}>−</button
        >
        <output aria-live="polite">{scalePercent}%</output>
        <button
          type="button"
          role="menuitem"
          aria-label="Increase interface scale"
          disabled={$interfaceScale >= MAX_INTERFACE_SCALE - 0.001}
          onclick={() => setInterfaceScale($interfaceScale + INTERFACE_SCALE_STEP)}>+</button
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .topbar-menu {
    position: relative;
  }

  .topbar-menu-trigger svg {
    fill: currentColor;
  }

  .topbar-menu-panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    width: min(270px, calc(100vw - 24px));
    padding: 6px;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--key-edge, none), var(--shadow);
    transform-origin: top right;
    animation: topbar-menu-in 0.12s ease-out;
  }

  @keyframes topbar-menu-in {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.97);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .topbar-menu-panel {
      animation: none;
    }
  }

  /* Rows override the top bar's 32px keycap buttons. */
  .topbar-menu-panel > button,
  .topbar-menu-panel > a,
  .topbar-menu-scale {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    height: auto;
    min-height: 44px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    box-shadow: none;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    text-align: left;
    text-decoration: none;
    place-items: initial;
    transform: none;
  }

  .topbar-menu-panel > button:hover,
  .topbar-menu-panel > a:hover,
  .topbar-menu-panel > button:focus-visible,
  .topbar-menu-panel > a:focus-visible {
    outline: 0;
    background: var(--hover-strong);
    border-color: transparent;
    color: var(--text-strong);
  }

  .topbar-menu-panel > button[aria-checked="true"] {
    color: var(--accent);
  }

  .topbar-menu-panel > button:disabled {
    opacity: 0.55;
  }

  .topbar-menu-panel svg {
    flex: 0 0 18px;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--muted);
  }

  .topbar-menu-panel > button[aria-checked="true"] svg,
  .topbar-menu-panel > button.attention svg {
    color: var(--accent);
  }

  .topbar-menu-panel span {
    flex: 1 1 auto;
    min-width: 0;
  }

  .topbar-menu-panel small {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .topbar-menu-panel > button.attention small {
    color: var(--accent);
  }

  .topbar-menu-panel hr {
    width: 100%;
    margin: 6px 0;
    border: 0;
    border-top: 1px solid var(--line);
  }

  .topbar-menu-switch {
    flex: 0 0 34px !important;
    position: relative;
    width: 34px;
    height: 20px;
    border-radius: 999px;
    background: var(--panel-3);
    border: 1px solid var(--line-strong);
    transition: background 120ms ease;
  }

  .topbar-menu-switch::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--muted);
    transition:
      transform 140ms ease,
      background 120ms ease;
  }

  [aria-checked="true"] > .topbar-menu-switch {
    background: var(--accent-soft);
    border-color: var(--accent);
  }

  [aria-checked="true"] > .topbar-menu-switch::after {
    transform: translateX(14px);
    background: var(--accent);
  }

  .topbar-menu-scale {
    cursor: default;
  }

  .topbar-menu-scale button {
    display: grid;
    place-items: center;
    flex: 0 0 34px;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--panel-2);
    box-shadow: none;
    color: var(--text);
    font-size: 18px;
    line-height: 1;
  }

  .topbar-menu-scale button:disabled {
    opacity: 0.4;
  }

  .topbar-menu-scale output {
    min-width: 44px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
</style>
