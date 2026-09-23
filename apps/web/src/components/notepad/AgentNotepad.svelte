<script lang="ts">
 import { tick } from "svelte";
 import { apiWithTimeout, apiURL } from "../../lib/api";
 import { watchNotepad, type NotepadSnapshot, type NotepadDependencies } from "../../lib/chat/notepad";
 import NotepadCard from "./NotepadCard.svelte";
 let { path, dependencies }: { path: string; dependencies?: NotepadDependencies } = $props();
 let open = $state(false); let trigger = $state<HTMLButtonElement>(); let snapshot = $state<NotepadSnapshot>({ state: "loading", card: null });
 function close() { open = false; void tick().then(() => trigger?.focus()); }
 function handleKeydown(event: KeyboardEvent) { if (event.key === "Escape" && open) { event.preventDefault(); close(); } }
 $effect(() => { if (!open || !path) return; snapshot = { state: "loading", card: null }; return watchNotepad(path, dependencies ?? { read: (target, signal) => apiWithTimeout<NotepadSnapshot>(target, { signal }), connect: (target) => { const url = new URL(apiURL(target), window.location.href); url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; return new WebSocket(url); } }, (value) => { snapshot = value; }); });
</script>
<svelte:window onkeydown={handleKeydown} />
<div class="agent-notepad" class:agent-notepad--open={open}>
 <button bind:this={trigger} type="button" class="agent-notepad__trigger" aria-expanded={open} aria-controls="agent-notepad-card" onclick={() => (open = !open)}><span class="agent-notepad__icon" aria-hidden="true">✦</span><span>Agent notepad</span><span class="agent-notepad__read-only">Read-only</span></button>
 {#if open}<NotepadCard id="agent-notepad-card" {snapshot} />{/if}
</div>
<style>
 .agent-notepad { position:absolute; z-index:3; top:0; left:28px; right:28px; height:20px; pointer-events:none; text-align:right; } .agent-notepad__trigger, :global(.agent-notepad__card) { pointer-events:auto; } .agent-notepad__trigger { display:inline-flex; align-items:center; gap:5px; min-height:20px; padding:1px 7px; border:1px solid transparent; border-radius:6px; background:transparent; color:var(--muted); font:inherit; font-size:12px; line-height:16px; cursor:pointer; white-space:nowrap; } .agent-notepad__trigger:hover, .agent-notepad--open .agent-notepad__trigger { border-color:color-mix(in srgb,var(--accent) 22%,var(--line)); background:color-mix(in srgb,var(--accent) 8%,transparent); color:var(--text); } .agent-notepad__trigger:focus-visible { outline:2px solid var(--accent); outline-offset:2px; } .agent-notepad__icon { color:var(--accent); font-size:13px; } .agent-notepad__read-only { color:var(--muted-2); font-size:10px; } :global(.agent-notepad__card) { position:absolute; right:0; bottom:28px; width:min(27rem,100%); max-height:min(30rem,58dvh); text-align:left; }
 @media (max-width:900px) { .agent-notepad { left:calc(18px + var(--safe-area-left)); right:calc(18px + var(--safe-area-right)); } } @media (max-width:520px) { .agent-notepad { left:calc(14px + var(--safe-area-left)); right:calc(14px + var(--safe-area-right)); } .agent-notepad__read-only { display:none; } :global(.agent-notepad__card) { max-height:min(26rem,52dvh); } } @media (prefers-reduced-motion:no-preference) { :global(.agent-notepad__card) { animation:notepad-in 140ms ease-out; } @keyframes notepad-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } } }
</style>
