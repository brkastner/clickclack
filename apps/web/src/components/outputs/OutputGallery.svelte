<script lang="ts">
  import { onMount, tick } from "svelte";
  import { goto } from "$app/navigation";
  import { sourceConversationID } from "../../lib/chat/message-source-navigation";
  import { api } from "../../lib/api";
  import { uploadURL, imageViewerItems, type ImageViewerItem } from "../../lib/uploads";
  import type { Channel, DirectConversation, Message, Upload, User, Workspace } from "../../lib/types";
  import { listAllWorkspaceMembers } from "../../lib/workspace-members";
  import { connectRealtime } from "../../lib/realtime.svelte";
  import { OutputGallerySession, outputBots, boundOutputBot, outputSourceKey, outputIncludeOwnKey, preferredGalleryDestination, galleryReturn, rememberGallery, revealGallerySource, clearGalleryReturn, type OutputPage } from "../../lib/output-gallery";
  import { MAX_MESSAGE_ATTACHMENTS } from "../../lib/attachments";
  import { enqueueGalleryAttachment, galleryAttachmentQueue, removeGalleryAttachment, clearGalleryAttachments, setGalleryAttachmentDestination } from "../../lib/gallery-attachment-queue";
  import GalleryActionPanel from "./GalleryActionPanel.svelte";
  import { eligibleGalleryActions, type GalleryActionDiscovery } from "../../lib/gallery-actions";
  import type { ImageViewerContextAction } from "../media/ImageViewerIsland";
  import OutputCard from "./OutputCard.svelte";
  import ImageViewer from "../media/ImageViewer.svelte";
  let { workspaceID }: { workspaceID: string } = $props();
  let workspace = $state<Workspace>();
  let user = $state<User>();
  let bots = $state<User[]>([]);
  let sourceID = $state("");
  let session = $state<OutputGallerySession>();
  let labels = $state<Record<string, string>>({});
  let channels = $state<Channel[]>([]);
  let directs = $state<DirectConversation[]>([]);
  let queue = $state<Upload[]>([]);
  let choosingDestination = $state(false);
  let galleryAction = $state<{action:GalleryActionDiscovery;upload:Upload;destinationID:string}>();
  let galleryActionNotice = $state<{message:string;failed:boolean}>();
  let expandedImageIndex = $state<number | undefined>();
  let expandedVideo = $state<Upload>();
  let expandedOpener: HTMLElement | null = null;
  let galleryGap = $state(16);
  let includeOwn = $state(false);
  let masonry = $state<Record<string, { left: number; top: number }>>({});
  let masonryWidth = $state(0);
  let masonryHeight = $state(0);
  let masonryGrid = $state<HTMLElement | null>(null);
  let masonrySignature = "";
  let masonryQueued = false;
  let masonrySettling = true;
  let masonryResizeObserver: ResizeObserver | undefined;
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
  // Each fetched page is its own masonry block. Appending a page therefore never
  // rebalances or moves cards that the reader has already seen.
  const mediaPages = $derived.by(() => { void revision; return (session?.pages ?? []).map((page) => page.outputs.flatMap((message) => mediaAttachments(message).map((upload) => ({ message, upload })))); });
  const media = $derived.by(() => mediaPages.flat());
  // Keep the viewer's order identical to the ordered gallery, including every
  // loaded page; videos retain their own player rather than being coerced into images.
  const imageUploads = $derived(media.filter((item) => /^image\//i.test(item.upload.content_type)).map((item) => item.upload));
  const viewerItems = $derived(imageViewerItems(imageUploads));
  const pendingDestination = $derived(preferredGalleryDestination(directs, bots, sourceID));
  function mediaAttachments(message: Message): Upload[] {
    return (message.attachments ?? []).filter((upload) => /^(image|video)\//i.test(upload.content_type));
  }
  const busy = $derived.by(() => { void revision; return validating || session?.busy; });
  const pageError = $derived.by(() => { void revision; return session?.error; });
  const more = $derived.by(() => { void revision; return session?.nextCursor; });
  async function run(action: () => Promise<unknown>) { const work = action(); revision++; await work; revision++; }
  async function choose(id: string) {
    galleryAction = undefined;
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
      if (includeOwn) params.set("include_own", "true");
      if (cursor) params.set("cursor", cursor);
      return api<OutputPage>(`/api/workspaces/${scope}/outputs?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
    });
    rememberGallery({ userID: user.id, workspaceID: scope, sourceID: author, includeOwn, session });
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
  function tileKey(item: { message: Message; upload: Upload }) { return `${item.message.id}:${item.upload.id}`; }
  function queueMasonry() {
    if (masonryQueued) return;
    masonryQueued = true;
    requestAnimationFrame(async () => {
      masonryQueued = false;
      if (!masonryGrid) return;
      const gap = galleryGap;
      const available = masonryGrid.clientWidth;
      if (!available) return;
      const columns = Math.max(1, Math.floor((available + gap) / (272 + gap)));
      const width = (available - gap * (columns - 1)) / columns;
      const signature = `${columns}:${Math.round(width * 100) / 100}:${gap}`;
      const reflow = signature !== masonrySignature;
      masonrySignature = signature;
      masonryWidth = width;
      await tick();
      const tiles = Array.from(masonryGrid.querySelectorAll<HTMLElement>("[data-gallery-tile]"));
      for (const tile of tiles) masonryResizeObserver?.observe(tile);
      const positions: Record<string, { left: number; top: number }> = reflow ? {} : { ...masonry };
      const bottoms = Array.from({ length: columns }, () => 0);
      for (const tile of tiles) {
        const key = tile.dataset.galleryTile!;
        const position = positions[key];
        if (position) {
          // Keep a settled tile in its assigned column. If its media resolves
          // late, only later tiles in that column move down; no tile is moved
          // to a different column and appending alone leaves old positions intact.
          const column = Math.min(columns - 1, Math.round(position.left / (width + gap)));
          positions[key] = { left: position.left, top: bottoms[column] };
          bottoms[column] += tile.offsetHeight + gap;
        }
      }
      for (const tile of tiles) {
        const key = tile.dataset.galleryTile!;
        if (positions[key]) continue;
        const column = bottoms.reduce((shortest, bottom, index) => bottom < bottoms[shortest] ? index : shortest, 0);
        positions[key] = { left: column * (width + gap), top: bottoms[column] };
        bottoms[column] += tile.offsetHeight + gap;
      }
      masonry = positions;
      masonryHeight = Math.max(0, ...bottoms.map((bottom) => Math.max(0, bottom - gap)));
    });
  }
  function masonryStyle(item: { message: Message; upload: Upload }) {
    const position = masonry[tileKey(item)];
    return `width:${masonryWidth}px;${position ? `transform:translate(${position.left}px,${position.top}px)` : ""}`;
  }
  $effect(() => {
    if (!masonryGrid) return;
    const settleTimer = setTimeout(() => { masonrySettling = false; }, 1_000);
    masonryResizeObserver = new ResizeObserver(() => {
      if (masonrySettling) masonrySignature = "";
      queueMasonry();
    });
    const mutations = new MutationObserver(() => queueMasonry());
    masonryResizeObserver.observe(masonryGrid);
    mutations.observe(masonryGrid, { childList: true, subtree: true });
    queueMasonry();
    return () => { clearTimeout(settleTimer); masonryResizeObserver?.disconnect(); masonryResizeObserver = undefined; mutations.disconnect(); };
  });
  async function setGalleryGap(value: number) {
    capturePosition();
    galleryGap = value;
    try { localStorage.setItem("clickclack:gallery-gap", String(value)); } catch { /* A temporary gap is still usable. */ }
    await tick();
    queueMasonry();
    await tick();
    restorePosition();
  }
  async function setIncludeOwn(value: boolean) {
    if (!user || !workspace || value === includeOwn) return;
    includeOwn = value;
    try { localStorage.setItem(outputIncludeOwnKey(user.id, workspace.id), value ? "true" : "false"); } catch { /* The session setting still works. */ }
    await choose(sourceID);
  }
  function addToQueue(upload: Upload) {
    if (!user || !workspace) return;
    queue = enqueueGalleryAttachment(user.id, workspace.id, upload, MAX_MESSAGE_ATTACHMENTS).uploads;
  }
  function removeFromQueue(uploadID: string) {
    if (!user || !workspace) return;
    queue = removeGalleryAttachment(user.id, workspace.id, uploadID).uploads;
  }
  function clearQueue() {
    if (!user || !workspace) return;
    clearGalleryAttachments(user.id, workspace.id); queue = [];
  }
  async function chooseDestination(destinationID: string) {
    if (!user || !workspace || !setGalleryAttachmentDestination(user.id, workspace.id, destinationID)) return;
    choosingDestination = false;
    await goto(`/app/${encodeURIComponent(workspace.id)}/${encodeURIComponent(destinationID)}`);
  }
  function expandImage(upload: Upload) {
    const index = imageUploads.findIndex((item) => item.id === upload.id);
    if (index < 0) return;
    expandedImageIndex = index;
  }
  async function expandedContextActions(item: ImageViewerItem): Promise<ImageViewerContextAction[]> {
    if (!item.upload) return [];
    const source = media.find((entry) => entry.upload.id === item.upload!.id);
    if (!source) return [];
    const destinationID = source.message.channel_id || source.message.direct_conversation_id || "";
    const params = new URLSearchParams({ source_upload_id: item.upload.id, destination_id: destinationID });
    const data = await api<{gallery_actions:unknown}>(`/api/workspaces/${encodeURIComponent(source.message.workspace_id)}/gallery-actions?${params}`);
    return eligibleGalleryActions(data.gallery_actions, item.upload).filter((action) => action.descriptor.fields.length === 0).map((action) => ({
      id: `${action.installation_id}:${action.descriptor.id}`,
      label: action.descriptor.label,
      run: () => { expandedImageIndex = undefined; galleryActionNotice = undefined; galleryAction = { action, upload: item.upload, destinationID }; },
    }));
  }
  function expandVideo(upload: Upload) {
    expandedOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    expandedVideo = upload;
  }
  function closeExpandedVideo() { expandedVideo = undefined; void tick().then(() => expandedOpener?.focus({ preventScroll: true })); }
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
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const resizeObserver = new ResizeObserver(() => {
      if (initializing || validating) return;
      capturePosition();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { void tick().then(restorePosition); }, 0);
    });
    if (scroll) resizeObserver.observe(scroll);
    void (async () => {
      try {
        const [me, ws] = await Promise.all([api<{ user: User }>("/api/me", { signal: controller.signal }), api<{ workspaces: Workspace[] }>("/api/workspaces", { signal: controller.signal })]);
        if (!alive) return;
        user = me.user; workspace = ws.workspaces.find((w) => w.id === workspaceID || w.route_id === workspaceID);
        if (!workspace) throw new Error("Workspace unavailable");
        const scope = workspace.id;
        const [members, loadedChannels, loadedDirects] = await Promise.all([
          listAllWorkspaceMembers({ workspaceID: scope, role: "bot", signal: controller.signal }),
          api<{ channels: Channel[] }>(`/api/workspaces/${scope}/channels`, { signal: controller.signal }),
          api<{ conversations: DirectConversation[] }>(`/api/dms?workspace_id=${scope}`, { signal: controller.signal }),
        ]);
        if (!alive) return;
        bots = outputBots(members.map((m) => m.user));
        channels = loadedChannels.channels; directs = loadedDirects.conversations;
        labels = Object.fromEntries([...channels.map((c) => [c.id, `#${c.name}`]), ...directs.map((d) => [d.id, d.members.filter((m) => m.id !== user?.id).map((m) => m.display_name).join(", ") || "Direct conversation"])]);
        queue = galleryAttachmentQueue(user.id, scope).uploads;
        try {
          galleryGap = Math.max(4, Math.min(40, Number(localStorage.getItem("clickclack:gallery-gap")) || 16));
          includeOwn = localStorage.getItem(outputIncludeOwnKey(user.id, scope)) === "true";
        } catch { /* Defaults remain stable. */ }
        const saved = galleryReturn;
        if (saved?.userID === user.id && saved.workspaceID === scope && (saved.includeOwn ?? false) === includeOwn && boundOutputBot(bots, saved.sourceID)) {
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
    return () => { alive = false; clearTimeout(resizeTimer); resizeObserver.disconnect(); navigation++; sourceAbort?.abort(); controller.abort(); session?.cancel(); realtime?.close(); };
  });
</script>
<svelte:window onfocus={() => void revalidate()} ononline={() => void revalidate()} onkeydown={(event) => { if (expandedVideo && event.key === "Escape") { event.preventDefault(); closeExpandedVideo(); } }} />
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
      <label>spacing <input type="range" min="4" max="40" step="2" value={galleryGap} aria-label="gallery spacing" oninput={(event) => void setGalleryGap(Number(event.currentTarget.value))} /></label>
      <label class="output-gallery__toggle"><input type="checkbox" checked={includeOwn} onchange={(event) => void setIncludeOwn(event.currentTarget.checked)} /><span>show mine</span></label>
      {#if sourceID}
        <button class="output-gallery__button" disabled={busy} onclick={() => void run(() => session!.load())}>refresh</button>
        <button class="output-gallery__button output-gallery__button--primary" disabled={busy} onclick={() => void latest()}>latest</button>
      {/if}
    </div>
  </header>
  {#if error}<p class="output-gallery__notice" role="alert">{error}</p>{#if !sourceID}<button class="output-gallery__button" onclick={() => window.location.reload()}>reload gallery</button>{/if}{/if}
  {#if galleryActionNotice}<p class="output-gallery__notice" role={galleryActionNotice.failed?"alert":"status"}>{galleryActionNotice.message}</p>{/if}
  {#if pageError}<p class="output-gallery__notice" role="alert">{pageError}</p><button class="output-gallery__button" onclick={() => void run(() => session!.load(!!session?.nextCursor))}>retry</button>{/if}
  {#if initializing}<p class="output-gallery__notice" role="status">checking gallery…</p>
  {:else if !sourceID}<p class="output-gallery__notice">select the bot account whose media you want to browse.</p>
  {:else}
    <div class="output-grid" bind:this={masonryGrid} style={`--gallery-gap: ${galleryGap}px; height: ${masonryHeight}px`}>
      {#each media as item, itemIndex (tileKey(item))}
        <div class="output-grid__tile" data-gallery-tile={tileKey(item)} style={masonryStyle(item)}>
          <OutputCard message={item.message} upload={item.upload} label={labels[item.message.channel_id || item.message.direct_conversation_id || ""] || "source conversation"} eager={itemIndex < 12} onOpen={(value) => void open(value)} onAddToMessage={addToQueue} onExpandImage={expandImage} onExpandVideo={expandVideo} onGalleryAction={(action,upload,message)=>{galleryActionNotice=undefined;galleryAction={action,upload,destinationID:message.channel_id || message.direct_conversation_id || ""};}} />
        </div>
      {/each}
    </div>
    {#if !busy && !pageError && !media.length}<p class="output-gallery__notice">no images or videos from this account yet.</p>{/if}
    {#if more}<div class="output-gallery__more"><button class="output-gallery__button" disabled={busy} onclick={() => void run(() => session!.load(true))}>{busy ? "loading…" : "load older media"}</button></div>{/if}
  {/if}
  {#if galleryAction && user}{#key `${galleryAction.action.installation_id}:${galleryAction.action.descriptor.id}:${galleryAction.upload.id}`}<GalleryActionPanel {...galleryAction} {workspaceID} actorID={user.id} onClose={()=>{galleryAction=undefined;}} onStatus={(message,failed)=>{galleryActionNotice={message,failed};}} />{/key}{/if}
  {#if queue.length}
    <aside class="output-gallery__queue" aria-label="Pending gallery attachments"><strong>{queue.length} pending</strong><button class="output-gallery__button output-gallery__button--primary" onclick={() => pendingDestination ? void chooseDestination(pendingDestination.id) : (choosingDestination = true)}>add to @{pendingDestination?.bot.handle ?? "vai"} message</button><button class="output-gallery__button" onclick={() => (choosingDestination = true)}>choose another…</button><button class="output-gallery__button" onclick={clearQueue}>clear</button>{#each queue as upload (upload.id)}<button class="output-gallery__queued" onclick={() => removeFromQueue(upload.id)} aria-label={`Remove ${upload.filename} from pending attachments`}>{upload.filename} ×</button>{/each}</aside>
  {/if}
  {#if choosingDestination}
    <div class="output-gallery__scrim" role="presentation" onclick={() => (choosingDestination = false)}><section class="output-gallery__chooser" role="dialog" aria-modal="true" aria-label="Choose destination" onclick={(event) => event.stopPropagation()}><h2>add {queue.length} pending item{queue.length === 1 ? "" : "s"} to</h2><p>Choose the conversation whose draft should receive these uploads. Nothing will be sent.</p><div class="output-gallery__destinations">{#each channels as channel (channel.id)}<button onclick={() => void chooseDestination(channel.id)}>#{channel.name}</button>{/each}{#each directs as direct (direct.id)}<button onclick={() => void chooseDestination(direct.id)}>{labels[direct.id]}</button>{/each}</div><button class="output-gallery__button" onclick={() => (choosingDestination = false)}>cancel</button></section></div>
  {/if}
  {#if expandedImageIndex !== undefined}
    <ImageViewer items={viewerItems} initialIndex={expandedImageIndex} loadContextActions={expandedContextActions} onClose={() => (expandedImageIndex = undefined)} />
  {/if}
  {#if expandedVideo}
    <div class="output-gallery__scrim" role="presentation" onclick={closeExpandedVideo} onkeydown={(event) => event.key === "Escape" && closeExpandedVideo()}><section class="output-gallery__video-viewer" role="dialog" aria-modal="true" aria-label={`Expanded ${expandedVideo.filename}`} tabindex="-1" onclick={(event) => event.stopPropagation()}><video src={uploadURL(expandedVideo)} controls autoplay playsinline aria-label={expandedVideo.filename}><track kind="captions" /></video><button class="output-gallery__button" autofocus onclick={closeExpandedVideo}>close</button></section></div>
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
  .output-gallery__toggle { display: flex; min-height: 2.35rem; align-items: center; align-self: end; gap: .45rem; padding: 0 .7rem; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--surface); color: var(--text); cursor: pointer; }
  .output-gallery__toggle:hover { border-color: var(--accent); background: var(--hover-strong); }
  .output-gallery__toggle input { width: 1rem; height: 1rem; margin: 0; accent-color: var(--accent); }
  .output-gallery__toggle span { font-size: .76rem; font-weight: 700; }
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
  .output-grid { position: relative; margin: 0 auto; max-width: 110rem; }
  .output-grid__tile { position: absolute; top: 0; left: 0; min-width: 0; transition: none; }
  .output-gallery__more { display: flex; justify-content: center; padding: 1.5rem; }
  .output-gallery__queue { position: fixed; z-index: 4; right: 1rem; bottom: 1rem; display: flex; max-width: min(34rem, calc(100vw - 2rem)); flex-wrap: wrap; align-items: center; gap: .45rem; padding: .65rem; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--panel-2); box-shadow: 0 8px 24px rgb(0 0 0 / .25); }
  .output-gallery__queued { max-width: 9rem; overflow: hidden; border: 0; background: transparent; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
  .output-gallery__scrim { position: fixed; z-index: 10; inset: 0; display: grid; padding: 1rem; background: rgb(0 0 0 / .7); place-items: center; }
  .output-gallery__chooser, .output-gallery__video-viewer { max-width: min(50rem, 100%); max-height: calc(100vh - 2rem); overflow: auto; padding: 1rem; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--panel); color: var(--text); }
  .output-gallery__chooser h2 { margin-top: 0; } .output-gallery__destinations { display: grid; max-height: 50vh; margin: 1rem 0; overflow: auto; gap: .35rem; } .output-gallery__destinations button { padding: .6rem; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); text-align: left; cursor: pointer; } .output-gallery__destinations button:hover { background: var(--hover-strong); }
  .output-gallery__video-viewer { display: grid; gap: .75rem; width: min(90vw, 80rem); } .output-gallery__video-viewer video { display: block; width: 100%; max-height: calc(100vh - 8rem); object-fit: contain; }
  @media (max-width: 720px) {
    .output-gallery {
      padding: 1rem calc(1rem + var(--safe-area-right)) calc(1rem + var(--safe-area-bottom))
        calc(1rem + var(--safe-area-left));
    }
    .output-gallery__header { align-items: stretch; flex-direction: column; }
    .output-gallery__controls { align-items: stretch; }
    label { flex: 1 1 100%; }
    select { width: 100%; }
    .output-gallery__button { flex: 1; }
    .output-gallery__queue { right: calc(1rem + var(--safe-area-right)); bottom: calc(1rem + var(--safe-area-bottom)); left: calc(1rem + var(--safe-area-left)); max-width: none; }
  }
</style>
