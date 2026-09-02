<script lang="ts">
  import { onMount } from "svelte";
  import type { Channel } from "../../lib/types";
  import {
    mountPinnedPanelIsland,
    type PinnedPanelIsland,
    type PinnedPanelProps,
  } from "./PinnedPanelIsland";

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

  let hostElement: HTMLDivElement | null = $state(null);
  let island: PinnedPanelIsland | null = null;

  function islandProps(): PinnedPanelProps {
    return {
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
    };
  }

  onMount(() => {
    if (!hostElement) return;
    island = mountPinnedPanelIsland(hostElement, islandProps());
    return () => island?.unmount();
  });

  $effect(() => {
    island?.render(islandProps());
  });
</script>

<div class="pinned-panel-island" bind:this={hostElement}></div>
