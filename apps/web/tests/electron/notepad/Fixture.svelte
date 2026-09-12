<script lang="ts">
 import AgentNotepad from "../../../src/components/notepad/AgentNotepad.svelte";
 import type { NotepadSocket, NotepadSnapshot } from "../../../src/lib/chat/notepad";
 let target = $state("alpha");
 let dark = $state(false);
 let draft = $state("");
 let card: NotepadSnapshot = { state: "ready", card: { markdown: "## Durable notes\n\n**Alpha** is working.\n\n<script>window.NOTEPAD_SCRIPT_RAN=true;\x3C/script><img src=x onerror=\"window.NOTEPAD_SCRIPT_RAN=true\"><a href=\"javascript:window.NOTEPAD_SCRIPT_RAN=true\">unsafe link</a>", revision: 2, updatedAt: 1700000000000, steps: [{ step: "Inspect source", status: "completed" }, { step: "Verify adapter", status: "in_progress" }, { step: "Review evidence", status: "pending" }] } };
 let sockets = new Set<NotepadSocket>();
 const notify = () => { for (const socket of sockets) socket.onmessage?.call(socket as WebSocket, new MessageEvent("message", { data: JSON.stringify({ type: "notepad.changed", state: "ready" }) })); };
 const dependencies = {
  retryMs: 50,
  read: async () => card,
  connect: () => {
   const socket: NotepadSocket = { onmessage: null, onclose: null, onerror: null, close: () => { sockets.delete(socket); } };
   sockets.add(socket); setTimeout(notify, 5); return socket;
  },
 };
 function clearCard() { card = { state: "ready", card: null }; notify(); }
 function replaceCard() { card = { state: "ready", card: { markdown: "## Updated notes\n\nMarkdown-only replacement.", revision: 1, updatedAt: 1700000001000 } }; notify(); }
 function disconnect() { for (const socket of [...sockets]) socket.onerror?.call(socket as WebSocket, new Event("error")); }
</script>
<div class:dark class="fixture">
 <header><h1>ClickClack · {target}</h1><p>Isolated Electron fixture, no live session</p></header>
 <nav>
  <button onclick={() => { target = target === "alpha" ? "beta" : "alpha"; }}>Switch conversation</button>
  <button onclick={() => { dark = !dark; }}>Toggle theme</button>
  <button onclick={clearCard}>Remote clear</button>
  <button onclick={replaceCard}>Remote replace</button>
  <button onclick={disconnect}>Disconnect</button>
 </nav>
 <main>
  {#key target}<AgentNotepad path={`/fixture/${target}`} {dependencies}/>{/key}
  <article><p>Conversation messages remain visible below the notepad.</p><p>The panel scrolls independently without covering the composer.</p></article>
  <textarea aria-label="Composer draft" bind:value={draft} placeholder="Write a message…"></textarea>
 </main>
</div>
<style>
 :global(body) { margin:0; font:15px system-ui; }
 .fixture { --panel:#fffaf3; --text:#302d41; --border:#d6cfc5; --accent:#286983; background:#faf4ed; color:var(--text); height:100vh; display:flex; flex-direction:column; }
 .fixture.dark { --panel:#141926; --text:#dbe2ec; --border:#394052; --accent:#41c6ff; background:#101420; }
 header,nav { padding:0.5rem 1rem; } h1 { font-size:1.25rem; } nav { display:flex; flex-wrap:wrap; gap:0.5rem; }
 button { background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:5px; padding:0.5rem; }
 main { display:flex; flex-direction:column; min-height:0; flex:1; } article { padding:1rem; flex:1; overflow:auto; }
 textarea { margin:1rem; min-height:5rem; background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:0.6rem; }
</style>
