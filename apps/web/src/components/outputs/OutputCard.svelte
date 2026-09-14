<script lang="ts">
  import { tick } from "svelte";
  import { api } from "../../lib/api";
  import { eligibleGalleryActions, type GalleryActionDiscovery } from "../../lib/gallery-actions";
  import { uploadURL } from "../../lib/uploads";
  import type { Message, Upload } from "../../lib/types";

  let { message, upload, label, eager, onOpen, onAddToMessage, onExpandImage, onExpandVideo, onGalleryAction }: {
    message: Message; upload: Upload; label: string; eager: boolean;
    onOpen: (message: Message) => void;
    onAddToMessage: (upload: Upload) => void;
    onExpandImage: (upload: Upload) => void;
    onExpandVideo: (upload: Upload) => void;
    onGalleryAction?: (action: GalleryActionDiscovery, upload: Upload, message: Message) => void;
  } = $props();
  let menu = $state(false);
  let actions = $state<GalleryActionDiscovery[]>([]);
  let discovery = 0;
  $effect(() => { if (!menu || !onGalleryAction) return; const serial = ++discovery; const abort = new AbortController(); actions = [];
    const params = new URLSearchParams({source_upload_id:upload.id,destination_id:message.channel_id || message.direct_conversation_id || ""});
    void api<{gallery_actions:unknown}>(`/api/workspaces/${encodeURIComponent(message.workspace_id)}/gallery-actions?${params}`,{signal:abort.signal}).then(data=>{if(serial===discovery&&!abort.signal.aborted)actions=eligibleGalleryActions(data.gallery_actions,upload);}).catch(()=>{});
    return ()=>{abort.abort();};
  });
  let menuButton: HTMLButtonElement;
  const mediaURL = $derived(uploadURL(upload));
  const isVideo = $derived(upload.content_type.toLowerCase().startsWith("video/"));
  // Server metadata is authoritative when present. Without it, let the media
  // establish its natural ratio rather than putting a portrait in a 4:3 crop.
  let reservedRatio = $state(upload.width && upload.height ? `${upload.width} / ${upload.height}` : "");
  const mediaStyle = $derived(reservedRatio ? `aspect-ratio: ${reservedRatio}` : "");
  const alt = $derived(isVideo ? "" : `Image from ${label}`);
  function resolveImageRatio(image: HTMLImageElement) {
    if (!reservedRatio && image.naturalWidth && image.naturalHeight) reservedRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
  }
  function resolveVideoRatio(video: HTMLVideoElement) {
    if (!reservedRatio && video.videoWidth && video.videoHeight) reservedRatio = `${video.videoWidth} / ${video.videoHeight}`;
  }
  function showMenu(event: MouseEvent | KeyboardEvent) { event.preventDefault(); menu = true; void tick(); }
  function closeMenu() { menu = false; void tick().then(() => menuButton?.focus({ preventScroll: true })); }
  function keydown(event: KeyboardEvent) {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) showMenu(event);
    if (event.key === "Escape" && menu) { event.preventDefault(); closeMenu(); }
  }
</script>

<article class="output-card" data-output-id={message.id}>
  <div class="output-card__media" style={mediaStyle}>
    {#if isVideo}
      <video src={mediaURL} preload="metadata" playsinline controls controlslist="nodownload" aria-label={`Video from ${label}`} onloadedmetadata={(event) => resolveVideoRatio(event.currentTarget)} oncontextmenu={showMenu} onkeydown={keydown}><track kind="captions" /></video>
    {:else}
      <button class="output-card__expand" type="button" aria-label={`Open image from ${label}`} onclick={() => onExpandImage(upload)} oncontextmenu={showMenu} onkeydown={keydown}>
        <img src={mediaURL} {alt} loading={eager ? "eager" : "lazy"} decoding="async" width={upload.width || undefined} height={upload.height || undefined} onload={(event) => resolveImageRatio(event.currentTarget)} />
      </button>
    {/if}
  </div>
  <footer>
    <div class="output-card__meta"><span>{label}</span><time datetime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time></div>
    <div class="output-card__actions">
      {#if isVideo}<button type="button" class="output-card__source" aria-label={`Open video from ${label}`} onclick={() => onExpandVideo(upload)}>expand</button>{/if}
      <button bind:this={menuButton} type="button" class="output-card__source" aria-label={`Media options for ${upload.filename}`} aria-haspopup="menu" aria-expanded={menu} aria-keyshortcuts="Shift+F10" onclick={() => (menu = !menu)} onkeydown={keydown}>options</button>
      <button type="button" class="output-card__source" data-output-focus={message.id} onclick={() => onOpen(message)}>open source</button>
    </div>
  </footer>
  {#if menu}
    <div class="output-card__menu" role="menu" tabindex="-1" aria-label="Media options" onkeydown={keydown}>
      <button type="button" role="menuitem" onclick={() => { onAddToMessage(upload); closeMenu(); }}>Add to pending message</button>
      {#each actions as action (`${action.installation_id}:${action.descriptor.id}`)}<button type="button" role="menuitem" onclick={async () => { menu = false; await tick(); menuButton?.focus({preventScroll:true}); onGalleryAction?.(action, upload, message); }}>{action.descriptor.label}</button>{/each}
      <a role="menuitem" href={mediaURL} download={upload.filename} onclick={() => (menu = false)}>Download</a>
    </div>
  {/if}
</article>

<style>
  .output-card { position: relative; min-width: 0; overflow: visible; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); box-shadow: 0 8px 24px rgb(0 0 0 / .12); }
  .output-card__media { display: grid; min-width: 0; background: var(--bg); place-items: center; }
  .output-card__expand { display:block; width:100%; padding:0; border:0; background:transparent; cursor:zoom-in; }
  img, video { display:block; width:100%; height:auto; max-width:100%; object-fit:contain; background:var(--bg); }
  footer { display:flex; align-items:center; justify-content:space-between; gap:.75rem; padding:.7rem .8rem; border-top:1px solid var(--line); }
  .output-card__meta { min-width:0; color:var(--muted); font-size:.76rem; } .output-card__meta span,time { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .output-card__actions { display:flex; gap:.35rem; flex:none; }
  .output-card__source { min-height:2rem; padding:.35rem .6rem; border:1px solid var(--line-strong); border-radius:6px; background:var(--surface); color:var(--text); font:inherit; font-size:.78rem; cursor:pointer; }
  .output-card__source:hover,.output-card__expand:focus-visible { background:var(--hover-strong); } .output-card__source:focus-visible,.output-card__expand:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .output-card__menu { position:absolute; z-index:5; right:.8rem; bottom:3.25rem; display:grid; min-width:13rem; padding:.3rem; border:1px solid var(--line-strong); border-radius:7px; background:var(--panel-2); box-shadow:0 8px 24px rgb(0 0 0 / .25); }
  .output-card__menu button,.output-card__menu a { padding:.5rem .6rem; border:0; border-radius:4px; background:transparent; color:var(--text); text-align:left; font:inherit; text-decoration:none; cursor:pointer; } .output-card__menu button:hover,.output-card__menu a:hover { background:var(--hover-strong); }
</style>
