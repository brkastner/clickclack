<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { WORKSPACE_VIEWS, workspaceViewsPath } from "$lib/views";

  let { children } = $props();

  const workspaceID = $derived(page.params.workspaceID ?? "");
  const activeSlug = $derived(page.params.viewSlug ?? "");

  function backToChat() {
    void goto(`/app/${workspaceID}`);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    backToChat();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="workspace-views">
  <nav class="workspace-views__rail" aria-label="Workspace views">
    <button type="button" class="workspace-views__back" onclick={backToChat} title="Back to chat (Esc)">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
      <span>Chat</span>
    </button>

    <ul class="workspace-views__list">
      {#each WORKSPACE_VIEWS as view (view.id)}
        <li>
          <a
            class="workspace-views__item"
            class:is-active={activeSlug === view.slug}
            aria-current={activeSlug === view.slug ? "page" : undefined}
            href={workspaceViewsPath(workspaceID, view.slug)}
          >
            <span class="workspace-views__item-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                {#each view.icon as d, i (i)}
                  <path {d} />
                {/each}
              </svg>
            </span>
            <span class="workspace-views__item-label">{view.label}</span>
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <main class="workspace-views__content">
    {@render children?.()}
  </main>
</div>
