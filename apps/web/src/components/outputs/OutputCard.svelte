<script lang="ts">
  import { tick } from "svelte";
  import { uploadURL } from "../../lib/uploads";
  import type { Message, Upload } from "../../lib/types";

  let { message, upload, label, eager, onOpen, onAddToMessage, onExpand }: {
    message: Message; upload: Upload; label: string; eager: boolean;
    onOpen: (message: Message) => void;
    onAddToMessage: (upload: Upload) => void;
    onExpand: (upload: Upload) => void;
  } = $props();
  let menu = $state(false);
  let menuButton: HTMLButtonElement;
  const mediaURL = $derived(uploadURL(upload));
  const isVideo = $derived(upload.content_type.toLowerCase().startsWith("video/"));
  // Reserve this card's frame once. Later metadata revalidation must not make
  // already-rendered tiles reshuffle their page block.
  let reservedRatio = $state(upload.width && upload.height ? `${upload.width} / ${upload.height}` : "4 / 3");
  const alt = $derived(isVideo ? "" : `Image from ${label}`);
  function showMenu(event: MouseEvent | KeyboardEvent) { event.preventDefault(); menu = true; void tick(); }
  function closeMenu() { menu = false; void tick().then(() => menuButton?.focus({ preventScroll: true })); }
  function keydown(event: KeyboardEvent) {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) showMenu(event);
    if (event.key === "Escape" && menu) { event.preventDefault(); closeMenu(); }
  }
</script>

<article class="output-card" data-output-id={message.id}>
  <div class="output-card__media" style={`aspect-ratio: ${reservedRatio}`}> 
    {#if isVideo}
      <video src={mediaURL} preload="metadata" playsinline controls controlslist="nodownload" aria-label={`Video from ${label}`} oncontextmenu={showMenu} onkeydown={keydown}><track kind="captions" /></video>
    {:else}
      <button class="output-card__expand" type="button" aria-label={`Open image from ${label}`} onclick={() => onExpand(upload)} oncontextmenu={showMenu} onkeydown={keydown}>
        <img src={mediaURL} {alt} loading={eager ? "eager" : "lazy"} decoding="async" width={upload.width || undefined} height={upload.height || undefined} />
      </button>
    {/if}
  </div>
  <footer>
    <div class="output-card__meta"><span>{label}</span><time datetime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time></div>
    <div class="output-card__actions">
      {#if isVideo}<button type="button" class="output-card__source" aria-label={`Open video from ${label}`} onclick={() => onExpand(upload)}>expand</button>{/if}
      <button bind:this={menuButton} type="button" class="output-card__source" aria-label={`Media options for ${upload.filename}`} aria-haspopup="menu" aria-expanded={menu} aria-keyshortcuts="Shift+F10" onclick={() => (menu = !menu)} onkeydown={keydown}>options</button>
      <button type="button" class="output-card__source" data-output-focus={message.id} onclick={() => onOpen(message)}>open source</button>
    </div>
  </footer>
  {#if menu}
    <div class="output-card__menu" role="menu" tabindex="-1" aria-label="Media options" onkeydown={keydown}>
      <button type="button" role="menuitem" onclick={() => { onAddToMessage(upload); closeMenu(); }}>Add to pending message</button>
      <a role="menuitem" href={mediaURL} download={upload.filename} onclick={() => (menu = false)}>Download</a>
    </div>
  {/if}
</article>

<style>
  .output-card { position: relative; min-width: 0; overflow: visible; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); box-shadow: 0 8px 24px rgb(0 0 0 / .12); }
  .output-card__media { display: grid; min-height: 12rem; max-height: min(48vh,31rem); overflow: hidden; background: var(--bg); place-items: center; }
  .output-card__expand { display:block; width:100%; padding:0; border:0; background:transparent; cursor:zoom-in; }
  img, video { display:block; width:100%; height:100%; max-height:min(48vh,31rem); object-fit:contain; background:var(--bg); }
  footer { display:flex; align-items:center; justify-content:space-between; gap:.75rem; padding:.7rem .8rem; border-top:1px solid var(--line); }
  .output-card__meta { min-width:0; color:var(--muted); font-size:.76rem; } .output-card__meta span,time { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .output-card__actions { display:flex; gap:.35rem; flex:none; }
  .output-card__source { min-height:2rem; padding:.35rem .6rem; border:1px solid var(--line-strong); border-radius:6px; background:var(--surface); color:var(--text); font:inherit; font-size:.78rem; cursor:pointer; }
  .output-card__source:hover,.output-card__expand:focus-visible { background:var(--hover-strong); } .output-card__source:focus-visible,.output-card__expand:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .output-card__menu { position:absolute; z-index:5; right:.8rem; bottom:3.25rem; display:grid; min-width:13rem; padding:.3rem; border:1px solid var(--line-strong); border-radius:7px; background:var(--panel-2); box-shadow:0 8px 24px rgb(0 0 0 / .25); }
  .output-card__menu button,.output-card__menu a { padding:.5rem .6rem; border:0; border-radius:4px; background:transparent; color:var(--text); text-align:left; font:inherit; text-decoration:none; cursor:pointer; } .output-card__menu button:hover,.output-card__menu a:hover { background:var(--hover-strong); }
</style>
