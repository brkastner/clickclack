<script lang="ts">
  import { tick } from "svelte";
  import { artifactKindLabel, classifyArtifact } from "../lib/artifacts";
  import { writeClipboardText } from "../lib/clipboard";
  import { copyAttachmentLink, copyViewerImage } from "../lib/image-viewer-clipboard";
  import type { Upload } from "../lib/types";

  type Props = {
    upload: Upload;
    url: string;
    attachments?: Upload[];
    eager?: boolean;
    onOpenImage?: (url: string, title: string, attachments: Upload[]) => void;
    onOpenArtifact?: (upload: Upload) => void;
  };

  let {
    upload,
    url,
    attachments = [],
    eager = true,
    onOpenImage = () => {},
    onOpenArtifact = () => {},
  }: Props = $props();

  const MAX_MEDIA_HEIGHT = 360;
  const MIN_MEDIA_HEIGHT = 120;

  let videoEl: HTMLVideoElement | null = $state(null);
  let imageOpenButton: HTMLButtonElement | null = $state(null);
  let imageContextMenuElement: HTMLDivElement | null = $state(null);
  let imageContextMenu = $state<{ x: number; y: number } | null>(null);
  let imageContextMenuStatus = $state("");
  let copyingImage = $state(false);
  let manuallyLoaded = $state(false);
  let mediaLoaded = $derived(eager || manuallyLoaded);
  let started = $state(false);
  let loadedDurationLabel = $state("");
  let durationLabel = $derived(loadedDurationLabel || formatDuration(upload.duration_ms ?? 0));

  let contentType = $derived((upload.content_type || "").split(";")[0].trim().toLowerCase());
  let artifactKind = $derived(classifyArtifact(upload));
  let isImage = $derived(artifactKind === "unsupported" && contentType.startsWith("image/"));
  let isVideo = $derived(artifactKind === "unsupported" && contentType.startsWith("video/"));
  let isAudio = $derived(artifactKind === "unsupported" && contentType.startsWith("audio/"));
  let canPreviewDocument = $derived(
    artifactKind === "code" ||
      artifactKind === "text" ||
      artifactKind === "markdown" ||
      artifactKind === "pdf" ||
      artifactKind === "spreadsheet" ||
      artifactKind === "presentation" ||
      artifactKind === "html",
  );
  let documentLabel = $derived(artifactKindLabel(artifactKind));

  let mediaStyle = $derived.by(() => {
    const w = upload.width ?? 0;
    const h = upload.height ?? 0;
    if (w <= 0 || h <= 0) return "";
    const cap = isImage ? 320 : MAX_MEDIA_HEIGHT;
    const ratioH = Math.min(cap, Math.max(MIN_MEDIA_HEIGHT, h));
    return `aspect-ratio: ${w} / ${h}; max-height: ${ratioH}px;`;
  });

  function formatDuration(ms: number): string {
    if (!ms || ms <= 0) return "";
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function handlePlay() {
    started = true;
  }

  function handleLoadedMetadata() {
    if (!videoEl || !isFinite(videoEl.duration)) return;
    loadedDurationLabel = formatDuration(videoEl.duration * 1000);
  }

  function startPlayback() {
    if (!videoEl) return;
    started = true;
    void videoEl.play();
  }

  function dismissImageContextMenu() {
    imageContextMenu = null;
    imageContextMenuStatus = "";
  }

  function closeImageContextMenu() {
    dismissImageContextMenu();
    void tick().then(() => imageOpenButton?.focus({ preventScroll: true }));
  }

  async function showImageContextMenu(x: number, y: number) {
    const menuWidth = 210;
    const menuHeight = 108;
    const margin = 8;
    imageContextMenu = {
      x: Math.max(margin, Math.min(x, window.innerWidth - menuWidth - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - menuHeight - margin)),
    };
    imageContextMenuStatus = "";
    await tick();
    imageContextMenuElement?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }

  function openImageContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    void showImageContextMenu(event.clientX, event.clientY);
  }

  function openImageContextMenuFromKeyboard(event: KeyboardEvent) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.getBoundingClientRect()
        : imageOpenButton?.getBoundingClientRect();
    if (!bounds) return;
    void showImageContextMenu(bounds.left + Math.min(bounds.width / 2, 80), bounds.top + 24);
  }

  function handleImageContextMenuKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeImageContextMenu();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = Array.from(
      imageContextMenuElement?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not([aria-disabled="true"])',
      ) ?? [],
    );
    if (buttons.length === 0) return;
    const current =
      document.activeElement instanceof HTMLButtonElement
        ? buttons.indexOf(document.activeElement)
        : -1;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    buttons[(current + direction + buttons.length) % buttons.length]?.focus();
  }

  async function copyInlineImage() {
    if (copyingImage) return;
    copyingImage = true;
    imageContextMenuStatus = "";
    try {
      await copyViewerImage(url);
      imageContextMenuStatus = "Image copied";
    } catch (error) {
      console.error("Could not copy image", error);
      imageContextMenuStatus = "Could not copy image";
    } finally {
      copyingImage = false;
    }
  }

  async function copyInlineAttachmentLink() {
    if (copyingImage) return;
    copyingImage = true;
    imageContextMenuStatus = "";
    try {
      await copyAttachmentLink(url, writeClipboardText);
      imageContextMenuStatus = "Attachment link copied";
    } catch (error) {
      console.error("Could not copy attachment link", error);
      imageContextMenuStatus = "Could not copy attachment link";
    } finally {
      copyingImage = false;
    }
  }

  $effect(() => {
    if (!imageContextMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (!imageContextMenuElement?.contains(event.target as Node)) dismissImageContextMenu();
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", dismissImageContextMenu);
    window.addEventListener("resize", dismissImageContextMenu);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", dismissImageContextMenu);
      window.removeEventListener("resize", dismissImageContextMenu);
    };
  });

  function formatBytes(size: number) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

</script>

{#if (isImage || isVideo || isAudio) && !mediaLoaded}
  <button
    type="button"
    class="media-tile media-tile--deferred"
    style={mediaStyle}
    aria-label={`Load preview for ${upload.filename}`}
    onclick={() => (manuallyLoaded = true)}
  >
    <span class="media-tile__deferred-icon" aria-hidden="true">
      {isVideo ? "▶" : isAudio ? "♪" : "◫"}
    </span>
    <span class="media-tile__deferred-copy">
      <strong>{upload.filename}</strong>
      <small>Load preview · {formatBytes(upload.byte_size)}</small>
    </span>
  </button>
{:else if isImage}
  <div class="media-tile media-tile--image">
    <button
      bind:this={imageOpenButton}
      type="button"
      class="media-tile__open"
      aria-label={`Open image ${upload.filename}`}
      aria-haspopup="menu"
      aria-expanded={imageContextMenu !== null}
      aria-keyshortcuts="Shift+F10"
      onclick={() => onOpenImage(url, upload.filename, attachments)}
      oncontextmenu={openImageContextMenu}
      onkeydown={openImageContextMenuFromKeyboard}
    >
      <img
        src={url}
        alt={upload.filename}
        loading="lazy"
        decoding="async"
        width={upload.width || undefined}
        height={upload.height || undefined}
        style={mediaStyle}
      />
    </button>
    <div class="media-tile__caption">
      <span class="media-tile__name">{upload.filename}</span>
      <a
        class="media-tile__chip"
        href={url}
        download={upload.filename}
        aria-label={`Download ${upload.filename}`}
        onclick={(event) => event.stopPropagation()}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 4v12m0 0 4-4m-4 4-4-4M5 20h14"
          />
        </svg>
      </a>
    </div>
  </div>
{:else if isVideo}
  <div class="media-tile media-tile--video" class:is-started={started}>
    <video
      bind:this={videoEl}
      preload="metadata"
      playsinline
      controls={started}
      controlslist="nodownload"
      aria-label={upload.filename}
      width={upload.width || undefined}
      height={upload.height || undefined}
      style={mediaStyle}
      onplay={handlePlay}
      onloadedmetadata={handleLoadedMetadata}
    >
      <source src={url} type={contentType} />
    </video>
    {#if !started}
      <button
        type="button"
        class="media-tile__play"
        aria-label={`Play ${upload.filename}`}
        onclick={startPlayback}
      >
        <span class="media-tile__play-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26">
            <path fill="currentColor" d="M8 5.5v13l11-6.5z" />
          </svg>
        </span>
      </button>
      {#if durationLabel}
        <span class="media-tile__duration" aria-hidden="true">{durationLabel}</span>
      {/if}
    {/if}
    <div class="media-tile__caption">
      <span class="media-tile__name">{upload.filename}</span>
      <a
        class="media-tile__chip"
        href={url}
        download={upload.filename}
        aria-label={`Download ${upload.filename}`}
        onclick={(event) => event.stopPropagation()}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 4v12m0 0 4-4m-4 4-4-4M5 20h14"
          />
        </svg>
      </a>
    </div>
  </div>
{:else if isAudio}
  <div class="audio-attachment">
    <div class="audio-attachment__meta">
      <span class="file-icon" aria-hidden="true">♪</span>
      <span>
        <strong>{upload.filename}</strong>
        <small>{formatBytes(upload.byte_size)}</small>
      </span>
    </div>
    <audio controls preload="metadata" src={url}>
      <a href={url} target="_blank" rel="noreferrer">{upload.filename}</a>
    </audio>
  </div>
{:else if canPreviewDocument}
  <div class="document-attachment">
    <button
      type="button"
      class="document-attachment__thumbnail"
      data-artifact-upload-id={upload.id}
      aria-label={`Open ${upload.filename}`}
      onclick={() => onOpenArtifact(upload)}
    >
      <span>{documentLabel}</span>
    </button>
    <div class="document-attachment__meta">
      <button
        type="button"
        class="document-attachment__title"
        data-artifact-upload-id={upload.id}
        onclick={() => onOpenArtifact(upload)}
      >
        {upload.filename}
      </button>
      <small>{formatBytes(upload.byte_size)}</small>
    </div>
    <a
      class="document-attachment__download"
      href={url}
      download={upload.filename}
      aria-label={`Download ${upload.filename}`}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 4v12m0 0 4-4m-4 4-4-4M5 20h14"
        />
      </svg>
    </a>
  </div>
{:else}
  <a class="file-attachment" href={url} download={upload.filename} aria-label={`Download ${upload.filename}`}>
    <span class="file-icon" aria-hidden="true">↧</span>
    <span>
      <strong>{upload.filename}</strong>
      <small>{formatBytes(upload.byte_size)}</small>
    </span>
  </a>
{/if}

{#if imageContextMenu}
  <div
    bind:this={imageContextMenuElement}
    class="image-viewer__context-menu"
    role="menu"
    tabindex="-1"
    aria-label="Image options"
    aria-busy={copyingImage}
    style={`left: ${imageContextMenu.x}px; top: ${imageContextMenu.y}px;`}
    oncontextmenu={(event) => event.preventDefault()}
    onkeydown={handleImageContextMenuKeydown}
  >
    <button type="button" role="menuitem" aria-disabled={copyingImage} onclick={copyInlineImage}
      >Copy image</button
    >
    <button
      type="button"
      role="menuitem"
      aria-disabled={copyingImage}
      onclick={copyInlineAttachmentLink}
    >Copy attachment link</button>
    {#if imageContextMenuStatus}
      <p role="status">{imageContextMenuStatus}</p>
    {/if}
  </div>
{/if}
