<script lang="ts">
  import { onMount } from "svelte";
  import type { ImageViewerItem } from "../../lib/uploads";
  import {
    mountImageViewerIsland,
    type ImageViewerIsland,
  } from "./ImageViewerIsland";

  type Props = {
    items: ImageViewerItem[];
    initialIndex?: number;
    onClose: () => void;
  };

  let { items, initialIndex = 0, onClose }: Props = $props();
  let hostElement: HTMLDivElement;
  let island: ImageViewerIsland | null = null;

  onMount(() => {
    island = mountImageViewerIsland(hostElement, { items, initialIndex, onClose });
    return () => island?.unmount();
  });

  $effect(() => {
    island?.render({ items, initialIndex, onClose });
  });
</script>

<div class="image-viewer-island" bind:this={hostElement}></div>
