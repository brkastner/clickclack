<script lang="ts">
  import { onMount, tick } from "svelte";
  import { goto } from "$app/navigation";
  import { sourceConversationID } from "../../lib/chat/message-source-navigation";
  import { api } from "../../lib/api";
  import type { Channel, DirectConversation, Message, User, Workspace } from "../../lib/types";
  import { listAllWorkspaceMembers } from "../../lib/workspace-members";
  import { connectRealtime } from "../../lib/realtime.svelte";
  import { OutputGallerySession, outputBots, boundOutputBot, outputSourceKey, galleryReturn, rememberGallery, revealGallerySource, clearGalleryReturn, type OutputPage } from "../../lib/output-gallery";
  import OutputCard from "./OutputCard.svelte";
  let { workspaceID }: { workspaceID: string } = $props();
  let workspace = $state<Workspace>();
  let user = $state<User>();
  let bots = $state<User[]>([]);
  let sourceID = $state("");
  let session = $state<OutputGallerySession>();
  let labels = $state<Record<string, string>>({});
  let revision = $state(0);
  let initializing = $state(true);
  let validating = $state(false);
  let error = $state("");
  let scroll: HTMLElement | null;
  let controller = new AbortController();
  let navigation = 0;
  let sourceAbort: AbortController | undefined;
  let pendingRevalidation = false;
  let alive = true;
  const outputs = $derived.by(() => { void revision; return session?.outputs ?? []; });
  const busy = $derived.by(() => { void revision; return validating || session?.busy; });
  const pageError = $derived.by(() => { void revision; return session?.error; });
  const more = $derived.by(() => { void revision; return session?.nextCursor; });
  async function run(action: () => Promise<unknown>) { const work = action(); revision++; await work; revision++; }
  async function choose(id: string) {
    navigation++;
    sourceAbort?.abort();
    error = "";
    session?.cancel();
    clearGalleryReturn();
    sourceID = boundOutputBot(bots, id)?.id ?? "";
    if (!workspace || !user) return;
    try { localStorage.setItem(outputSourceKey(user.id, workspace.id), sourceID); } catch { /* In-memory selection still works. */ }
    if (!sourceID) { session = undefined; return; }
    const author = sourceID;
    const scope = workspace.id;
    session = new OutputGallerySession((cursor, limit, signal) => {
      const params = new URLSearchParams({ author_id: author, limit: String(limit) });
      if (cursor) params.set("cursor", cursor);
      return api<OutputPage>(`/api/workspaces/${scope}/outputs?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
    });
    rememberGallery({ userID: user.id, workspaceID: scope, sourceID: author, session });
    await run(() => session!.load());
  }
  function capturePosition(preferredID = "") {
    if (!session || !scroll) return;
    const bounds = scroll.getBoundingClientRect();
    const cards = Array.from(scroll.querySelectorAll<HTMLElement>("[data-output-id]"));
    const anchor = cards.find((card) => card.dataset.outputId === preferredID) ??
      cards.find((card) => card.getBoundingClientRect().bottom > bounds.top);
    session.scrollTop = scroll.scrollTop;
    session.anchorID = anchor?.dataset.outputId ?? "";
    session.anchorOffset = anchor ? anchor.getBoundingClientRect().top - bounds.top : 0;
  }
  function restorePosition() {
    if (!session || !scroll) return;
    scroll.scrollTop = session.scrollTop;
    const anchor = Array.from(scroll.querySelectorAll<HTMLElement>("[data-output-id]"))
      .find((card) => card.dataset.outputId === session!.anchorID);
    if (anchor) scroll.scrollTop += anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top - session.anchorOffset;
  }
  async function revalidate() {
    if (!session || initializing) return;
    if (validating) { pendingRevalidation = true; return; }
    capturePosition();
    validating = true;
    try {
      const members = await listAllWorkspaceMembers({ workspaceID: workspace!.id, role: "bot", signal: controller.signal });
      if (!alive) return;
      bots = outputBots(members.map((member) => member.user));
      if (!boundOutputBot(bots, sourceID)) await choose("");
      else await run(() => session!.revalidate());
    } catch {
      session?.cancel();
      if (session) { session.pages = []; session.cursors = []; }
      error = "Could not verify source access. Reload to retry.";
    }
    validating = false;
    await tick();
    restorePosition();
    if (pendingRevalidation) { pendingRevalidation = false; void revalidate(); }
  }
  async function open(message: Message) {
    const serial = ++navigation;
    sourceAbort?.abort();
    sourceAbort = new AbortController();
    error = "";
    try {
      const { message: source } = await api<{ message: Message }>(`/api/messages/${encodeURIComponent(message.id)}`, { signal: AbortSignal.any([sourceAbort.signal, controller.signal, AbortSignal.timeout(30_000)]) });
      if (!alive || serial !== navigation || source.workspace_id !== workspace?.id || source.deleted_at) throw new Error("Source unavailable");
      const target = sourceConversationID(source);
      if (!target || !session) throw new Error("Source unavailable");
      session.selectedID = message.id; capturePosition(message.id);
      revealGallerySource(source);
      await goto(`/app/${encodeURIComponent(workspace.id)}/${encodeURIComponent(target)}`);
    } catch { if (alive && serial === navigation) error = "This source is unavailable or access has changed. Refresh the gallery."; }
  }
  async function latest() {
    const owner = session;
    const serial = navigation;
    if (!owner) return;
    let message: Message | undefined;
    await run(async () => { message = await owner.latest(); });
    if (!alive || owner !== session || serial !== navigation) return;
    if (message) await open(message);
    else if (!owner.error) error = "No responses are available.";
  }
  onMount(() => {
    let realtime: ReturnType<typeof connectRealtime> | undefined;
    void (async () => {
      try {
        const [me, ws] = await Promise.all([api<{ user: User }>("/api/me", { signal: controller.signal }), api<{ workspaces: Workspace[] }>("/api/workspaces", { signal: controller.signal })]);
        if (!alive) return;
        user = me.user; workspace = ws.workspaces.find((w) => w.id === workspaceID || w.route_id === workspaceID);
        if (!workspace) throw new Error("Workspace unavailable");
        const scope = workspace.id;
        const [members, channels, directs] = await Promise.all([
          listAllWorkspaceMembers({ workspaceID: scope, role: "bot", signal: controller.signal }),
          api<{ channels: Channel[] }>(`/api/workspaces/${scope}/channels`, { signal: controller.signal }),
          api<{ conversations: DirectConversation[] }>(`/api/dms?workspace_id=${scope}`, { signal: controller.signal }),
        ]);
        if (!alive) return;
        bots = outputBots(members.map((m) => m.user));
        labels = Object.fromEntries([...channels.channels.map((c) => [c.id, `#${c.name}`]), ...directs.conversations.map((d) => [d.id, d.members.filter((m) => m.id !== user?.id).map((m) => m.display_name).join(", ") || "Direct conversation"])]);
        const saved = galleryReturn;
        if (saved?.userID === user.id && saved.workspaceID === scope && boundOutputBot(bots, saved.sourceID)) {
          sourceID = saved.sourceID; session = saved.session;
          validating = true; await run(() => session!.revalidate()); validating = false;

        } else {
          let stored = ""; try { stored = localStorage.getItem(outputSourceKey(user.id, scope)) ?? ""; } catch { /* Selection is optional. */ }
          await choose(stored);
        }
        if (!alive) return;
        initializing = false;
        await tick();
        if (session) {
          restorePosition();
          if (session.selectedID) document.querySelector<HTMLElement>(`[data-output-focus="${CSS.escape(session.selectedID)}"]`)?.focus({ preventScroll: true });
        }
        realtime = connectRealtime({ workspaceID: scope, onOpen: () => { void revalidate(); }, onEvent: (event) => {
          if (event.type !== "message.created" && /message\.|member|channel|bot\.|workspace\./.test(event.type)) void revalidate();
        } });
      } catch { if (alive) { error = "Could not load the workspace gallery. Reload to retry."; initializing = false; } }
    })();
    return () => { alive = false; navigation++; sourceAbort?.abort(); controller.abort(); session?.cancel(); realtime?.close(); };
  });
</script>
<svelte:window onfocus={() => void revalidate()} ononline={() => void revalidate()} />
<section class="output-gallery" bind:this={scroll} onscroll={(event) => { if (alive && session && !initializing && !validating) session.scrollTop = event.currentTarget.scrollTop; }}>
  <header><h1>VAI gallery</h1><p>{workspace?.name ?? "Workspace"} · responses from your selected bot account</p>
    <label>Source account <select value={sourceID} onchange={(event) => void choose(event.currentTarget.value)} disabled={initializing}>
      <option value="">Select a bot account</option>
      {#each bots as bot (bot.id)}<option value={bot.id}>{bot.display_name} (@{bot.handle}) · {bot.id}</option>{/each}
    </select></label>
    {#if sourceID}<button disabled={busy} onclick={() => void run(() => session!.load())}>Refresh</button><button disabled={busy} onclick={() => void latest()}>Latest response</button>{/if}
  </header>
  {#if error}<p role="alert">{error}</p>{#if !sourceID}<button onclick={() => window.location.reload()}>Reload gallery</button>{/if}{/if}
  {#if pageError}<p role="alert">{pageError}</p><button onclick={() => void run(() => session!.load(!!session?.nextCursor))}>Retry</button>{/if}
  {#if initializing || validating}<p role="status">Checking responses…</p>
  {:else if !sourceID}<p>Select the VAI bot account explicitly. The gallery remembers its account ID for this workspace.</p>
  {:else}
    <div class="output-grid">{#each outputs as message (message.id)}<OutputCard {message} label={labels[message.channel_id || message.direct_conversation_id || ""] || "Source conversation"} onOpen={(value) => void open(value)} />{/each}</div>
    {#if !busy && !pageError && !outputs.length}<p>No responses from this account yet.</p>{/if}
    {#if more}<button disabled={busy} onclick={() => void run(() => session!.load(true))}>{busy ? "Loading…" : "Load older responses"}</button>{/if}
  {/if}
</section>
<style>
  .output-gallery { height: 100%; overflow: auto; padding: clamp(1rem, 3vw, 3rem); color: var(--text); }
  header { margin-bottom: 1.5rem; }
  h1 { margin: 0; font-size: 1.8rem; }
  header p { color: var(--text-muted); }
  label { display: inline-flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  select { max-width: min(100%, 32rem); }
  button { margin: .5rem; }
  .output-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 1.25rem; align-items: start; }
</style>
