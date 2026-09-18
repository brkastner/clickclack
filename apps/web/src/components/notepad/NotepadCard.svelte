<script lang="ts">
 import { markdown } from "../../lib/format";
 import type { NotepadSnapshot } from "../../lib/chat/notepad";
 let { id, snapshot, className = "" }: { id: string; snapshot: NotepadSnapshot; className?: string } = $props();
 const messages = {
  loading: "Loading agent notepad…", unmapped: "No agent notepad is connected to this conversation.", unsupported: "This agent does not support notepads.", denied: "You do not have access to this agent notepad.", unavailable: "The agent notepad is unavailable.", disconnected: "Disconnected from the agent notepad. Reconnecting…", ready: "No notepad yet.",
 };
</script>

<section {id} class={`agent-notepad__card ${className}`} aria-label="Agent notepad" aria-busy={snapshot.state === "loading"} tabindex="-1">
 <header class="agent-notepad__header"><h2>Agent notepad</h2><span>Read-only</span></header>
 <div class="notepad-body">
  {#if snapshot.state === "ready" && snapshot.card}
   {#if snapshot.card.markdown !== undefined}<div class="markdown">{@html markdown(snapshot.card.markdown)}</div>{/if}
   {#if snapshot.card.steps?.length}<ol aria-label="Progress steps" class="notepad-steps">{#each snapshot.card.steps as step}<li data-status={step.status} aria-label={`${step.status === "completed" ? "Completed" : step.status === "in_progress" ? "In progress" : "Pending"}: ${step.step}`}><span class="step-icon" aria-hidden="true">{step.status === "completed" ? "✓" : step.status === "in_progress" ? "•" : "○"}</span><span>{step.step}</span></li>{/each}</ol>{/if}
   <p class="notepad-updated">Updated <time datetime={new Date(snapshot.card.updatedAt).toISOString()}>{new Date(snapshot.card.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></p>
  {:else}<p class="notepad-status" role="status">{messages[snapshot.state]}</p>{/if}
 </div>
</section>

<style>
 .agent-notepad__card { overflow: hidden; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--panel); box-shadow: var(--shadow); color: var(--text); }
 .agent-notepad__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 14px 10px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--accent) 5%, var(--panel)); }
 .agent-notepad__header h2 { margin: 0; color: var(--text-strong); font-size: 14px; line-height: 1.25; text-wrap: balance; }
 .agent-notepad__header > span { flex: 0 0 auto; padding: 2px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 10px; font-weight: 600; }
 .notepad-body { max-height: min(calc(30rem - 48px), calc(58dvh - 48px)); overflow: auto; padding: 12px 14px; overflow-wrap: anywhere; }
 .notepad-body :global(img) { max-width: 100%; } .notepad-body :global(p) { margin: 0 0 10px; line-height: 1.5; text-wrap: pretty; } .notepad-body :global(h1), .notepad-body :global(h2), .notepad-body :global(h3), .notepad-body :global(h4) { margin: 16px 0 8px; color: var(--text-strong); line-height: 1.25; } .notepad-body :global(h1) { font-size: 20px; } .notepad-body :global(h2) { font-size: 17px; } .notepad-body :global(h3), .notepad-body :global(h4) { font-size: 14px; } .notepad-body :global(ul), .notepad-body :global(ol) { margin: 8px 0 12px; padding-left: 20px; } .notepad-body :global(li) { margin: 4px 0; line-height: 1.45; } .notepad-body :global(code) { padding: 1px 4px; border-radius: 4px; background: var(--panel-2); font-family: var(--font-mono, ui-monospace, monospace); font-size: .9em; } .notepad-body :global(pre) { margin: 10px 0; overflow: auto; padding: 10px; border-radius: 6px; background: var(--panel-2); } .notepad-body :global(pre code) { padding: 0; background: transparent; }
 .notepad-body .notepad-steps { display: grid; gap: 5px; margin: 12px 0; padding: 0; list-style: none; } .notepad-body .notepad-steps li { display: grid; grid-template-columns: 18px minmax(0,1fr); align-items: start; gap: 7px; margin: 0; padding: 7px 8px; border: 1px solid transparent; border-radius: 6px; line-height: 1.4; } .step-icon { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--panel-2); color: var(--muted); font-size: 12px; font-weight: 700; } .notepad-steps li[data-status="completed"] { color: var(--muted); } .notepad-steps li[data-status="completed"] .step-icon { background: color-mix(in srgb,var(--success) 14%,transparent); color: var(--success); } .notepad-steps li[data-status="in_progress"] { border-color: color-mix(in srgb,var(--accent) 34%,var(--line)); background: color-mix(in srgb,var(--accent) 9%,transparent); color: var(--text-strong); } .notepad-steps li[data-status="in_progress"] .step-icon { background: var(--accent); color: var(--accent-contrast); } .notepad-updated { margin: 12px 0 0; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; } .notepad-status { margin: 2px 0; color: var(--muted); line-height: 1.45; }
</style>
