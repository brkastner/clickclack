<script lang="ts">
  import { tick } from "svelte";
  import { channelDisplayTitle } from "../../lib/chat/channels";
  import { directConversationForUser, moveChannelInOrder, type ChannelProfileShortcut } from "../../lib/chat/people";
  import type { Channel, DirectConversation, User } from "../../lib/types";
  import Avatar from "../avatar/Avatar.svelte";

  type Props = {
    workspaceID: string;
    variant?: "active" | "archived";
    expanded: boolean;
    channels: Channel[];
    profiles: ChannelProfileShortcut[];
    directConversations: DirectConversation[];
    people: User[];
    selectedChannelID: string;
    selectedDirectID: string;
    workingConversationIDs: Set<string>;
    hrefForChannel: (channelID: string) => string;
    hrefForDirect: (conversationID: string) => string;
    onSelectChannel: (channelID: string) => void;
    onSelectDirect: (conversationID: string) => void;
    onStartDirect: (memberID: string) => void;
    onCreateChannel: () => void;
    onToggle: () => void;
    onReorder: (channelIDs: string[]) => void;
    onAssignProfile: (channelID: string, profile: ChannelProfileShortcut | null) => void;
  };

  let {
    variant = "active", expanded, channels, profiles, directConversations, selectedChannelID, selectedDirectID,
    workingConversationIDs, hrefForChannel, hrefForDirect, onSelectChannel, onSelectDirect, onStartDirect,
    onCreateChannel, onToggle, onReorder, onAssignProfile,
  }: Props = $props();

  let moveMenuChannelID = $state("");
  let moveAnnouncement = $state("");
  let moveMenuElement = $state<HTMLDivElement>();
  let moveMenuTrigger: HTMLButtonElement | undefined;
  let draggedChannelID = $state("");
  let draggedGroupKey = $state("");
  let dropTargetID = $state("");
  let dropBefore = $state(true);
  let dropGroupKey = $state("");

  const activeChannels = $derived(channels.filter((channel) => !channel.archived_at));
  const archivedChannels = $derived(channels.filter((channel) => Boolean(channel.archived_at)));
  const assignedChannelIDs = $derived(new Set(activeChannels.filter((channel) => (channel.bot_assignments?.length ?? 0) > 0).map((channel) => channel.id)));
  const unsectionedChannels = $derived(activeChannels.filter((channel) =>
    !assignedChannelIDs.has(channel.id) && !channel.sidebar_section?.trim(),
  ));
  const ordinarySectionGroups = $derived.by(() => {
    const grouped = new Map<string, Channel[]>();
    for (const channel of activeChannels) {
      const section = channel.sidebar_section?.trim();
      if (assignedChannelIDs.has(channel.id) || !section) continue;
      grouped.set(section, [...(grouped.get(section) || []), channel]);
    }
    return [...grouped.entries()]
      .map(([label, channels]) => ({ label, channels }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  });
  const botGroups = $derived(profiles.map((profile) => ({
    profile,
    channels: activeChannels.filter((channel) => channel.bot_assignments?.some((assignment) => assignment.bot_user_id === profile.bot_user_id)),
  })).filter((group) => group.channels.length > 0));
  const visibleChannels = $derived(variant === "archived" ? archivedChannels : activeChannels);
  const priorityChannels = $derived(visibleChannels.filter((channel) =>
    (channel.id === selectedChannelID && !selectedDirectID) || (channel.unread_count || 0) > 0 || workingConversationIDs.has(channel.id),
  ));
  const listID = $derived(variant === "archived" ? "sidebar-archived-channels-list" : "sidebar-channels-list");
  const orderInstructionsID = $derived(variant === "archived" ? "archived-channel-order-instructions" : "channel-order-instructions");

  function shouldHandleClientNavigation(event: MouseEvent): boolean {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  }

  function announceMove(message: string) {
    moveAnnouncement = "";
    queueMicrotask(() => { moveAnnouncement = message; });
  }

  function moveChannel(channelID: string, targetID: string, before: boolean) {
    const current = channels.map((channel) => channel.id);
    const order = moveChannelInOrder(current, channelID, targetID, before);
    if (order === current) return;
    onReorder(order);
    const moved = channels.find((channel) => channel.id === channelID);
    if (moved) announceMove(`Moved #${channelDisplayTitle(moved)} to position ${order.indexOf(channelID) + 1} of ${order.length}`);
  }

  function moveBy(channelID: string, offset: number, scope: Channel[]) {
    const index = scope.findIndex((channel) => channel.id === channelID);
    const target = index + offset;
    if (index >= 0 && target >= 0 && target < scope.length) moveChannel(channelID, scope[target].id, offset < 0);
  }

  async function toggleMoveMenu(channelID: string, trigger: HTMLButtonElement) {
    if (moveMenuChannelID === channelID) { moveMenuChannelID = ""; return; }
    moveMenuTrigger = trigger;
    moveMenuChannelID = channelID;
    await tick();
    moveMenuElement?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }

  async function closeMoveMenu(restoreFocus = false) {
    moveMenuChannelID = "";
    if (restoreFocus) { await tick(); moveMenuTrigger?.focus(); }
  }

  function assignmentFor(channel: Channel): ChannelProfileShortcut | undefined {
    const id = channel.bot_assignments?.[0]?.bot_user_id;
    return profiles.find((profile) => profile.bot_user_id === id);
  }

  function assign(channel: Channel, profile: ChannelProfileShortcut | null) {
    onAssignProfile(channel.id, profile);
    void closeMoveMenu(true);
  }

  // Dragging a channel onto another group's header or list reassigns it.
  // Same-group drags stay row-level reorders.
  function canDropOnGroup(groupKey: string): boolean {
    return Boolean(draggedChannelID) && draggedGroupKey !== groupKey && draggedGroupKey !== "archived";
  }

  function groupDragOver(event: DragEvent, groupKey: string) {
    if (!canDropOnGroup(groupKey)) return;
    event.preventDefault();
    dropGroupKey = groupKey;
  }

  function groupDrop(event: DragEvent, groupKey: string, profile: ChannelProfileShortcut | null) {
    event.preventDefault();
    const id = draggedChannelID;
    const from = draggedGroupKey;
    draggedChannelID = "";
    draggedGroupKey = "";
    dropGroupKey = "";
    dropTargetID = "";
    if (!id || !canDropOnGroupKey(from, groupKey)) return;
    onAssignProfile(id, profile);
  }

  function canDropOnGroupKey(from: string, to: string): boolean {
    return from !== to && from !== "archived";
  }
</script>

{#snippet channelRow(channel: Channel, scope: Channel[], groupKey: string, subdued = false)}
  {@const unread = channel.unread_count || 0}
  {@const index = scope.findIndex((candidate) => candidate.id === channel.id)}
  <div class="channel-row" class:subdued class:reorderable={expanded} role="listitem" class:drop-before={dropTargetID === channel.id && dropBefore} class:drop-after={dropTargetID === channel.id && !dropBefore}
    ondragover={(event) => { if (!draggedChannelID || draggedGroupKey !== groupKey || draggedChannelID === channel.id) return; event.preventDefault(); dropTargetID = channel.id; dropBefore = event.clientY < (event.currentTarget as HTMLElement).getBoundingClientRect().top + (event.currentTarget as HTMLElement).offsetHeight / 2; }}
    ondrop={(event) => { if (draggedGroupKey !== groupKey) return; event.preventDefault(); event.stopPropagation(); moveChannel(draggedChannelID, channel.id, dropBefore); draggedChannelID = ""; dropTargetID = ""; }}>
    {#if expanded}
      <button type="button" class="channel-drag-handle" draggable="true" aria-label={`Move #${channelDisplayTitle(channel)}`} aria-describedby={orderInstructionsID} title="Move channel" aria-haspopup="menu" aria-expanded={moveMenuChannelID === channel.id}
        onclick={(event) => void toggleMoveMenu(channel.id, event.currentTarget)}
        ondragstart={(event) => { draggedChannelID = channel.id; draggedGroupKey = groupKey; event.dataTransfer?.setData("text/plain", channel.id); }}
        ondragend={() => { draggedChannelID = ""; dropTargetID = ""; }}
        onkeydown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            moveMenuChannelID = "";
            moveBy(channel.id, event.key === "ArrowUp" ? -1 : 1, scope);
          } else if (event.key === "Escape") {
            moveMenuChannelID = "";
          }
        }}>
        <svg viewBox="0 0 12 16" width="12" height="16" aria-hidden="true"><circle cx="3" cy="4" r="1"/><circle cx="9" cy="4" r="1"/><circle cx="3" cy="8" r="1"/><circle cx="9" cy="8" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="9" cy="12" r="1"/></svg>
      </button>
      {#if moveMenuChannelID === channel.id}
        <div class="channel-move-menu" role="menu" tabindex="-1" aria-label={`Move #${channelDisplayTitle(channel)}`} bind:this={moveMenuElement}
          onkeydown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void closeMoveMenu(true); } }}>
          <button type="button" role="menuitem" disabled={index <= 0} onclick={() => { moveBy(channel.id, -1, scope); void closeMoveMenu(true); }}>Move up</button>
          <button type="button" role="menuitem" disabled={index < 0 || index >= scope.length - 1} onclick={() => { moveBy(channel.id, 1, scope); void closeMoveMenu(true); }}>Move down</button>
          {#each profiles as profile (profile.id)}
            <button type="button" role="menuitem" disabled={assignmentFor(channel)?.bot_user_id === profile.bot_user_id} onclick={() => assign(channel, profile)}>Move under {profile.display_name}</button>
          {/each}
          {#if assignmentFor(channel)}<button type="button" role="menuitem" onclick={() => assign(channel, null)}>Remove bot group</button>{/if}
        </div>
      {/if}
    {/if}
    <a href={hrefForChannel(channel.id)} class="nav-item channel" class:active={channel.id === selectedChannelID && !selectedDirectID} class:has-unread={unread > 0 && channel.id !== selectedChannelID}
      onclick={(event) => { if (!shouldHandleClientNavigation(event)) return; event.preventDefault(); onSelectChannel(channel.id); }}>
      <span class="hash">#</span><span class="nav-label">{channelDisplayTitle(channel)}</span>
      {#if workingConversationIDs.has(channel.id)}<span class="sidebar-working-indicator" role="status" aria-label={`Agent is working in #${channelDisplayTitle(channel)}`}></span>{/if}
      {#if unread > 0 && channel.id !== selectedChannelID}<span class="unread-badge" aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</span>{/if}
    </a>
  </div>
{/snippet}

{#if variant === "active" || archivedChannels.length > 0}
<section class="nav-section sidebar-channel-navigation" class:collapsed={!expanded}>
  {#if variant === "active"}
  <div class="sidebar-profile-groups">
    {#each botGroups as group (group.profile.bot_user_id)}
      {@const conversation = directConversationForUser(directConversations, group.profile.bot_user_id)}
      <section class="channel-subgroup profile-channel-group" role="group" class:profile-drop-target={dropGroupKey === `bot:${group.profile.bot_user_id}`}
        ondragover={(event) => groupDragOver(event, `bot:${group.profile.bot_user_id}`)}
        ondragleave={() => { if (dropGroupKey === `bot:${group.profile.bot_user_id}`) dropGroupKey = ""; }}
        ondrop={(event) => groupDrop(event, `bot:${group.profile.bot_user_id}`, group.profile)}>
        <div class="channel-subgroup-header profile-subgroup-header">
          <a href={conversation ? hrefForDirect(conversation.id) : "#"} class="channel-subgroup-toggle profile-source-link" class:active={conversation?.id === selectedDirectID}
            onclick={(event) => { event.preventDefault(); if (conversation) onSelectDirect(conversation.id); else onStartDirect(group.profile.bot_user_id); }}>
            <Avatar
              class="channel-profile-avatar"
              id={group.profile.id}
              name={group.profile.display_name}
              src={group.profile.avatar_url}
              lightSrc={group.profile.avatar_url_light}
              size={26}
            />
            <span>{group.profile.display_name}</span><span class="channel-subgroup-count">{group.channels.length}</span>
          </a>
        </div>
        <div class="channel-subgroup-list" role="list">
          {#each group.channels as channel (channel.id)}{@render channelRow(channel, group.channels, `bot:${group.profile.bot_user_id}`)}{/each}
        </div>
      </section>
    {/each}
  </div>
  {/if}

  {#if variant === "active"}
    <div class="section-title sidebar-channels-title" role="group" class:profile-drop-target={dropGroupKey === "unsectioned"}
      ondragover={(event) => groupDragOver(event, "unsectioned")}
      ondragleave={() => { if (dropGroupKey === "unsectioned") dropGroupKey = ""; }}
      ondrop={(event) => groupDrop(event, "unsectioned", null)}>
      <button type="button" class="section-toggle" aria-expanded={expanded} aria-controls={listID} onclick={onToggle}><span class="caret" aria-hidden="true">▾</span><span class="label">Channels</span></button>
      <button type="button" class="add-button" aria-label="Create channel" title="Create channel" onclick={onCreateChannel}>＋</button>
    </div>
  {:else}
    <div class="section-title">
      <button type="button" class="section-toggle" aria-expanded={expanded} aria-controls={listID} onclick={onToggle}>
        <span class="caret" aria-hidden="true">▾</span>
        <span class="label">Archived</span>
      </button>
    </div>
  {/if}
  <div class="nav-list" id={listID} role="list" hidden={!expanded && priorityChannels.length === 0}>
    {#if expanded}
      <span id={orderInstructionsID} class="sr-only">Drag with a pointer, use Arrow Up and Arrow Down while focused, or open the move menu.</span>
      {#if variant === "archived"}
        {#each archivedChannels as channel (channel.id)}{@render channelRow(channel, archivedChannels, "archived", true)}{/each}
      {:else}
        {#each unsectionedChannels as channel (channel.id)}{@render channelRow(channel, unsectionedChannels, "unsectioned")}{/each}
        {#each ordinarySectionGroups as group (group.label)}
          <section class="channel-subgroup" role="group" aria-label={group.label}>
            <p class="section-label">{group.label}</p>
            {#each group.channels as channel (channel.id)}{@render channelRow(channel, group.channels, `section:${group.label}`)}{/each}
          </section>
        {/each}
      {/if}
    {:else}
      {#each priorityChannels as channel (channel.id)}{@render channelRow(channel, priorityChannels, variant === "archived" ? "archived" : "priority", variant === "archived")}{/each}
    {/if}
    <span class="sr-only" role="status" aria-live="polite">{moveAnnouncement}</span>
  </div>
</section>
{/if}
