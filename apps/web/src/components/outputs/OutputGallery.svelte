<script lang="ts">
  import { onMount, tick } from "svelte";
  import { goto } from "$app/navigation";
  import { sourceConversationID } from "../../lib/chat/message-source-navigation";
  import { api } from "../../lib/api";
  import type { Channel, DirectConversation, Message, Upload, User, Workspace } from "../../lib/types";
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
  const media = $derived.by(() => outputs.flatMap((message) => mediaAttachments(message).map((upload) => ({ message, upload }))));
  function mediaAttachments(message: Message): Upload[] {
    return (message.attachments ?? []).filter((upload) => /^(image|video)\//i.test(upload.content_type));
  }
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
      const params = new URLSearchParams({ author_id: author, limit: String(limit), media_only: "true" });
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
  <header class="output-gallery__header">
    <div><h1>gallery</h1><p>{workspace?.name ?? "workspace"} · images and videos from a selected bot</p></div>
    <div class="output-gallery__controls">
      <label>source
        <select value={sourceID} onchange={(event) => void choose(event.currentTarget.value)} disabled={initializing} aria-label="gallery source account">
          <option value="">select a bot account</option>
          {#each bots as bot (bot.id)}<option value={bot.id}>{bot.display_name}{bot.handle ? ` (@${bot.handle})` : ""}</option>{/each}
        </select>
      </label>
      {#if sourceID}
        <button class="output-gallery__button" disabled={busy} onclick={() => void run(() => session!.load())}>refresh</button>
        <button class="output-gallery__button output-gallery__button--primary" disabled={busy} onclick={() => void latest()}>latest</button>
      {/if}
    </div>
  </header>
  {#if error}<p class="output-gallery__notice" role="alert">{error}</p>{#if !sourceID}<button class="output-gallery__button" onclick={() => window.location.reload()}>reload gallery</button>{/if}{/if}
  {#if pageError}<p class="output-gallery__notice" role="alert">{pageError}</p><button class="output-gallery__button" onclick={() => void run(() => session!.load(!!session?.nextCursor))}>retry</button>{/if}
  {#if initializing || validating}<p class="output-gallery__notice" role="status">checking gallery…</p>
  {:else if !sourceID}<p class="output-gallery__notice">select the bot account whose media you want to browse.</p>
  {:else}
    <div class="output-grid">
      {#each media as item, index (`${item.message.id}:${item.upload.id}`)}
        <OutputCard message={item.message} upload={item.upload} label={labels[item.message.channel_id || item.message.direct_conversation_id || ""] || "source conversation"} eager={index < 12} onOpen={(value) => void open(value)} />
      {/each}
    </div>
    {#if !busy && !pageError && !media.length}<p class="output-gallery__notice">no images or videos from this account yet.</p>{/if}
    {#if more}<div class="output-gallery__more"><button class="output-gallery__button" disabled={busy} onclick={() => void run(() => session!.load(true))}>{busy ? "loading…" : "load older media"}</button></div>{/if}
  {/if}
</section>
<style>
  .output-gallery { height: 100%; overflow: auto; padding: clamp(1rem, 3vw, 3rem); color: var(--text); }
  .output-gallery__header { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin: 0 auto 1.5rem; max-width: 110rem; }
  h1 { margin: 0; color: var(--text-strong); font-size: clamp(1.75rem, 3vw, 2.4rem); letter-spacing: -.035em; }
  h1 + p { margin: .35rem 0 0; color: var(--muted); }
  .output-gallery__controls { display: flex; align-items: end; flex-wrap: wrap; gap: .5rem; }
  label { display: grid; gap: .3rem; color: var(--muted); font-size: .76rem; font-weight: 650; text-transform: lowercase; }
  select, .output-gallery__button { min-height: 2.35rem; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--surface); color: var(--text); font: inherit; }
  select { min-width: min(18rem, calc(100vw - 3rem)); padding: 0 .7rem; cursor: pointer; color-scheme: light dark; }
  :global(:root[data-color-mode="light"]) select { color-scheme: light; }
  :global(:root[data-color-mode="dark"]) select { color-scheme: dark; }
  select option { background: var(--panel-2); color: var(--text); }
  .output-gallery__button { padding: 0 .8rem; cursor: pointer; }
  .output-gallery__button:hover:not(:disabled), select:hover:not(:disabled) { border-color: var(--accent); background: var(--hover-strong); }
  .output-gallery__button--primary { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); font-weight: 700; }
  .output-gallery__button--primary:hover:not(:disabled) { background: var(--accent-hover); }
  .output-gallery__button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .output-gallery__button:disabled, select:disabled { cursor: not-allowed; opacity: .55; }
  .output-gallery__notice { max-width: 44rem; margin: 3rem auto; color: var(--muted); text-align: center; }
  .output-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr)); gap: 1rem; margin: 0 auto; max-width: 110rem; align-items: start; }
  .output-gallery__more { display: flex; justify-content: center; padding: 1.5rem; }
  @media (max-width: 720px) { .output-gallery__header { align-items: stretch; flex-direction: column; } .output-gallery__controls { align-items: stretch; } label { flex: 1 1 100%; } select { width: 100%; } .output-gallery__button { flex: 1; } .output-grid { grid-template-columns: 1fr; } }
</style>
