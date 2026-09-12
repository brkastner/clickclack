<script lang="ts">
 import { apiWithTimeout, apiURL } from "../../lib/api";
 import { markdown } from "../../lib/format";
 import { watchNotepad, type NotepadSnapshot, type NotepadDependencies } from "../../lib/chat/notepad";
 let { path, dependencies }: { path: string; dependencies?: NotepadDependencies } = $props();
 let open = $state(false);
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

<details class="agent-notepad" bind:open>
 <summary>Agent notepad <span>Read-only</span></summary>
 {#if open}
  <div class="notepad-body" aria-label="Agent notepad content" aria-busy={snapshot.state === "loading"}>
   {#if snapshot.state === "ready" && snapshot.card}
    {#if snapshot.card.markdown !== undefined}
     <div class="markdown">{@html markdown(snapshot.card.markdown)}</div>
    {/if}
    {#if snapshot.card.steps?.length}
     <ol aria-label="Progress steps">
      {#each snapshot.card.steps as step}
       <li data-status={step.status}>
        <span class="step-status">{step.status === "completed" ? "Completed" : step.status === "in_progress" ? "In progress" : "Pending"}</span>
        <span>{step.step}</span>
       </li>
      {/each}
     </ol>
    {/if}
    <small>Updated <time datetime={new Date(snapshot.card.updatedAt).toISOString()}>{new Date(snapshot.card.updatedAt).toLocaleString()}</time></small>
   {:else}
    <p role="status">{messages[snapshot.state]}</p>
   {/if}
  </div>
 {/if}
</details>

<style>
 .agent-notepad { flex: 0 0 auto; border-bottom: 1px solid var(--border); background: var(--panel); color: var(--text); min-width: 0; position: relative; z-index: 1; }
 summary { cursor: pointer; padding: 0.55rem 1rem; font-weight: 600; }
 summary span { font-size: 0.75rem; font-weight: 400; opacity: 0.65; margin-left: 0.5rem; }
 summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
 .notepad-body { max-height: min(32vh, 22rem); overflow: auto; padding: 0 1rem 0.75rem; overflow-wrap: anywhere; }
 .notepad-body :global(img) { max-width: 100%; }
 .notepad-body :global(pre) { overflow: auto; }
 p { margin: 0.5rem 0; }
 ol { padding-left: 1.5rem; }
 li { margin-block: 0.4rem; }
 .step-status { font-size: 0.75rem; margin-right: 0.5rem; opacity: 0.7; }
 li[data-status="completed"] .step-status { color: var(--accent); }
 small { opacity: 0.65; }
</style>
