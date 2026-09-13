<script lang="ts">
  import { uploadURL } from "../../lib/uploads";
  import type { Message, Upload } from "../../lib/types";

  let {
    message,
    upload,
    label,
    eager,
    onOpen,
  }: {
    message: Message;
    upload: Upload;
    label: string;
    eager: boolean;
    onOpen: (message: Message) => void;
  } = $props();

  const mediaURL = $derived(uploadURL(upload));
  const isVideo = $derived(upload.content_type.toLowerCase().startsWith("video/"));
  const alt = $derived(isVideo ? "" : `Image from ${label}`);
</script>

<article class="output-card" data-output-id={message.id}>
  <div class="output-card__media">
    {#if isVideo}
      <video
        src={mediaURL}
        preload="metadata"
        playsinline
        controls
        controlslist="nodownload"
        aria-label={`Video from ${label}`}
      ><track kind="captions" /></video>
    {:else}
      <img
        src={mediaURL}
        {alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        width={upload.width || undefined}
        height={upload.height || undefined}
      />
    {/if}
  </div>
  <footer>
    <div class="output-card__meta">
      <span>{label}</span>
      <time datetime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time>
    </div>
    <button type="button" class="output-card__source" data-output-focus={message.id} onclick={() => onOpen(message)}>
      open source
    </button>
  </footer>
</article>

<style>
  .output-card {
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
  }
  .output-card__media {
    display: grid;
    min-height: 12rem;
    max-height: min(48vh, 31rem);
    background: var(--bg);
    place-items: center;
  }
  img, video {
    display: block;
    width: 100%;
    height: 100%;
    max-height: min(48vh, 31rem);
    object-fit: contain;
    background: var(--bg);
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: .75rem;
    padding: .7rem .8rem;
    border-top: 1px solid var(--line);
  }
  .output-card__meta { min-width: 0; color: var(--muted); font-size: .76rem; }
  .output-card__meta span, time { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .output-card__source {
    flex: none;
    min-height: 2rem;
    padding: .35rem .6rem;
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: .78rem;
    cursor: pointer;
  }
  .output-card__source:hover { background: var(--hover-strong); }
  .output-card__source:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
