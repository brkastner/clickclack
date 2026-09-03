<script lang="ts">
  import ViewScaffold from "./ViewScaffold.svelte";
  import type { WorkspaceViewProps } from "$lib/views";

  let { workspaceID }: WorkspaceViewProps = $props();
</script>

<ViewScaffold
  title="Home"
  description="Recent activity across this workspace."
>
  <div class="home-view__placeholder">
    <p>Nothing here yet.</p>
    <p class="home-view__hint">
      This view is the first surface on the workspace view route. What it shows
      is still open; the route, registry, and shell around it are not.
    </p>
  </div>
</ViewScaffold>

<style>
  .home-view__placeholder {
    display: grid;
    gap: 0.5rem;
    padding: 2rem;
    border: 1px dashed var(--border, #d4d4d8);
    border-radius: var(--radius-lg, 12px);
    color: var(--text-muted, #71717a);
  }

  .home-view__hint {
    max-width: 46ch;
    font-size: 0.875rem;
  }
</style>
