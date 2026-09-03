<script lang="ts">
  import ReactIslandHost from "../ReactIslandHost.svelte";
  import type { Channel } from "../../lib/types";
  import { mountPinnedPanelIsland, type PinnedPanelProps } from "./PinnedPanelIsland";

  type Props = PinnedPanelProps & {
    channel?: Channel;
  };

  let {
    messages,
    loading = false,
    error = "",
    topics = [],
    mentionPeople = [],
    mentionAttentionUserID,
    maxPins = 100,
    onClose,
    onOpenThread,
    onOpenImage,
    onOpenArtifact,
    onUnpin,
    onSelectTopic,
  }: Props = $props();

  const islandProps: PinnedPanelProps = $derived({
    messages,
    loading,
    error,
    topics,
    mentionPeople,
    mentionAttentionUserID,
    maxPins,
    onClose,
    onOpenThread,
    onOpenImage,
    onOpenArtifact,
    onUnpin,
    onSelectTopic,
  });
</script>

<ReactIslandHost
  mount={mountPinnedPanelIsland}
  props={islandProps}
  class="pinned-panel-island"
/>
