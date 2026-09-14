<script lang="ts">
  import OutputGallery from "../../../src/components/outputs/OutputGallery.svelte";
  import { gallerySource } from "../../../src/lib/output-gallery";
  let path = $state("");
  let target = $state("");
</script>
<svelte:window ongallery-test-navigation={(event) => { path = event.detail; target = gallerySource?.id ?? ""; }} />
{#if path}<p data-test-source={target}>{path}</p><button onclick={() => path = ""}>Return to gallery</button>
{:else}<div style="height: 760px"><OutputGallery workspaceID="workspace" /></div>{/if}
