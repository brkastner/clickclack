<script lang="ts">
  import ReactIslandHost from "../ReactIslandHost.svelte";
  import type { ImageViewerItem } from "../../lib/uploads";
  import {
    mountImageViewerIsland,
    type ImageViewerProps,
  } from "./ImageViewerIsland";

  type Props = {
    items: ImageViewerItem[];
    initialIndex?: number;
    onClose: () => void;
  };

  let { items, initialIndex = 0, onClose }: Props = $props();

  const islandProps: ImageViewerProps = $derived({ items, initialIndex, onClose });
</script>

<ReactIslandHost
  mount={mountImageViewerIsland}
  props={islandProps}
  class="image-viewer-island"
/>
