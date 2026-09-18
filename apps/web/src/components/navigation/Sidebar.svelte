<script lang="ts">
  import { tick } from "svelte";
  import { DEFAULT_HOME_LINK, type HomeLink } from "../../lib/home-link";
  import Avatar from "../avatar/Avatar.svelte";
  import {
    defaultSections,
    parseSectionState,
    parseSidebarScrollTop,
    sectionStorageKey,
    sidebarScrollStorageKey,
    type SectionState,
  } from "../../lib/sidebar-sections";
  import { directConversationForUser, handleLabel, moveChannelInOrder, type ChannelProfileShortcut } from "../../lib/chat/people";
  import { botShelfPreferences, DEFAULT_BOT_SHELF_LIMIT, setBotShelfLimit, setBotShelfOrder } from "../../lib/appearance";
  import { parsePersonaChannelPins, pinnedPersonaChannel, type PersonaChannelPins } from "../../lib/personaNavigation";
  import type { Channel, DirectConversation, User, Workspace } from "../../lib/types";
  import ChannelList from "./ChannelList.svelte";
  import DirectMessageList from "./DirectMessageList.svelte";
  import WorkspaceSwitcher from "./WorkspaceSwitcher.svelte";
  import { WORKSPACE_VIEWS, workspaceViewsPath } from "../../lib/views";

  type Props = {
    workspaceID: string;
    activeViewSlug?: string;
    homeLink?: HomeLink;
    workspaceCreatePending?: boolean;
    workspaceCreateError?: string;
    workspaces: Workspace[];
    createWorkspaceName: string;
    showWorkspaceCreate: boolean;
    connected: boolean;
    showHeader?: boolean;
    channels: Channel[];
    directConversations: DirectConversation[];
    workingConversationIDs: Set<string>;
    recentPeople: User[];
    // Identity source for profile shortcuts; must match the list they were
    // built from so a profile's bot resolves consistently.
    profilePeople: User[];
    profileShortcuts: ChannelProfileShortcut[];
    currentUser: User | null;
    selectedChannelID: string;
    selectedDirectID: string;
    selectedProfile: User | null;
    hrefForWorkspace: (workspaceID: string) => string;
    hrefForChannel: (channelID: string) => string;
    hrefForDirect: (conversationID: string) => string;
    onSelectChannel: (channelID: string) => void;
    onCreateChannel: (profile?: ChannelProfileShortcut) => void;
    onAssignChannelProfile: (channelID: string, profile: ChannelProfileShortcut | null) => void;
    onSelectDirect: (conversationID: string) => void;
    onStartDirect: (memberID: string) => void;
    onCreateDirect: () => void;
    onHideDirect: (conversationID: string) => void;
    hiddenDirectTitle?: string;
    onUndoHideDirect: () => void;
    onOpenProfile: (profile: User) => void;
    onOpenSettings: () => void;
    onSelectWorkspace: (workspaceID: string) => void;
    onToggleWorkspaceCreate: () => void;
    onWorkspaceName: (value: string) => void;
    onCreateWorkspace: () => void;
    onOpenWorkspaceSettings: () => void;
    onNotepadHover?: (channelID: string, anchor: HTMLElement | null) => void;
  };

  let {
    workspaceID,
    activeViewSlug = "",
    homeLink = DEFAULT_HOME_LINK,
    workspaceCreatePending = false,
    workspaceCreateError = "",
    workspaces,
    createWorkspaceName,
    showWorkspaceCreate,
    connected,
    showHeader = true,
    channels,
    directConversations,
    workingConversationIDs,
    recentPeople,
    profilePeople,
    profileShortcuts,
    currentUser,
    selectedChannelID,
    selectedDirectID,
    selectedProfile,
    hrefForWorkspace,
    hrefForChannel,
    hrefForDirect,
    onSelectChannel,
    onCreateChannel,
    onAssignChannelProfile,
    onSelectDirect,
    onStartDirect,
    onCreateDirect,
    onHideDirect,
    hiddenDirectTitle,
    onUndoHideDirect,
    onOpenProfile,
    onOpenSettings,
    onSelectWorkspace,
    onToggleWorkspaceCreate,
    onWorkspaceName,
    onCreateWorkspace,
    onOpenWorkspaceSettings, onNotepadHover,
  }: Props = $props();

  // Shelf order: curated ids first (server preference), then any remaining
  // recent people in activity order. Limit 0 means the default cap.
  const shelfLimit = $derived($botShelfPreferences.limit || DEFAULT_BOT_SHELF_LIMIT);
  const orderedShelfPeople = $derived.by(() => {
    const byID = new Map(recentPeople.map((person) => [person.id, person]));
    const curated = $botShelfPreferences.order.map((id) => byID.get(id)).filter((p): p is User => Boolean(p));
    const seen = new Set(curated.map((p) => p.id));
    return [...curated, ...recentPeople.filter((p) => !seen.has(p.id))];
  });
  const displayedRecentPeople = $derived(orderedShelfPeople.slice(0, shelfLimit));
  const hiddenShelfCount = $derived(Math.max(0, orderedShelfPeople.length - shelfLimit));

  let draggedPersonID = $state("");
  let shelfDropTargetID = $state("");
  let shelfDropBefore = $state(true);

  function shelfDragOver(event: DragEvent, targetID: string) {
    if (!draggedPersonID || draggedPersonID === targetID) return;
    event.preventDefault();
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    shelfDropTargetID = targetID;
    shelfDropBefore = event.clientX < rect.left + rect.width / 2;
  }

  function shelfDrop(event: DragEvent, targetID: string) {
    event.preventDefault();
    const moving = draggedPersonID;
    draggedPersonID = "";
    shelfDropTargetID = "";
    if (!moving || moving === targetID) return;
    const fullOrder = orderedShelfPeople.map((p) => p.id);
    setBotShelfOrder(moveChannelInOrder(fullOrder, moving, targetID, shelfDropBefore));
  }

  let shelfMenu = $state<{ x: number; y: number } | null>(null);

  function openShelfMenu(event: MouseEvent) {
    event.preventDefault();
    shelfMenu = { x: event.clientX, y: event.clientY };
  }

  function closeShelfMenu() {
    shelfMenu = null;
  }

  function shelfShowAll() {
    setBotShelfLimit(orderedShelfPeople.length);
    closeShelfMenu();
  }

  function shelfHideAll() {
    setBotShelfLimit(0);
    closeShelfMenu();
  }

  let sections = $state<SectionState>(defaultSections());
  let sidebarScroll: HTMLDivElement;
  let restoredScrollWorkspaceID = "";

  function loadSidebarScroll(id: string): number {
    if (!id) return 0;
    try {
      return parseSidebarScrollTop(window.sessionStorage.getItem(sidebarScrollStorageKey(id)));
    } catch {
      return 0;
    }
  }

  function rememberSidebarScroll() {
    if (!workspaceID || !sidebarScroll) return;
    try {
      window.sessionStorage.setItem(
        sidebarScrollStorageKey(workspaceID),
        String(Math.floor(sidebarScroll.scrollTop)),
      );
    } catch {
      // A reload loses the position when storage is unavailable; scrolling still works.
    }
  }

  async function restoreSidebarScroll(id: string) {
    const top = loadSidebarScroll(id);
    await tick();
    if (workspaceID === id && sidebarScroll) sidebarScroll.scrollTop = top;
  }

  function loadSections(id: string): SectionState {
    if (!id) return defaultSections();
    try {
      return parseSectionState(window.localStorage.getItem(sectionStorageKey(id)));
    } catch {
      return defaultSections();
    }
  }

  function saveSections(next: SectionState) {
    sections = next;
    if (!workspaceID) return;
    try {
      window.localStorage.setItem(sectionStorageKey(workspaceID), JSON.stringify(next));
    } catch {
      // Storage is an enhancement; disclosures still work when it is unavailable.
    }
  }

  function toggleSection(section: "channels" | "directMessages" | "archived") {
    saveSections({ ...sections, [section]: !sections[section] });
  }

  function togglePersona(personaID: string) {
    saveSections({
      ...sections,
      personas: { ...sections.personas, [personaID]: !(sections.personas[personaID] ?? true) },
    });
  }

  $effect(() => {
    sections = loadSections(workspaceID);
  });

  $effect(() => {
    const id = workspaceID;
    if (!id || id === restoredScrollWorkspaceID) return;
    restoredScrollWorkspaceID = id;
    void restoreSidebarScroll(id);
  });

  const CHANNEL_ORDER_STORAGE_PREFIX = "clickclack:sidebar-channel-order:v1:";
  const MAX_CHANNEL_ORDER_STORAGE_LENGTH = 1_000_000;
  const MAX_CHANNEL_ORDER_IDS = 10_000;
  const MAX_CHANNEL_ID_LENGTH = 128;
  let channelOrder = $state<string[]>([]);

  function channelOrderStorageKey(workspaceID: string, userID: string): string {
    return `${CHANNEL_ORDER_STORAGE_PREFIX}${userID}:${workspaceID}`;
  }

  function parseChannelOrder(raw: string | null): string[] {
    if (!raw || raw.length > MAX_CHANNEL_ORDER_STORAGE_LENGTH) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) &&
        parsed.length <= MAX_CHANNEL_ORDER_IDS &&
        parsed.every((id) => typeof id === "string" && id.length <= MAX_CHANNEL_ID_LENGTH)
        ? [...new Set(parsed)]
        : [];
    } catch {
      return [];
    }
  }

  function loadChannelOrder(workspaceID: string, userID: string): string[] {
    if (!workspaceID || !userID) return [];
    try {
      return parseChannelOrder(window.localStorage.getItem(channelOrderStorageKey(workspaceID, userID)));
    } catch {
      return [];
    }
  }

  function saveChannelOrder(order: string[]) {
    channelOrder = order;
    if (!workspaceID || !currentUser?.id) return;
    try {
      const key = channelOrderStorageKey(workspaceID, currentUser.id);
      const serialized = JSON.stringify(order);
      if (serialized.length > MAX_CHANNEL_ORDER_STORAGE_LENGTH) {
        window.localStorage.removeItem(key);
        return;
      }
      window.localStorage.setItem(key, serialized);
    } catch {
      // Storage is an enhancement; reordering still works for this session.
    }
  }

  const PERSONA_ORDER_STORAGE_PREFIX = "clickclack:sidebar-persona-order:v1:";
  let personaOrder = $state<string[]>([]);

  function personaOrderStorageKey(workspaceID: string, userID: string): string {
    return `${PERSONA_ORDER_STORAGE_PREFIX}${userID}:${workspaceID}`;
  }

  function loadPersonaOrder(workspaceID: string, userID: string): string[] {
    if (!workspaceID || !userID) return [];
    try {
      return parseChannelOrder(
        window.localStorage.getItem(personaOrderStorageKey(workspaceID, userID)),
      );
    } catch {
      return [];
    }
  }

  function savePersonaOrder(order: string[]) {
    personaOrder = order;
    if (!workspaceID || !currentUser?.id) return;
    try {
      window.localStorage.setItem(
        personaOrderStorageKey(workspaceID, currentUser.id),
        JSON.stringify(order),
      );
    } catch {
      // The order remains active for this session when storage is unavailable.
    }
  }

  const PERSONA_CHANNEL_PIN_STORAGE_PREFIX = "clickclack:persona-channel-pins:v1:";
  let personaChannelPins = $state<PersonaChannelPins>({});

  function personaChannelPinStorageKey(workspaceID: string, userID: string): string {
    return `${PERSONA_CHANNEL_PIN_STORAGE_PREFIX}${userID}:${workspaceID}`;
  }

  function loadPersonaChannelPins(workspaceID: string, userID: string): PersonaChannelPins {
    if (!workspaceID || !userID) return {};
    try {
      return parsePersonaChannelPins(
        window.localStorage.getItem(personaChannelPinStorageKey(workspaceID, userID)),
      );
    } catch {
      return {};
    }
  }

  function pinPersonaChannel(personaID: string, channelID: string) {
    personaChannelPins = { ...personaChannelPins, [personaID]: channelID };
    if (!workspaceID || !currentUser?.id) return;
    try {
      window.localStorage.setItem(
        personaChannelPinStorageKey(workspaceID, currentUser.id),
        JSON.stringify(personaChannelPins),
      );
    } catch {
      // The pin remains active for this session when storage is unavailable.
    }
  }

  function handleStorage(event: StorageEvent) {
    if (!workspaceID || !currentUser?.id) return;
    if (event.key === channelOrderStorageKey(workspaceID, currentUser.id)) {
      channelOrder = parseChannelOrder(event.newValue);
    } else if (event.key === personaOrderStorageKey(workspaceID, currentUser.id)) {
      personaOrder = parseChannelOrder(event.newValue);
    } else if (event.key === personaChannelPinStorageKey(workspaceID, currentUser.id)) {
      personaChannelPins = parsePersonaChannelPins(event.newValue);
    }
  }

  const orderedProfileShortcuts = $derived.by(() => {
    const byID = new Map(profileShortcuts.map((profile) => [profile.bot_user_id, profile]));
    const saved = personaOrder.flatMap((id) => {
      const profile = byID.get(id);
      if (!profile) return [];
      byID.delete(id);
      return [profile];
    });
    return [...saved, ...byID.values()];
  });

  let orderedChannels = $derived.by(() => {
    const byID = new Map(channels.map((channel) => [channel.id, channel]));
    const saved = channelOrder.flatMap((id) => {
      const channel = byID.get(id);
      if (!channel) return [];
      byID.delete(id);
      return [channel];
    });
    return [...saved, ...byID.values()];
  });

  $effect(() => {
    const userID = currentUser?.id || "";
    channelOrder = loadChannelOrder(workspaceID, userID);
    personaOrder = loadPersonaOrder(workspaceID, userID);
    personaChannelPins = loadPersonaChannelPins(workspaceID, userID);
  });

  function shouldHandleClientNavigation(event: MouseEvent): boolean {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  }
</script>

<svelte:window
  onstorage={handleStorage}
  onclick={closeShelfMenu}
  onkeydown={(event) => { if (event.key === "Escape") closeShelfMenu(); }}
/>

<aside id="primary-navigation" class="sidebar" aria-label="Channels and DMs">
  {#if showHeader}
    <header class="workspace-header">
      <WorkspaceSwitcher
        {homeLink}
        {workspaceCreatePending}
        {workspaceCreateError}
        {workspaces}
        selectedWorkspaceID={workspaceID}
        {createWorkspaceName}
        {showWorkspaceCreate}
        {connected}
        {hrefForWorkspace}
        {onSelectWorkspace}
        {onToggleWorkspaceCreate}
        {onWorkspaceName}
        {onCreateWorkspace}
        {onOpenWorkspaceSettings}
      />
    </header>
  {/if}

  <div class="sidebar-scroll" bind:this={sidebarScroll} onscroll={rememberSidebarScroll}>
    {#if WORKSPACE_VIEWS.length > 0}
      <nav class="sidebar-views" aria-label="Workspace views">
        {#each WORKSPACE_VIEWS as view (view.id)}
          <a
            class="sidebar-view"
            class:active={activeViewSlug === view.slug}
            aria-current={activeViewSlug === view.slug ? "page" : undefined}
            href={workspaceViewsPath(workspaceID, view.slug)}
          >
            <span class="sidebar-view-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                {#each view.icon as d, i (i)}
                  <path {d} />
                {/each}
              </svg>
            </span>
            <span class="sidebar-view-label">{view.label}</span>
          </a>
        {/each}
      </nav>
    {/if}

    <section id="sidebar-people-list" class="sidebar-people-row" aria-label="Recent people">
      {#each displayedRecentPeople as person (person.id)}
          {@const conversation = directConversationForUser(directConversations, person.id, currentUser?.id)}
          {@const unread = conversation?.unread_count || 0}
          {@const pinnedChannel = pinnedPersonaChannel(personaChannelPins, person.id, channels)}
          <a
            href={pinnedChannel ? hrefForChannel(pinnedChannel.id) : conversation ? hrefForDirect(conversation.id) : "#"}
            class="sidebar-person"
            class:active={pinnedChannel?.id === selectedChannelID || conversation?.id === selectedDirectID || selectedProfile?.id === person.id}
            class:has-unread={unread > 0 && conversation?.id !== selectedDirectID}
            class:shelf-drop-before={shelfDropTargetID === person.id && shelfDropBefore}
            class:shelf-drop-after={shelfDropTargetID === person.id && !shelfDropBefore}
            class:shelf-dragging={draggedPersonID === person.id}
            title={person.display_name}
            aria-label={`${person.display_name}${unread > 0 ? `, ${unread} unread message${unread === 1 ? "" : "s"}` : ""}`}
            draggable="true"
            ondragstart={(event) => { draggedPersonID = person.id; event.dataTransfer?.setData("text/plain", person.id); }}
            ondragend={() => { draggedPersonID = ""; shelfDropTargetID = ""; }}
            ondragover={(event) => shelfDragOver(event, person.id)}
            ondragleave={() => { if (shelfDropTargetID === person.id) shelfDropTargetID = ""; }}
            ondrop={(event) => shelfDrop(event, person.id)}
            oncontextmenu={openShelfMenu}
            onclick={(event) => {
              if (pinnedChannel) {
                if (!shouldHandleClientNavigation(event)) return;
                event.preventDefault();
                onSelectChannel(pinnedChannel.id);
              } else if (conversation) {
                if (!shouldHandleClientNavigation(event)) return;
                event.preventDefault();
                onSelectDirect(conversation.id);
              } else {
                event.preventDefault();
                onOpenProfile(person);
              }
            }}
          >
            <Avatar
              isBot={person?.kind === "bot" && !person?.deleted_at}
              id={person.id}
              name={person.display_name}
              src={person.avatar_url}
            lightSrc={person.avatar_url_light}
              size={90}
            />
            {#if unread > 0 && conversation?.id !== selectedDirectID}
              <span class="sidebar-person-unread" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>
            {/if}
            <span class="sidebar-person-name">{person.display_name}</span>
          </a>
      {/each}
      {#if displayedRecentPeople.length === 0}
        <span class="sidebar-people-empty">No recent people</span>
      {/if}
    </section>
    {#if shelfMenu && (hiddenShelfCount > 0 || displayedRecentPeople.length > DEFAULT_BOT_SHELF_LIMIT)}
      <div
        class="sidebar-shelf-menu"
        role="menu"
        tabindex="-1"
        aria-label="Recent people options"
        style={`left: ${shelfMenu.x}px; top: ${shelfMenu.y}px;`}
        onclick={(event) => event.stopPropagation()}
        onkeydown={(event) => {
          if (event.key === "Escape") closeShelfMenu();
          event.stopPropagation();
        }}
      >
        {#if hiddenShelfCount > 0}
          <button type="button" role="menuitem" onclick={shelfShowAll}>show all</button>
        {:else}
          <button type="button" role="menuitem" onclick={shelfHideAll}>hide all</button>
        {/if}
      </div>
    {/if}

    <ChannelList
      {workspaceID}
      currentUserID={currentUser?.id}
      {onSelectDirect}
      {onStartDirect}
      expanded={sections.channels}
      personaExpansion={sections.personas}
      onTogglePersona={togglePersona}
      channels={orderedChannels}
      profiles={orderedProfileShortcuts}
      onReorderProfiles={savePersonaOrder}
      {directConversations}
      people={profilePeople}
      {selectedChannelID}
      {selectedDirectID}
      {workingConversationIDs}
      {hrefForChannel}
      {onSelectChannel}
      {onCreateChannel}
      onToggle={() => toggleSection("channels")}
      onReorder={saveChannelOrder}
      onAssignProfile={onAssignChannelProfile}
      {personaChannelPins}
      onPinPersonaChannel={pinPersonaChannel}
      {onNotepadHover}
    />

    <DirectMessageList
      expanded={sections.directMessages}
      conversations={directConversations}
      currentUserID={currentUser?.id}
      {selectedDirectID}
      {workingConversationIDs}
      {hrefForDirect}
      {onSelectDirect}
      {onCreateDirect}
      {onHideDirect}
      {hiddenDirectTitle}
      {onUndoHideDirect}
      onToggle={() => toggleSection("directMessages")}
    />

    <ChannelList
      {workspaceID}
      currentUserID={currentUser?.id}
      {onSelectDirect}
      {onStartDirect}
      variant="archived"
      expanded={sections.archived}
      channels={orderedChannels}
      profiles={orderedProfileShortcuts}
      onReorderProfiles={savePersonaOrder}
      {directConversations}
      people={profilePeople}
      {selectedChannelID}
      {selectedDirectID}
      {workingConversationIDs}
      {hrefForChannel}
      {onSelectChannel}
      {onCreateChannel}
      onToggle={() => toggleSection("archived")}
      onReorder={saveChannelOrder}
      onAssignProfile={onAssignChannelProfile}
      {personaChannelPins}
      onPinPersonaChannel={pinPersonaChannel}
      {onNotepadHover}
    />

  </div>

  {#if currentUser}
    <button
      class="user-card"
      type="button"
      onclick={onOpenSettings}
      oncontextmenu={(event) => {
        event.preventDefault();
        onOpenSettings();
      }}
      aria-label={`Account settings for ${currentUser.display_name} ${handleLabel(currentUser.handle)}`}
    >
      <Avatar
        isBot={currentUser?.kind === "bot" && !currentUser?.deleted_at}
        class="dm-avatar"
        id={currentUser.id}
        name={currentUser.display_name}
        src={currentUser.avatar_url}
          lightSrc={currentUser.avatar_url_light}
        size={28}
        loading="eager"
        fetchPriority="auto"
      />
      <div class="user-meta">
        <strong>{currentUser.display_name}</strong>
        <span>{currentUser.handle ? handleLabel(currentUser.handle) : connected ? "Active" : "Reconnecting…"}</span>
      </div>
      <span class="presence-dot active" aria-hidden="true"></span>
    </button>
  {/if}
</aside>
