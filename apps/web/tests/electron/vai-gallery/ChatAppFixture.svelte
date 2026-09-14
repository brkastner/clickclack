<script lang="ts">
  import ChatApp from "../../../src/ChatApp.svelte";
  import OutputGallery from "../../../src/components/outputs/OutputGallery.svelte";

  let path = $state("/app/w/channel");
  const segments = $derived(path.split("/").filter(Boolean));
  const workspaceID = $derived(segments[1] ?? "");
  const targetID = $derived(segments[2] ?? "");
  const gallery = $derived(segments[2] === "views" && segments[3] === "vai-gallery");
</script>

<svelte:window ongallery-test-navigation={(event) => { path = event.detail; }} />
{#if gallery}
  <div style="height: 760px"><OutputGallery workspaceID={workspaceID} /></div>
{:else}
  {#key path}<ChatApp routeWorkspaceID={workspaceID} routeTargetID={targetID} />{/key}
{/if}
