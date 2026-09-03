<script lang="ts">
  import type { Snippet } from "svelte";

  // Shared chrome for a view's content area: title, optional description, an
  // actions slot in the header, and the body. A view is free to skip this and
  // render whatever it wants, but using it keeps headers consistent.
  type Props = {
    title: string;
    description?: string;
    actions?: Snippet;
    children?: Snippet;
  };

  let { title, description = "", actions, children }: Props = $props();
</script>

<section class="view-scaffold">
  <header class="view-scaffold__header">
    <div class="view-scaffold__heading">
      <h1>{title}</h1>
      {#if description}
        <p>{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="view-scaffold__actions">
        {@render actions()}
      </div>
    {/if}
  </header>

  <div class="view-scaffold__body">
    {@render children?.()}
  </div>
</section>
