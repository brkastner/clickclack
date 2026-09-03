<script lang="ts" generics="P extends object">
  import { onMount } from "svelte";
  import type { ReactIsland, ReactIslandMount } from "../lib/react-island";

  type Props = {
    /** The island's exported mount function. */
    mount: ReactIslandMount<P>;
    /** Props handed to the island. Reassign to re-render it. */
    props: P;
    /** Class applied to the host element the island renders into. */
    class?: string;
  };

  let { mount, props, class: hostClass = "" }: Props = $props();

  let hostElement: HTMLDivElement | null = $state(null);
  let island: ReactIsland<P> | null = null;

  onMount(() => {
    if (!hostElement) return;
    island = mount(hostElement, props);
    return () => {
      island?.unmount();
      island = null;
    };
  });

  $effect(() => {
    island?.render(props);
  });
</script>

<div class={hostClass} bind:this={hostElement}></div>
