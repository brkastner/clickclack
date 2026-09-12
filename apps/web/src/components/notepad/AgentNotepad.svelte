<script lang="ts">
 import { tick } from "svelte";
 import { apiWithTimeout, apiURL } from "../../lib/api";
 import { markdown } from "../../lib/format";
 import { watchNotepad, type NotepadSnapshot, type NotepadDependencies } from "../../lib/chat/notepad";
 let { path, dependencies }: { path: string; dependencies?: NotepadDependencies } = $props();
 let open = $state(false);
 let trigger = $state<HTMLButtonElement>();
 let snapshot = $state<NotepadSnapshot>({ state: "loading", card: null });
 const messages = {
  loading: "Loading agent notepad…",
  unmapped: "No OpenClaw notepad is mapped to this conversation. Pi-only conversations do not have an OpenClaw notepad.",
  unsupported: "This OpenClaw gateway does not support agent notepads.",
  denied: "You do not have access to this agent notepad.",
  unavailable: "The agent notepad is unavailable.",
  disconnected: "Disconnected from the agent notepad. Reconnecting…",
  ready: "No notepad yet.",
 };
 function close() {
  open = false;
  void tick().then(() => trigger?.focus());
 }
 function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && open) {
   event.preventDefault();
   close();
  }
 }
 $effect(() => {
  if (!open || !path) return;
  snapshot = { state: "loading", card: null };
  return watchNotepad(path, dependencies ?? {
   read: (target, signal) => apiWithTimeout<NotepadSnapshot>(target, { signal }),
   connect: (target) => {
    const url = new URL(apiURL(target), window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return new WebSocket(url);
   },
  }, (value) => { snapshot = value; });
 });
</script>

<svelte:window onkeydown={handleKeydown} />
<div class="agent-notepad" class:agent-notepad--open={open}>
 <button
  bind:this={trigger}
  type="button"
  class="agent-notepad__trigger"
  aria-expanded={open}
  aria-controls="agent-notepad-card"
  onclick={() => (open = !open)}
 >
  <span class="agent-notepad__icon" aria-hidden="true">✦</span>
  <span>Agent notepad</span>
  <span class="agent-notepad__read-only">Read-only</span>
 </button>
 {#if open}
  <section id="agent-notepad-card" class="agent-notepad__card" aria-label="Agent notepad" aria-busy={snapshot.state === "loading"} tabindex="-1">
   <header class="agent-notepad__header">
    <div>
     <p>Conversation notes</p>
     <h2>Agent notepad</h2>
    </div>
    <span>Read-only</span>
   </header>
   <div class="notepad-body">
    {#if snapshot.state === "ready" && snapshot.card}
     {#if snapshot.card.markdown !== undefined}
      <div class="markdown">{@html markdown(snapshot.card.markdown)}</div>
     {/if}
     {#if snapshot.card.steps?.length}
      <ol aria-label="Progress steps" class="notepad-steps">
       {#each snapshot.card.steps as step}
        <li data-status={step.status} aria-label={`${step.status === "completed" ? "Completed" : step.status === "in_progress" ? "In progress" : "Pending"}: ${step.step}`}>
         <span class="step-icon" aria-hidden="true">{step.status === "completed" ? "✓" : step.status === "in_progress" ? "•" : "○"}</span>
         <span>{step.step}</span>
        </li>
       {/each}
      </ol>
     {/if}
     <p class="notepad-updated">Updated <time datetime={new Date(snapshot.card.updatedAt).toISOString()}>{new Date(snapshot.card.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></p>
    {:else}
     <p class="notepad-status" role="status">{messages[snapshot.state]}</p>
    {/if}
   </div>
  </section>
 {/if}
</div>

<style>
 .agent-notepad { position: absolute; z-index: 3; top: 0; left: 18px; right: 18px; height: 20px; pointer-events: none; text-align: right; }
 .agent-notepad__trigger, .agent-notepad__card { pointer-events: auto; }
 .agent-notepad__card { text-align: left; }
 .agent-notepad__trigger { display: inline-flex; align-items: center; gap: 5px; min-height: 20px; padding: 1px 7px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--muted); font: inherit; font-size: 12px; line-height: 16px; cursor: pointer; white-space: nowrap; }
 .agent-notepad__trigger:hover, .agent-notepad--open .agent-notepad__trigger { border-color: color-mix(in srgb, var(--accent) 22%, var(--line)); background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--text); }
 .agent-notepad__trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
 .agent-notepad__icon { color: var(--accent); font-size: 13px; }
 .agent-notepad__read-only { color: var(--muted-2); font-size: 10px; }
 .agent-notepad__card { position: absolute; right: 0; bottom: 28px; width: min(27rem, 100%); max-height: min(30rem, 58dvh); overflow: hidden; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--panel); box-shadow: var(--shadow); color: var(--text); }
 .agent-notepad__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 14px 10px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--accent) 5%, var(--panel)); }
 .agent-notepad__header p { margin: 0 0 2px; color: var(--muted); font-size: 11px; line-height: 1.25; }
 .agent-notepad__header h2 { margin: 0; color: var(--text-strong); font-size: 14px; line-height: 1.25; text-wrap: balance; }
 .agent-notepad__header > span { flex: 0 0 auto; padding: 2px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 10px; font-weight: 600; }
 .notepad-body { max-height: min(calc(30rem - 62px), calc(58dvh - 62px)); overflow: auto; padding: 12px 14px; overflow-wrap: anywhere; }
 .notepad-body :global(img) { max-width: 100%; }
 .notepad-body :global(p) { margin: 0 0 10px; line-height: 1.5; text-wrap: pretty; }
 .notepad-body :global(h1), .notepad-body :global(h2), .notepad-body :global(h3), .notepad-body :global(h4) { margin: 16px 0 8px; color: var(--text-strong); line-height: 1.25; }
 .notepad-body :global(h1) { font-size: 20px; } .notepad-body :global(h2) { font-size: 17px; } .notepad-body :global(h3), .notepad-body :global(h4) { font-size: 14px; }
 .notepad-body :global(ul), .notepad-body :global(ol) { margin: 8px 0 12px; padding-left: 20px; }
 .notepad-body :global(li) { margin: 4px 0; line-height: 1.45; }
 .notepad-body :global(code) { padding: 1px 4px; border-radius: 4px; background: var(--panel-2); font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.9em; }
 .notepad-body :global(pre) { margin: 10px 0; overflow: auto; padding: 10px; border-radius: 6px; background: var(--panel-2); }
 .notepad-body :global(pre code) { padding: 0; background: transparent; }
 .notepad-body .notepad-steps { display: grid; gap: 5px; margin: 12px 0; padding: 0; list-style: none; }
 .notepad-body .notepad-steps li { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: start; gap: 7px; margin: 0; padding: 7px 8px; border: 1px solid transparent; border-radius: 6px; line-height: 1.4; }
 .step-icon { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--panel-2); color: var(--muted); font-size: 12px; font-weight: 700; }
 .notepad-steps li[data-status="completed"] { color: var(--muted); }
 .notepad-steps li[data-status="completed"] .step-icon { background: color-mix(in srgb, var(--success) 14%, transparent); color: var(--success); }
 .notepad-steps li[data-status="in_progress"] { border-color: color-mix(in srgb, var(--accent) 34%, var(--line)); background: color-mix(in srgb, var(--accent) 9%, transparent); color: var(--text-strong); }
 .notepad-steps li[data-status="in_progress"] .step-icon { background: var(--accent); color: var(--accent-contrast); }
 .notepad-updated { margin: 12px 0 0; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
 .notepad-status { margin: 2px 0; color: var(--muted); line-height: 1.45; }
 @media (max-width: 520px) { .agent-notepad { left: 10px; right: 10px; } .agent-notepad__read-only { display: none; } .agent-notepad__card { width: min(27rem, 100%); max-height: min(26rem, 52dvh); } .notepad-body { max-height: min(calc(26rem - 62px), calc(52dvh - 62px)); } }
 @media (prefers-reduced-motion: no-preference) { .agent-notepad__card { animation: notepad-in 140ms ease-out; } @keyframes notepad-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } } }
</style>
