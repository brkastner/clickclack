<script lang="ts">
 import { tick } from "svelte";
 import { apiWithTimeout, apiURL } from "../../lib/api";
 import { createNotepadAvailability } from "../../lib/chat/notepad-availability";
 import { watchNotepad, type NotepadSnapshot } from "../../lib/chat/notepad";
 import NotepadCard from "./NotepadCard.svelte";
 type Target = { workspaceID: string; channelID: string; anchor: HTMLElement } | null;
 let { target }: { target: Target } = $props();
 let active = $state<Target>(null); let available = $state(false); let snapshot = $state<NotepadSnapshot>({ state: "loading", card: null }); let closeTimer: ReturnType<typeof setTimeout> | undefined;
 const availability = createNotepadAvailability({ read: (path, signal) => apiWithTimeout<{ available: boolean }>(path, { signal }) }, (value) => available = value);
 const path = $derived(active ? `/api/channels/${encodeURIComponent(active.channelID)}/notepad` : "");
 const availabilityPath = $derived(active ? `${path}/availability` : null);
 let position = $state({ left: 8, top: 8 });
 function cancelClose() { clearTimeout(closeTimer); }
 function closeSoon() { clearTimeout(closeTimer); closeTimer = setTimeout(() => { active = null; }, 160); }
 function place() { if (!active) return; const rect = active.anchor.getBoundingClientRect(); const width = Math.min(432, window.innerWidth - 16); position = { left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - width - 8)), top: Math.max(8, Math.min(rect.top, window.innerHeight - 80)) }; }
 function escape(event: KeyboardEvent) { if (event.key === "Escape" && active) { active = null; event.preventDefault(); } }
 $effect(() => { const next = target; cancelClose(); if (!next) { closeSoon(); return; } if (!active || active.workspaceID !== next.workspaceID || active.channelID !== next.channelID) { active = next; available = false; snapshot = { state: "loading", card: null }; } else active = next; place(); });
 $effect(() => { availability.select(availabilityPath); return () => availability.dispose(); });
 $effect(() => { if (!available || !path) return; return watchNotepad(path, { read: (target, signal) => apiWithTimeout<NotepadSnapshot>(target, { signal }), connect: (target) => { const url = new URL(apiURL(target), window.location.href); url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; return new WebSocket(url); } }, (value) => snapshot = value); });
 $effect(() => { if (!active) return; const update = () => place(); window.addEventListener("resize", update); window.addEventListener("scroll", update, true); void tick().then(place); return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); }; });
</script>
<svelte:window onkeydown={escape} />
{#if active && available}
 <div class="channel-notepad-preview" role="group" aria-label="Agent notepad preview" style={`left:${position.left}px;top:${position.top}px`} onpointerenter={cancelClose} onpointerleave={closeSoon} onfocusin={cancelClose} onfocusout={closeSoon}>
  <NotepadCard id={`agent-notepad-preview-${active.workspaceID}-${active.channelID}`} {snapshot} />
 </div>
{/if}
<style>
 .channel-notepad-preview { position:fixed; z-index:30; width:min(27rem,calc(100vw - 16px)); max-height:calc(100dvh - 16px); } .channel-notepad-preview :global(.agent-notepad__card) { max-height:calc(100dvh - 16px); } @media (prefers-reduced-motion:no-preference) { .channel-notepad-preview { animation:notepad-preview-in 140ms ease-out; } @keyframes notepad-preview-in { from { opacity:0; transform:translateX(-4px); } to { opacity:1; transform:translateX(0); } } }
</style>
