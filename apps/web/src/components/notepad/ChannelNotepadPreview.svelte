<script lang="ts">
 import { onDestroy, tick, untrack } from "svelte";
 import { apiWithTimeout, apiURL } from "../../lib/api";
 import { createNotepadAvailability } from "../../lib/chat/notepad-availability";
 import { placeBesideAnchor } from "../../lib/anchored-placement";
 import { interfaceScale } from "../../lib/interface-scale";
 import { watchNotepad, type NotepadSnapshot } from "../../lib/chat/notepad";
 import NotepadCard from "./NotepadCard.svelte";
 type Target = { workspaceID: string; channelID: string; anchor: HTMLElement } | null;
 let { target }: { target: Target } = $props();
 let active = $state<Target>(null);
 let available = $state(false);
 let snapshot = $state<NotepadSnapshot>({ state: "loading", card: null });
 let previewElement = $state<HTMLDivElement>();
 let closeTimer: ReturnType<typeof setTimeout> | undefined;
 const availability = createNotepadAvailability({ read: (path, signal) => apiWithTimeout<{ available: boolean }>(path, { signal }) }, (value) => available = value);
 const path = $derived(active ? `/api/channels/${encodeURIComponent(active.channelID)}/notepad` : "");
 const availabilityPath = $derived(active ? `${path}/availability` : null);
 let position = $state({ left: 8, top: 8 });
 function cancelClose() { clearTimeout(closeTimer); closeTimer = undefined; }
 function closeSoon() { cancelClose(); closeTimer = setTimeout(() => { active = null; closeTimer = undefined; }, 160); }
 function place() {
  if (!active || !previewElement) return;
  position = placeBesideAnchor({
   anchor: active.anchor.getBoundingClientRect(),
   overlay: previewElement.getBoundingClientRect(),
   viewport: { width: window.innerWidth, height: window.innerHeight },
   scale: $interfaceScale,
  });
 }
 function escape(event: KeyboardEvent) { if (event.key === "Escape" && active) { cancelClose(); active = null; event.preventDefault(); } }
 // This effect intentionally tracks the parent target only. Reading `active`
 // untracked prevents internal closes (Escape/timer) from restoring a stale target.
 $effect(() => {
  const next = target;
  const current = untrack(() => active);
  cancelClose();
  if (!next) { if (current) closeSoon(); return; }
  if (!current || current.workspaceID !== next.workspaceID || current.channelID !== next.channelID) {
   active = next; available = false; snapshot = { state: "loading", card: null };
  } else active = next;
 });
 $effect(() => { availability.select(availabilityPath); return () => availability.dispose(); });
 $effect(() => { if (!available || !path) return; return watchNotepad(path, { read: (target, signal) => apiWithTimeout<NotepadSnapshot>(target, { signal }), connect: (target) => { const url = new URL(apiURL(target), window.location.href); url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; return new WebSocket(url); } }, (value) => snapshot = value); });
 $effect(() => {
  if (!active || !available || !previewElement) return;
  void $interfaceScale;
  const update = () => place();
  const resize = new ResizeObserver(update);
  resize.observe(previewElement);
  window.addEventListener("resize", update);
  window.addEventListener("scroll", update, true);
  void tick().then(update);
  return () => { resize.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
 });
 onDestroy(() => cancelClose());
</script>
<svelte:window onkeydown={escape} />
{#if active && available}
 <div bind:this={previewElement} class="channel-notepad-preview" role="group" aria-label="Agent notepad preview" style={`left:${position.left}px;top:${position.top}px`} onpointerenter={cancelClose} onpointerleave={closeSoon} onfocusin={cancelClose} onfocusout={closeSoon}>
  <NotepadCard id={`agent-notepad-preview-${active.workspaceID}-${active.channelID}`} {snapshot} />
 </div>
{/if}
<style>
 .channel-notepad-preview { position:fixed; z-index:30; width:min(27rem,calc(var(--app-vw) - 16px)); max-height:calc(var(--app-vh) - 16px); } .channel-notepad-preview :global(.agent-notepad__card) { max-height:calc(var(--app-vh) - 16px); } @media (prefers-reduced-motion:no-preference) { .channel-notepad-preview { animation:notepad-preview-in 140ms ease-out; } @keyframes notepad-preview-in { from { opacity:0; transform:translateX(-4px); } to { opacity:1; transform:translateX(0); } } }
</style>
