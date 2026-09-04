<script lang="ts">
  import { resolvedColorMode } from "../../lib/appearance";
  import { avatarImageSource, avatarURLForColorMode } from "../../lib/chat/avatars";
  import { avatarHue, avatarInitial } from "../../lib/chat/people";

  type AvatarLoading = "eager" | "lazy";
  type AvatarFetchPriority = "high" | "low" | "auto";

  type Props = {
    id?: string | null;
    name?: string | null;
    src?: string | null;
    lightSrc?: string | null;
    class?: string;
    size?: number;
    loading?: AvatarLoading;
    fetchPriority?: AvatarFetchPriority;
    buttonLabel?: string;
    imagePosition?: string;
    onclick?: (event: MouseEvent) => void;
  };

  let {
    id,
    name,
    src,
    lightSrc,
    class: className = "avatar",
    size = 40,
    loading = "lazy",
    fetchPriority = "low",
    buttonLabel,
    imagePosition = "50% 50%",
    onclick,
  }: Props = $props();

  let failedSource = $state("");

  const source = $derived(
    avatarImageSource(avatarURLForColorMode(src, lightSrc, $resolvedColorMode)),
  );
  const showImage = $derived(source !== "" && failedSource !== source);
  const hue = $derived(avatarHue(id || name || source || "avatar"));
  const initial = $derived(avatarInitial(name));

  function onImageError() {
    failedSource = source;
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
