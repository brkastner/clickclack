<script lang="ts">
  import { onMount } from "svelte";
  import { heroImageGeometry } from "../../lib/hero-image";
  import { botAvatarCandidates, botAvatarFiles, loadBotAvatarPacks, nextAvatarSource } from "../../lib/bot-avatar-packs";
  import { resolvedColorMode } from "../../lib/appearance";
  import { avatarImageSource, avatarURLForColorMode } from "../../lib/chat/avatars";
  import { avatarHue, avatarInitial } from "../../lib/chat/people";

  type AvatarLoading = "eager" | "lazy";
  type AvatarFetchPriority = "high" | "low" | "auto";

  type Props = {
    id?: string | null;
    isBot?: boolean;
    name?: string | null;
    src?: string | null;
    lightSrc?: string | null;
    class?: string;
    size?: number;
    loading?: AvatarLoading;
    fetchPriority?: AvatarFetchPriority;
    buttonLabel?: string;
    imagePosition?: string;
    imageTransformOrigin?: string;
    imageOffsetX?: number;
    imageScale?: number;
    hero?: boolean;
    onclick?: (event: MouseEvent) => void;
  };

  let {
    id,
    isBot = false,
    name,
    src,
    lightSrc,
    class: className = "avatar",
    size = 40,
    loading = "lazy",
    fetchPriority = "low",
    buttonLabel,
    imagePosition = "50% 50%",
    imageTransformOrigin = "50% 50%",
    imageOffsetX = 0,
    imageScale = 1,
    hero = false,
    onclick,
  }: Props = $props();

  onMount(() => {
    void loadBotAvatarPacks();
  });
  let failures = $state<{ key: string; sources: string[] }>({ key: "", sources: [] });
  const candidates = $derived(
    botAvatarCandidates(id, isBot, $botAvatarFiles,
      avatarURLForColorMode(src, lightSrc, $resolvedColorMode)).map(avatarImageSource),
  );
  const candidateKey = $derived(JSON.stringify([id, candidates]));
  const source = $derived(
    nextAvatarSource(candidates, failures.key === candidateKey ? failures.sources : []),
  );
  const showImage = $derived(source !== "");
  const hue = $derived(avatarHue(id || name || source || "avatar"));
  const initial = $derived(avatarInitial(name));

  let viewport = $state({ width: 0, height: 0 });
  let natural = $state({ source: "", width: 0, height: 0 });
  const geometry = $derived(hero && natural.source === source ? heroImageGeometry({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    scale: imageScale,
    positionX: Number.parseFloat(imagePosition.split(" ")[0]) / 100,
    positionY: Number.parseFloat(imagePosition.split(" ")[1]) / 100,
    originX: Number.parseFloat(imageTransformOrigin.split(" ")[0]) / 100,
    originY: Number.parseFloat(imageTransformOrigin.split(" ")[1]) / 100,
    offsetX: imageOffsetX,
  }) : null);
  const heroStyle = $derived(hero ? `position:absolute;max-width:none;max-height:none;visibility:${geometry ? "visible" : "hidden"};width:${geometry?.width ?? 0}px;height:${geometry?.height ?? 0}px;left:${geometry?.left ?? 0}px;top:${geometry?.top ?? 0}px;` : undefined);

  // Measure the viewport, not the cropped image element. Ordinary avatars need no observer.
  function measureHero(node: HTMLImageElement) {
    if (!hero || !node.parentElement) return;
    const parent = node.parentElement;
    const measure = () => {
      viewport = { width: parent.clientWidth, height: parent.clientHeight };
    };
    const loaded = () => {
      if (node.naturalWidth > 0) natural = { source, width: node.naturalWidth, height: node.naturalHeight };
    };
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    node.addEventListener("load", loaded);
    measure();
    if (node.complete) loaded();
    return { destroy() { observer.disconnect(); node.removeEventListener("load", loaded); } };
  }

  function onImageError() {
    failures = {
      key: candidateKey,
      sources: [...(failures.key === candidateKey ? failures.sources : []), source],
    };
  }
</script>

{#if buttonLabel}
  <button
    type="button"
    class={className}
    style="--hue: {hue}deg"
    aria-label={buttonLabel}
    {onclick}
  >
    {#if showImage}
      <img
        src={source}
        alt=""
        width={size}
        height={size}
        style:object-position={imagePosition}
        style:transform-origin={imageTransformOrigin}
        style={heroStyle}
        style:transform={hero ? "none" : `translate3d(${imageOffsetX}%, 0, 0) scale(${imageScale})`}
        use:measureHero
        {loading}
        decoding="async"
        fetchpriority={fetchPriority}
        onerror={onImageError}
      />
    {:else}
      {initial}
    {/if}
  </button>
{:else}
  <span class={className} style="--hue: {hue}deg" aria-hidden="true">
    {#if showImage}
      <img
        src={source}
        alt=""
        width={size}
        height={size}
        style:object-position={imagePosition}
        style:transform-origin={imageTransformOrigin}
        style={heroStyle}
        style:transform={hero ? "none" : `translate3d(${imageOffsetX}%, 0, 0) scale(${imageScale})`}
        use:measureHero
        {loading}
        decoding="async"
        fetchpriority={fetchPriority}
        onerror={onImageError}
      />
    {:else}
      {initial}
    {/if}
  </span>
{/if}
