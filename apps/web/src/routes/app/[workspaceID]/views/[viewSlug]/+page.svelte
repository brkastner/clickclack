<script lang="ts">
  import ChatApp from "../../../../../ChatApp.svelte";

  let { data } = $props();

  const workspaceID = $derived(data.workspaceID);
  const view = $derived(data.view);
  const ViewComponent = $derived(data.component);
</script>

<svelte:head>
  <title>{view.label} · ClickClack</title>
</svelte:head>

{#if view.slug === "home"}
  {#key `${workspaceID}:${view.slug}`}
    <ChatApp
      routeWorkspaceID={workspaceID}
      routeViewSlug="home"
      routeViewComponent={ViewComponent}
    />
  {/key}
{:else if data.loadError}
  <div class="workspace-view__error" role="alert">{data.loadError}</div>
{:else}
  {#key `${workspaceID}:${view.slug}`}
    <ViewComponent {workspaceID} />
  {/key}
{/if}
