<script lang="ts">
  import { onMount } from "svelte";
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
        style:transform={`translate3d(${imageOffsetX}%, 0, 0) scale(${imageScale})`}
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
        style:transform={`translate3d(${imageOffsetX}%, 0, 0) scale(${imageScale})`}
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
