<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { api, readableAPIError } from "../../lib/api";
  import { newNonce } from "../../lib/chat/messages";
  import { PI_EFFORTS, isCurrentPiModel, loadPiModels, piCommandPayload, piControlCommand, supportsPiFast } from "../../lib/pi-model-controls";
  import type { BotRuntimeStatus, BotRuntimeStatusTarget, WorkspaceBotCommand } from "../../lib/types";

  type Props = { target: BotRuntimeStatusTarget; update?: BotRuntimeStatus | null };
  let { target, update = null }: Props = $props();

  let status = $state<BotRuntimeStatus | null>(null);
  let loaded = $state(false);
  let requestSerial = 0;
  let destroyed = false;
  let targetKey = $derived(`${target.kind}:${target.id}:${target.botUserID}`);
  let requestedKey = "";
  let models = $state(loadPiModels());
  let menu = $state<"model" | "thinking" | null>(null);
  let menuElement: HTMLDivElement;
  let trigger: HTMLButtonElement | null = null;
  let menuLeft = $state(0);
  let menuBottom = $state(0);
  let busy = $state(false);
  let error = $state("");
  let now = $state(Date.now());

  function closeMenu(restoreFocus = false) {
    menuElement?.hidePopover();
    menu = null;
    if (restoreFocus) trigger?.focus();
  }

  async function openMenu(kind: "model" | "thinking", event: MouseEvent) {
    if (menu === kind) { closeMenu(); return; }
    closeMenu();
    models = loadPiModels();
    trigger = event.currentTarget as HTMLButtonElement;
    const rect = trigger.getBoundingClientRect();
    menuLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 288));
    menuBottom = window.innerHeight - rect.top + 8;
    menu = kind;
    await tick();
    menuElement.showPopover();
    menuElement.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    if (!menuElement.contains(document.activeElement)) menuElement.querySelector<HTMLButtonElement>("button")?.focus();
  }

  function menuKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); closeMenu(true); return; }
    if (event.key === "Tab") { closeMenu(true); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menuElement.querySelectorAll<HTMLButtonElement>("button")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
      (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  async function sendControl(control: "model" | "thinking" | "fast", value = "") {
    closeMenu(true);
    if (!status || busy || !fresh) return;
    const body = piControlCommand(status, control, value);
    if (!body) return;
    const key = targetKey;
    const previousFastMode = status.fast_mode;
    const destination = { ...target };
    const workspace = status.workspace_id;
    busy = true;
    error = "";
    try {
      const commands = destination.kind === "channels"
        ? (await api<{ bot_commands: WorkspaceBotCommand[] }>(`/api/workspaces/${encodeURIComponent(workspace)}/bot-commands`)).bot_commands
        : [];
      if (key !== targetKey) return;
      await api(`/api/${destination.kind}/${encodeURIComponent(destination.id)}/messages`, {
        method: "POST",
        body: JSON.stringify(piCommandPayload(destination, commands, body, newNonce())),
      });
      // Message acceptance precedes Pi's status report. Don't allow a second
      // toggle against an old snapshot while the first command is in flight.
      for (let attempt = 0; attempt < 15; attempt++) {
        if (destroyed || key !== targetKey) return;
        await refresh(key);
        if (destroyed || key !== targetKey) return;
        if (status && (control === "fast"
          ? status.fast_mode !== null && status.fast_mode !== previousFastMode
          : piControlCommand(status, control, value) === null)) return;
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
      if (key === targetKey) error = "command sent, but Pi hasn't confirmed the change yet.";
    } catch (err) {
      if (key === targetKey) error = readableAPIError(err, "couldn't send the Pi command.");
    } finally {
      if (key === targetKey) busy = false;
    }
  }

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
    busy = false;
    error = "";
    closeMenu();
    void refresh(key);
  });

  $effect(() => {
    if (!update || !loaded) return;
    if (update.bot_user_id !== target.botUserID ||
      (target.kind === "channels" ? update.channel_id : update.direct_conversation_id) !== target.id) return;
    ++requestSerial;
    status = update;
  });

  onMount(() => {
    const changed = () => { models = loadPiModels(); };
    window.addEventListener("pi-models-changed", changed);
    return () => window.removeEventListener("pi-models-changed", changed);
  });

  const interval = setInterval(() => void refresh(targetKey), 30_000);
  const clock = setInterval(() => { now = Date.now(); }, 1_000);
  onDestroy(() => { destroyed = true; ++requestSerial; clearInterval(interval); clearInterval(clock); });

  let fresh = $derived(Boolean(status && Date.parse(status.expires_at) > now));
  let modelLabel = $derived(status ? models.find(model => isCurrentPiModel(status!, model.id))?.label ?? status.model_id : "");
</script>

{#if loaded && fresh && status}
  <div class="bot-runtime-status" aria-label="Bot runtime status" aria-live="polite">
    {#if status.runtime === "pi"}
      <button type="button" class="bot-runtime-status__value" title={`${status.model_provider}/${status.model_id}`} aria-label={`model: ${modelLabel}`} aria-haspopup="menu" aria-expanded={menu === "model"} disabled={busy} onclick={(event) => openMenu("model", event)}>{modelLabel}</button>
      <span class="bot-runtime-status__separator" aria-hidden="true">•</span>
      <button type="button" class="bot-runtime-status__value" aria-label={`effort: ${status.reasoning}`} aria-haspopup="menu" aria-expanded={menu === "thinking"} disabled={busy} onclick={(event) => openMenu("thinking", event)}>{status.reasoning}</button>
      {#if supportsPiFast(status)}
        <span class="bot-runtime-status__separator" aria-hidden="true">•</span>
        <button type="button" class="bot-runtime-status__value" class:is-fast={status.fast_mode === true} aria-label="fast mode" aria-pressed={status.fast_mode === true} disabled={busy} onclick={() => sendControl("fast")}>{status.fast_mode === true ? "fast" : "normal"}</button>
      {/if}
    {:else}
      <span class="bot-runtime-status__value" title={`${status.model_provider}/${status.model_id}`}>{status.model_id}</span>
      <span class="bot-runtime-status__separator" aria-hidden="true">•</span>
      <span class="bot-runtime-status__value">{status.reasoning}</span>
      {#if status.fast_mode === true}
        <span class="bot-runtime-status__separator" aria-hidden="true">•</span>
        <em>fast</em>
      {/if}
    {/if}
    {#if error}<span class="control-error" role="alert" title={error}>{error}</span>{/if}
  </div>
{/if}

<svelte:window onresize={() => closeMenu()} onstorage={() => models = loadPiModels()} />

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div bind:this={menuElement} class="runtime-menu" popover="auto" role="menu" aria-label={menu === "model" ? "Pi model" : "Pi effort"} style:left={`${menuLeft}px`} style:bottom={`${menuBottom}px`} onkeydown={menuKeydown} ontoggle={(event) => { if (event.newState === "closed") menu = null; }}>
  {#if menu === "model" && status}
    {#each models as model (model.id)}
      <button type="button" role="menuitemradio" aria-checked={isCurrentPiModel(status, model.id)} onclick={() => sendControl("model", model.id)}><span>{model.label}</span><small>{model.id}</small></button>
    {/each}
  {:else if menu === "thinking" && status}
    {#each PI_EFFORTS as effort}
      <button type="button" role="menuitemradio" aria-checked={status.reasoning === effort} onclick={() => sendControl("thinking", effort)}>{effort}</button>
    {/each}
  {/if}
</div>

<style>
  button { border: 0; background: transparent; color: inherit; font: inherit; padding: 4px 0; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
  button:hover, button.is-fast { color: var(--accent); }
  button:disabled { opacity: 0.5; cursor: wait; }
  .control-error { position: absolute; bottom: 100%; right: 0; white-space: normal; padding: 8px; color: var(--danger); background: var(--panel); border: 1px solid var(--line-strong); border-radius: 8px; z-index: 5; }
  .runtime-menu { position: fixed; top: auto; right: auto; margin: 0; width: 272px; max-width: calc(100vw - 32px); max-height: 50vh; overflow: auto; padding: 4px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--panel); color: var(--text-strong); }
  .runtime-menu button { display: flex; flex-direction: column; align-items: start; width: 100%; text-align: left; padding: 8px; border-radius: 4px; }
  .runtime-menu button:hover, .runtime-menu button[aria-checked="true"] { background: var(--bg); color: var(--accent); }
  .runtime-menu small { font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }

  .bot-runtime-status {
    position: relative;
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
