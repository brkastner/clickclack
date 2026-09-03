<script lang="ts">
  let { data } = $props();

  const workspaceID = $derived(data.workspaceID);
  const view = $derived(data.view);
  const ViewComponent = $derived(data.component);
</script>

<svelte:head>
  <title>{view.label} · ClickClack</title>
</svelte:head>

{#if data.loadError}
  <div class="workspace-view__error" role="alert">{data.loadError}</div>
{:else}
  {#key `${workspaceID}:${view.slug}`}
    <ViewComponent {workspaceID} />
  {/key}
{/if}
