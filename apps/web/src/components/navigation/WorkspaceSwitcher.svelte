<script lang="ts">
  import { tick } from "svelte";
  import { apiResourceURL } from "../../lib/api";
  import { workspaceInitial } from "../../lib/chat/people";
  import type { Workspace } from "../../lib/types";

  type Props = {
    workspaces: Workspace[];
    selectedWorkspaceID: string;
    createWorkspaceName: string;
    showWorkspaceCreate: boolean;
    connected?: boolean;
    titlebar?: boolean;
    hrefForWorkspace: (workspaceID: string) => string;
    onSelectWorkspace: (workspaceID: string) => void;
    onToggleWorkspaceCreate: () => void;
    onWorkspaceName: (value: string) => void;
    onCreateWorkspace: () => void;
    onOpenWorkspaceSettings: () => void;
  };

  let {
    workspaces,
    selectedWorkspaceID,
    createWorkspaceName,
    showWorkspaceCreate,
    connected = true,
    titlebar = false,
    hrefForWorkspace,
    onSelectWorkspace,
    onToggleWorkspaceCreate,
    onWorkspaceName,
    onCreateWorkspace,
    onOpenWorkspaceSettings,
  }: Props = $props();

  let root = $state<HTMLDivElement>();
  let createInput = $state<HTMLInputElement>();
  let open = $state(false);
  const selectedWorkspace = $derived(
    workspaces.find((workspace) => workspace.id === selectedWorkspaceID),
  );

  function shouldHandleClientNavigation(event: MouseEvent): boolean {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!open || !root || root.contains(event.target as Node)) return;
    open = false;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    open = false;
  }

  async function toggleWorkspaceCreate() {
    onToggleWorkspaceCreate();
    await tick();
    createInput?.focus();
  }
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

<div
  class="workspace-switcher"
  class:workspace-switcher--titlebar={titlebar}
  bind:this={root}
>
  <button
    type="button"
    class="workspace-switcher-trigger"
    aria-label="Switch workspace"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="workspace-switcher-icon" aria-hidden="true">
      {#if selectedWorkspace?.icon_url}
        <img src={apiResourceURL(selectedWorkspace.icon_url)} alt="" />
      {:else}
        {workspaceInitial(selectedWorkspace?.name || "ClickClack")}
      {/if}
    </span>
    <span class="workspace-switcher-label">
      <strong>{selectedWorkspace?.name || "Pick a workspace"}</strong>
      {#if !connected && !titlebar}<small>Connecting…</small>{/if}
    </span>
    <svg class="workspace-switcher-caret" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" />
    </svg>
  </button>

  {#if open}
    <div class="workspace-switcher-popover" role="menu" aria-label="Workspaces">
      <div class="workspace-switcher-list">
        {#each workspaces as workspace (workspace.id)}
          <a
            class="workspace-switcher-item"
            class:active={workspace.id === selectedWorkspaceID}
            aria-current={workspace.id === selectedWorkspaceID ? "page" : undefined}
            role="menuitem"
            href={hrefForWorkspace(workspace.id)}
            onclick={(event) => {
              if (!shouldHandleClientNavigation(event)) return;
              event.preventDefault();
              open = false;
              onSelectWorkspace(workspace.id);
            }}
          >
            <span class="workspace-switcher-item-icon" aria-hidden="true">
              {#if workspace.icon_url}
                <img src={apiResourceURL(workspace.icon_url)} alt="" />
              {:else}
                {workspaceInitial(workspace.name)}
              {/if}
            </span>
            <span>{workspace.name}</span>
            {#if workspace.id === selectedWorkspaceID}
              <span class="workspace-switcher-check" aria-hidden="true">✓</span>
            {/if}
          </a>
        {/each}
      </div>

      <div class="workspace-switcher-actions">
        <button
          type="button"
          role="menuitem"
          onclick={() => {
            open = false;
            onOpenWorkspaceSettings();
          }}
        >Workspace settings</button>
        <button type="button" role="menuitem" onclick={toggleWorkspaceCreate}>New workspace</button>
      </div>

      {#if showWorkspaceCreate}
        <form
          class="workspace-switcher-create"
          onsubmit={(event) => {
            event.preventDefault();
            onCreateWorkspace();
          }}
        >
          <input
            bind:this={createInput}
            value={createWorkspaceName}
            placeholder="Workspace name"
            aria-label="Workspace name"
            oninput={(event) => onWorkspaceName(event.currentTarget.value)}
          />
          <button type="submit">Create</button>
        </form>
      {/if}
    </div>
  {/if}
</div>
