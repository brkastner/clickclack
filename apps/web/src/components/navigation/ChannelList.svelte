<script lang="ts">
  import { tick } from "svelte";
  import { channelDisplayTitle } from "../../lib/chat/channels";
  import {
    moveChannelInOrder,
    orderProfileShortcuts,
    profileAvatarURL,
    profileHeaderTarget,
    type ChannelProfileShortcut,
  } from "../../lib/chat/people";
  import type { Channel, DirectConversation, User } from "../../lib/types";
  import Avatar from "../avatar/Avatar.svelte";

  type Props = {
    workspaceID: string;
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
    onCreateChannel: () => void;
    onToggle: () => void;
    onReorder: (channelIDs: string[]) => void;
    onAssignProfile: (channelID: string, profile: ChannelProfileShortcut | null) => void;
  };

  type ChannelGroup = {
    key: string;
    label: string;
    channels: Channel[];
    profile?: ChannelProfileShortcut;
    // A profile's own source channel is represented by the group header, so it
    // is held here instead of being repeated as a row inside the group.
    sourceChannel?: Channel;
  };

  let {
    workspaceID,
    expanded,
    channels,
    profiles,
    directConversations,
    people,
    selectedChannelID,
    selectedDirectID,
    workingConversationIDs,
    hrefForChannel,
    hrefForDirect,
    onSelectChannel,
    onSelectDirect,
    onCreateChannel,
    onToggle,
    onReorder,
    onAssignProfile,
  }: Props = $props();

  const GROUP_STORAGE_PREFIX = "clickclack:sidebar-channel-groups:v1:";
  const ARCHIVED_GROUP_KEY = "archived";
  const MAX_DISCLOSURE_GROUPS = 1_000;
  const MAX_DISCLOSURE_KEY_LENGTH = 256;

  let draggedChannelID = $state("");
  let draggedGroupKey = $state("");
  let dropTargetID = $state("");
  let dropGroupKey = $state("");
  let dropBefore = $state(true);
  let dragGestureActive = $state(false);
  let moveMenuChannelID = $state("");
  let moveMenuElement = $state<HTMLDivElement>();
  let moveMenuTrigger: HTMLButtonElement | undefined;
  let moveAnnouncement = $state("");
  let draggedProfileChannelID = $state("");
  let profileDropTargetID = $state("");
  let profileDropBefore = $state(true);
  let groupDisclosure = $state<Record<string, boolean>>({});

  const activeChannels = $derived(channels.filter((channel) => !channel.archived_at));
  const archivedChannels = $derived(channels.filter((channel) => Boolean(channel.archived_at)));
  const unsectionedChannels = $derived(
    activeChannels.filter((channel) => !channel.sidebar_section?.trim()),
  );
  const sectionGroups = $derived.by(() => {
    const grouped = new Map<string, Channel[]>();
    for (const channel of activeChannels) {
      const section = channel.sidebar_section?.trim();
      if (!section) continue;
      const group = grouped.get(section) ?? [];
      group.push(channel);
      grouped.set(section, group);
    }
    const orderedProfiles = orderProfileShortcuts(
      profiles,
      channels.map((channel) => channel.id),
    );
    const profileGroups = orderedProfiles.map((profile): ChannelGroup => {
      const key = `profile:${profile.channel_id}`;
      const profileChannels = grouped.get(key) ?? [];
      grouped.delete(key);
      return {
        key,
        label: profile.display_name,
        channels: profileChannels.filter((channel) => channel.id !== profile.channel_id),
        profile,
        sourceChannel: profileChannels.find((channel) => channel.id === profile.channel_id),
      };
    });
    const ordinaryGroups = [...grouped.entries()]
      .map(([section, groupedChannels]): ChannelGroup => ({
        key: `section:${section}`,
        label: section,
        channels: groupedChannels,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    return [...profileGroups, ...ordinaryGroups];
  });
  const ordinaryGroups = $derived(sectionGroups.filter((group) => !group.profile));
  const priorityChannels = $derived(
    channels.filter(
      (channel) =>
        !channel.sidebar_section?.startsWith("profile:") &&
        ((channel.id === selectedChannelID && !selectedDirectID) ||
          (channel.unread_count || 0) > 0 ||
          workingConversationIDs.has(channel.id)),
    ),
  );

  function parseDisclosureState(raw: string | null): Record<string, boolean> {
    if (!raw) return {};
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const entries = Object.entries(value as Record<string, unknown>);
      if (
        entries.length > MAX_DISCLOSURE_GROUPS ||
        entries.some(
          ([key, expanded]) =>
            key.length > MAX_DISCLOSURE_KEY_LENGTH || typeof expanded !== "boolean",
        )
      ) {
        return {};
      }
      return Object.fromEntries(entries) as Record<string, boolean>;
    } catch {
      return {};
    }
  }

  function disclosureStorageKey(id: string): string {
    return `${GROUP_STORAGE_PREFIX}${id}`;
  }

  function loadDisclosureState(id: string): Record<string, boolean> {
    if (!id) return {};
    try {
      return parseDisclosureState(window.localStorage.getItem(disclosureStorageKey(id)));
    } catch {
      return {};
    }
  }

  function groupExpanded(key: string): boolean {
    const saved = groupDisclosure[key];
    return typeof saved === "boolean" ? saved : key !== ARCHIVED_GROUP_KEY;
  }

  function toggleGroup(key: string) {
    groupDisclosure = { ...groupDisclosure, [key]: !groupExpanded(key) };
    if (!workspaceID) return;
    try {
      window.localStorage.setItem(
        disclosureStorageKey(workspaceID),
        JSON.stringify(groupDisclosure),
      );
    } catch {
      // Storage is an enhancement; disclosures still work when unavailable.
    }
  }

  function handleDisclosureStorage(event: StorageEvent) {
    if (event.key !== disclosureStorageKey(workspaceID)) return;
    groupDisclosure = parseDisclosureState(event.newValue);
  }

  function visibleGroupChannels(group: ChannelGroup): Channel[] {
    return groupExpanded(group.key)
      ? group.channels
      : group.channels.filter(
          (channel) =>
            (channel.id === selectedChannelID && !selectedDirectID) ||
            (channel.unread_count || 0) > 0 ||
            workingConversationIDs.has(channel.id),
        );
  }

  // The header now stands in for the source channel, so its unread count has to
  // surface there instead of on a hidden row.
  function groupUnreadCount(group: ChannelGroup): number {
    return group.sourceChannel?.unread_count || 0;
  }

  // Canonical profiles (кай, пи) stand for the bot itself and open its DM;
  // persona profiles open the channel the header replaced.
  function headerTarget(group: ChannelGroup) {
    if (!group.profile) return null;
    return profileHeaderTarget(group.profile, people, directConversations);
  }

  function headerHref(group: ChannelGroup): string {
    const target = headerTarget(group);
    if (!target) return "";
    return target.kind === "direct" ? hrefForDirect(target.id) : hrefForChannel(target.id);
  }

  function headerIsActive(group: ChannelGroup): boolean {
    const target = headerTarget(group);
    if (!target) return false;
    return target.kind === "direct"
      ? selectedDirectID === target.id
      : selectedChannelID === target.id && !selectedDirectID;
  }

  function openHeaderTarget(group: ChannelGroup) {
    const target = headerTarget(group);
    if (!target) return;
    if (!groupExpanded(group.key)) toggleGroup(group.key);
    if (target.kind === "direct") onSelectDirect(target.id);
    else onSelectChannel(target.id);
  }

  function announceMove(message: string) {
    moveAnnouncement = "";
    queueMicrotask(() => {
      moveAnnouncement = message;
    });
  }

  function moveChannel(
    channelID: string,
    targetID: string,
    before: boolean,
    scopeChannels: Channel[],
  ) {
    if (!channelID || !targetID || channelID === targetID) return;
    const current = channels.map((channel) => channel.id);
    const order = moveChannelInOrder(current, channelID, targetID, before);
    if (order === current) return;
    onReorder(order);
    const moved = channels.find((channel) => channel.id === channelID);
    const scopeOrder = scopeChannels
      .map((channel) => channel.id)
      .filter((id) => id !== channelID);
    const scopeTarget = scopeOrder.indexOf(targetID);
    scopeOrder.splice(scopeTarget + (before ? 0 : 1), 0, channelID);
    if (moved) {
      announceMove(
        `Moved #${channelDisplayTitle(moved)} to position ${scopeOrder.indexOf(channelID) + 1} of ${scopeOrder.length}`,
      );
    }
  }

  function moveBy(channelID: string, offset: number, scopeChannels: Channel[]) {
    const index = scopeChannels.findIndex((channel) => channel.id === channelID);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= scopeChannels.length) return;
    moveChannel(channelID, scopeChannels[target].id, offset < 0, scopeChannels);
  }

  const profileGroups = $derived(sectionGroups.filter((group) => Boolean(group.profile)));

  // Profile headers reorder by moving their source channel in the same viewer
  // order that positions ordinary channels, so one stored order drives both.
  function moveProfileGroup(sourceID: string, targetID: string, before: boolean) {
    if (!sourceID || !targetID || sourceID === targetID) return;
    const current = channels.map((channel) => channel.id);
    const order = moveChannelInOrder(current, sourceID, targetID, before);
    if (order === current) return;
    onReorder(order);
    const moved = profileGroups.find((group) => group.profile?.channel_id === sourceID);
    if (!moved?.profile) return;
    const position =
      orderProfileShortcuts(
        profileGroups.flatMap((group) => (group.profile ? [group.profile] : [])),
        order,
      ).findIndex((profile) => profile.channel_id === sourceID) + 1;
    announceMove(
      `Moved ${moved.profile.display_name} to position ${position} of ${profileGroups.length}`,
    );
  }

  function moveProfileGroupBy(sourceID: string, offset: number) {
    const index = profileGroups.findIndex((group) => group.profile?.channel_id === sourceID);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= profileGroups.length) return;
    const targetID = profileGroups[target].profile?.channel_id || "";
    moveProfileGroup(sourceID, targetID, offset < 0);
  }

  function handleProfileHeaderDragStart(event: DragEvent, sourceID: string) {
    dragGestureActive = true;
    moveMenuChannelID = "";
    draggedProfileChannelID = sourceID;
    event.dataTransfer?.setData("text/plain", sourceID);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function handleProfileHeaderDragOver(event: DragEvent, sourceID: string) {
    if (!draggedProfileChannelID || draggedProfileChannelID === sourceID) return;
    event.preventDefault();
    const header = event.currentTarget as HTMLElement;
    profileDropTargetID = sourceID;
    profileDropBefore = event.clientY < header.getBoundingClientRect().top + header.offsetHeight / 2;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function handleDragStart(event: DragEvent, channelID: string, groupKey: string) {
    dragGestureActive = true;
    moveMenuChannelID = "";
    draggedChannelID = channelID;
    draggedGroupKey = groupKey;
    event.dataTransfer?.setData("text/plain", channelID);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(event: DragEvent, channelID: string, groupKey: string) {
    if (
      !draggedChannelID ||
      draggedChannelID === channelID ||
      draggedGroupKey !== groupKey
    ) {
      return;
    }
    event.preventDefault();
    const row = event.currentTarget as HTMLElement;
    dropGroupKey = "";
    dropTargetID = channelID;
    dropBefore = event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function handleProfileDragOver(event: DragEvent, group: ChannelGroup) {
    if (draggedProfileChannelID) return;
    if (!draggedChannelID || !group.profile || draggedGroupKey === group.key) return;
    event.preventDefault();
    dropTargetID = "";
    dropGroupKey = group.key;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function assignProfile(channelID: string, profile: ChannelProfileShortcut | null) {
    const channel = channels.find((candidate) => candidate.id === channelID);
    if (!channel || profiles.some((candidate) => candidate.channel_id === channelID)) return;
    onAssignProfile(channelID, profile);
    announceMove(
      profile
        ? `Moved #${channelDisplayTitle(channel)} under ${profile.display_name}`
        : `Removed profile from #${channelDisplayTitle(channel)}`,
    );
  }

  function clearDrag() {
    draggedChannelID = "";
    draggedGroupKey = "";
    dropTargetID = "";
    dropGroupKey = "";
    draggedProfileChannelID = "";
    profileDropTargetID = "";
  }

  function finishDrag() {
    clearDrag();
    window.setTimeout(() => {
      dragGestureActive = false;
    }, 0);
  }

  async function toggleMoveMenu(channelID: string, trigger: HTMLButtonElement) {
    if (dragGestureActive) return;
    if (moveMenuChannelID === channelID) {
      moveMenuChannelID = "";
      return;
    }
    moveMenuTrigger = trigger;
    moveMenuChannelID = channelID;
    await tick();
    moveMenuElement?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }

  async function closeMoveMenu(restoreFocus = false) {
    moveMenuChannelID = "";
    if (!restoreFocus) return;
    await tick();
    moveMenuTrigger?.focus();
  }

  function moveFromMenu(channelID: string, offset: number, scopeChannels: Channel[]) {
    moveBy(channelID, offset, scopeChannels);
    void closeMoveMenu(true);
  }

  function assignFromMenu(channelID: string, profile: ChannelProfileShortcut | null) {
    assignProfile(channelID, profile);
    void closeMoveMenu(true);
  }

  function shouldHandleClientNavigation(event: MouseEvent): boolean {
    return (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    );
  }

  $effect(() => {
    groupDisclosure = loadDisclosureState(workspaceID);
  });

  $effect(() => {
    if (!expanded) {
      moveMenuChannelID = "";
      clearDrag();
      dragGestureActive = false;
    }
  });
</script>

<svelte:window onstorage={handleDisclosureStorage} />

{#snippet channelRow(channel: Channel, scopeChannels: Channel[], groupKey: string, subdued: boolean, reorderable: boolean)}
  {@const unread = channel.unread_count || 0}
  {@const working = workingConversationIDs.has(channel.id)}
  {@const channelIndex = scopeChannels.findIndex((candidate) => candidate.id === channel.id)}
  {@const isProfileSource = profiles.some((profile) => profile.channel_id === channel.id)}
  <div
    class="channel-row"
    class:reorderable
    class:subdued
    role="listitem"
    class:dragging={draggedChannelID === channel.id}
    class:drop-before={dropTargetID === channel.id && dropBefore}
    class:drop-after={dropTargetID === channel.id && !dropBefore}
    ondragover={(event) => {
      if (reorderable) handleDragOver(event, channel.id, groupKey);
    }}
    ondrop={(event) => {
      event.preventDefault();
      if (!reorderable || draggedGroupKey !== groupKey) return;
      moveChannel(draggedChannelID, channel.id, dropBefore, scopeChannels);
      finishDrag();
    }}
    onfocusout={(event) => {
      if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
        moveMenuChannelID = "";
      }
    }}
  >
    {#if reorderable}
      <button
        type="button"
        class="channel-drag-handle"
        draggable="true"
        aria-label={`Move #${channelDisplayTitle(channel)}`}
        aria-describedby="channel-order-instructions"
        title="Move channel"
        aria-haspopup="menu"
        aria-expanded={moveMenuChannelID === channel.id}
        onclick={(event) => void toggleMoveMenu(channel.id, event.currentTarget)}
        ondragstart={(event) => handleDragStart(event, channel.id, groupKey)}
        ondragend={finishDrag}
        onkeydown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            moveMenuChannelID = "";
            moveBy(channel.id, event.key === "ArrowUp" ? -1 : 1, scopeChannels);
          } else if (event.key === "Escape") {
            moveMenuChannelID = "";
          }
        }}
      >
        <svg viewBox="0 0 12 16" width="12" height="16" aria-hidden="true">
          <circle cx="3" cy="4" r="1" /><circle cx="9" cy="4" r="1" />
          <circle cx="3" cy="8" r="1" /><circle cx="9" cy="8" r="1" />
          <circle cx="3" cy="12" r="1" /><circle cx="9" cy="12" r="1" />
        </svg>
      </button>
      {#if moveMenuChannelID === channel.id}
        <div
          class="channel-move-menu"
          role="menu"
          tabindex="-1"
          aria-label={`Move #${channelDisplayTitle(channel)}`}
          data-handles-escape
          bind:this={moveMenuElement}
          onkeydown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              void closeMoveMenu(true);
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={channelIndex <= 0}
            onclick={() => moveFromMenu(channel.id, -1, scopeChannels)}
          >Move up</button>
          <button
            type="button"
            role="menuitem"
            disabled={channelIndex < 0 || channelIndex >= scopeChannels.length - 1}
            onclick={() => moveFromMenu(channel.id, 1, scopeChannels)}
          >Move down</button>
          {#if !isProfileSource}
            {#each profiles as profile (profile.id)}
              <button
                type="button"
                role="menuitem"
                disabled={channel.sidebar_section === `profile:${profile.channel_id}`}
                onclick={() => assignFromMenu(channel.id, profile)}
              >Move under {profile.display_name}</button>
            {/each}
            {#if channel.sidebar_section?.startsWith("profile:")}
              <button
                type="button"
                role="menuitem"
                onclick={() => assignFromMenu(channel.id, null)}
              >Remove profile</button>
            {/if}
          {/if}
        </div>
      {/if}
    {/if}
    <a
      href={hrefForChannel(channel.id)}
      class="nav-item channel"
      class:active={channel.id === selectedChannelID && !selectedDirectID}
      class:has-unread={unread > 0 && !(channel.id === selectedChannelID && !selectedDirectID)}
      onclick={(event) => {
        if (!shouldHandleClientNavigation(event)) return;
        event.preventDefault();
        onSelectChannel(channel.id);
      }}
    >
      <span class="hash">#</span>
      <span class="nav-label">{channelDisplayTitle(channel)}</span>
      {#if working}
        <span
          class="sidebar-working-indicator"
          role="status"
          aria-label={`Agent is working in #${channelDisplayTitle(channel)}`}
          title="Agent is working"
        ></span>
      {/if}
      {#if channel.external_managed}
        <span class="managed-channel-marker" title="Externally managed" aria-label="Externally managed">
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.14-1.14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
          </svg>
        </span>
      {/if}
      {#if unread > 0 && !(channel.id === selectedChannelID && !selectedDirectID)}
        <span class="unread-badge" aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</span>
      {/if}
    </a>
  </div>
{/snippet}

{#snippet channelSubgroup(group: ChannelGroup, domID: string, subdued: boolean)}
  {@const groupIsExpanded = groupExpanded(group.key)}
  {@const visibleChannels = visibleGroupChannels(group)}
  {@const hasNestedChannels = group.channels.length > 0}
  {@const target = headerTarget(group)}
  {@const groupWorking = Boolean(
    (target && workingConversationIDs.has(target.id)) ||
      (group.sourceChannel && workingConversationIDs.has(group.sourceChannel.id)),
  )}
  <section
    class="channel-subgroup"
    role="group"
    class:archived-channel-group={subdued}
    class:profile-channel-group={Boolean(group.profile)}
    class:profile-drop-target={dropGroupKey === group.key}
    class:profile-drop-before={Boolean(group.profile) &&
      profileDropTargetID === group.profile?.channel_id &&
      profileDropBefore}
    class:profile-drop-after={Boolean(group.profile) &&
      profileDropTargetID === group.profile?.channel_id &&
      !profileDropBefore}
    ondragover={(event) => {
      if (group.profile && draggedProfileChannelID) {
        handleProfileHeaderDragOver(event, group.profile.channel_id);
        return;
      }
      handleProfileDragOver(event, group);
    }}
    ondrop={(event) => {
      if (group.profile && draggedProfileChannelID) {
        event.preventDefault();
        moveProfileGroup(draggedProfileChannelID, group.profile.channel_id, profileDropBefore);
        finishDrag();
        return;
      }
      if (!group.profile || !draggedChannelID || draggedGroupKey === group.key) return;
      event.preventDefault();
      assignProfile(draggedChannelID, group.profile);
      finishDrag();
    }}
  >
    <div class="channel-subgroup-header" class:profile-subgroup-header={Boolean(group.sourceChannel)}>
      {#if group.sourceChannel && hasNestedChannels}
        <button
          type="button"
          class="channel-subgroup-caret"
          aria-expanded={groupIsExpanded}
          aria-controls={domID}
          aria-label={`${groupIsExpanded ? "Collapse" : "Expand"} ${group.label}`}
          onclick={() => {
            if (dragGestureActive) return;
            toggleGroup(group.key);
          }}
        >
          <span class="caret" aria-hidden="true">▾</span>
        </button>
      {/if}
      <svelte:element
      this={group.sourceChannel ? "a" : "button"}
      role={group.sourceChannel ? undefined : "button"}
      href={group.sourceChannel ? headerHref(group) : undefined}
      type={group.sourceChannel ? undefined : "button"}
      class="channel-subgroup-toggle"
      class:profile-reorderable={Boolean(group.profile)}
      class:profile-source-link={Boolean(group.sourceChannel)}
      class:active={Boolean(group.sourceChannel) && headerIsActive(group)}
      aria-expanded={group.sourceChannel ? undefined : groupIsExpanded}
      aria-controls={group.sourceChannel ? undefined : domID}
      aria-current={group.sourceChannel && headerIsActive(group) ? "page" : undefined}
      draggable={group.profile ? "true" : "false"}
      aria-describedby={group.profile ? "channel-order-instructions" : undefined}
      ondragstart={(event: DragEvent) => {
        if (group.profile) handleProfileHeaderDragStart(event, group.profile.channel_id);
      }}
      ondragend={finishDrag}
      onkeydown={(event: KeyboardEvent) => {
        if (!group.profile) return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        if (!event.altKey) return;
        event.preventDefault();
        moveProfileGroupBy(group.profile.channel_id, event.key === "ArrowUp" ? -1 : 1);
      }}
      onclick={(event: MouseEvent) => {
        if (dragGestureActive) {
          event.preventDefault();
          return;
        }
        // A profile header stands in for its source channel: open that channel
        // and reveal the children instead of toggling the disclosure shut.
        if (group.sourceChannel) {
          if (!shouldHandleClientNavigation(event)) return;
          event.preventDefault();
          openHeaderTarget(group);
          return;
        }
        toggleGroup(group.key);
      }}
    >
      {#if !group.sourceChannel && hasNestedChannels}
        <span class="caret" aria-hidden="true">▾</span>
      {/if}
      {#if group.profile}
        <Avatar
          class="channel-profile-avatar"
          id={group.profile.id}
          name={group.profile.display_name}
          src={profileAvatarURL(group.profile, people)}
          size={26}
          loading="eager"
          fetchPriority="auto"
        />
      {/if}
      <span>{group.label}</span>
      {#if groupWorking}
        <span
          class="sidebar-working-indicator"
          role="status"
          aria-label={`Agent is working in ${group.label}`}
          title="Agent is working"
        ></span>
      {/if}
      {#if groupUnreadCount(group) > 0}
        <span class="unread-badge" aria-label={`${groupUnreadCount(group)} unread`}>
          {groupUnreadCount(group) > 99 ? "99+" : groupUnreadCount(group)}
        </span>
      {:else if !groupWorking}
        <span class="channel-subgroup-count">{group.channels.length}</span>
      {/if}
    </svelte:element>
    </div>
    <div
      class="channel-subgroup-list"
      id={domID}
      role="list"
      hidden={!groupIsExpanded && visibleChannels.length === 0}
    >
      {#each visibleChannels as channel (channel.id)}
        {@render channelRow(channel, group.channels, group.key, subdued, groupIsExpanded)}
      {/each}
    </div>
  </section>
{/snippet}

<section class="nav-section sidebar-channel-navigation">
  <span id="channel-order-instructions" class="sr-only">
    Drag with a pointer, use Arrow Up and Arrow Down while focused, or open the move menu. Moves stay within the current channel section. On a profile header, hold Alt with Arrow Up or Arrow Down to reorder profiles.
  </span>

  <div class="sidebar-profile-groups">
    {#each profileGroups as group, index (group.key)}
      {@render channelSubgroup(group, `sidebar-profile-section-${index}`, false)}
    {/each}
  </div>

  <div
    class="section-title sidebar-channels-title"
    role="group"
    class:profile-drop-target={dropGroupKey === "unsectioned"}
    ondragover={(event) => {
      if (!draggedChannelID || !draggedGroupKey.startsWith("profile:")) return;
      event.preventDefault();
      dropTargetID = "";
      dropGroupKey = "unsectioned";
    }}
    ondrop={(event) => {
      if (!draggedChannelID || !draggedGroupKey.startsWith("profile:")) return;
      event.preventDefault();
      assignProfile(draggedChannelID, null);
      finishDrag();
    }}
  >
    <button type="button" class="section-toggle" aria-expanded={expanded} aria-controls="sidebar-channels-list" onclick={onToggle}>
      <span class="caret" aria-hidden="true">▾</span>
      <span class="label">Channels</span>
    </button>
    <button
      type="button"
      class="add-button"
      aria-label="Create channel"
      title="Create channel"
      onclick={onCreateChannel}
    >＋</button>
  </div>

  <div
    class="nav-list"
    id="sidebar-channels-list"
    hidden={!expanded && priorityChannels.length === 0}
  >
    {#if expanded}
      {#each unsectionedChannels as channel (channel.id)}
        {@render channelRow(channel, unsectionedChannels, "unsectioned", false, true)}
      {/each}
      {#each ordinaryGroups as group, index (group.key)}
        {@render channelSubgroup(group, `sidebar-channel-section-${index}`, false)}
      {/each}
      {#if archivedChannels.length > 0}
        {@render channelSubgroup(
          { key: ARCHIVED_GROUP_KEY, label: "Archived", channels: archivedChannels },
          "sidebar-archived-channels",
          true,
        )}
      {/if}
      {#if channels.length === 0}
        <p class="nav-empty">No channels yet</p>
      {/if}
    {:else}
      {#each priorityChannels as channel (channel.id)}
        {@render channelRow(channel, priorityChannels, "priority", Boolean(channel.archived_at), false)}
      {/each}
    {/if}
  </div>
  <span class="sr-only" aria-live="polite" aria-atomic="true">{moveAnnouncement}</span>
</section>
