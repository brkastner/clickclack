<script lang="ts">
  import type { Topic } from "../../lib/types";

  type Props = {
    topic?: Topic;
    onSelect?: (topicID: string) => void;
  };

  let { topic, onSelect }: Props = $props();
</script>

{#if topic}
  {#if onSelect}
    <button
      type="button"
      class="message-topic"
      aria-label={`Filter by topic ${topic.name}`}
      onclick={(event) => {
        event.stopPropagation();
        onSelect(topic.id);
      }}>{topic.name}</button
    >
  {:else}
    <span class="message-topic">{topic.name}</span>
  {/if}
{/if}
