<script lang="ts">
  import Avatar from "../avatar/Avatar.svelte";
  import {
    directConversationForUser,
    handleLabel,
    type ChannelProfileShortcut,
  } from "../../lib/chat/people";
  import type { Channel, DirectConversation, User, Workspace } from "../../lib/types";
  import ChannelList from "./ChannelList.svelte";
  import DirectMessageList from "./DirectMessageList.svelte";
  import WorkspaceSwitcher from "./WorkspaceSwitcher.svelte";

  type Props = {
    workspaceID: string;
    workspaces: Workspace[];
    createWorkspaceName: string;
    showWorkspaceCreate: boolean;
    connected: boolean;
    showHeader?: boolean;
    channels: Channel[];
    directConversations: DirectConversation[];
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
    onCreateChannel: () => void;
    onAssignChannelProfile: (channelID: string, profile: ChannelProfileShortcut | null) => void;
    onSelectDirect: (conversationID: string) => void;
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
  };

  let {
    workspaceID,
    workspaces,
    createWorkspaceName,
    showWorkspaceCreate,
    connected,
    showHeader = true,
    channels,
    directConversations,
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
    onOpenWorkspaceSettings,
  }: Props = $props();

  type SectionState = { channels: boolean; directMessages: boolean; people: boolean };
  const SECTION_STORAGE_PREFIX = "clickclack:sidebar-sections:v1:";
  const DEFAULT_SECTION_STATE: SectionState = { channels: true, directMessages: true, people: true };
  let sections = $state<SectionState>({ ...DEFAULT_SECTION_STATE });

  function isSectionState(value: unknown): value is SectionState {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.channels === "boolean" && typeof candidate.directMessages === "boolean" && typeof candidate.people === "boolean";
  }

  function loadSections(id: string): SectionState {
    if (!id) return { ...DEFAULT_SECTION_STATE };
    try {
      const raw = window.localStorage.getItem(`${SECTION_STORAGE_PREFIX}${id}`);
      if (!raw) return { ...DEFAULT_SECTION_STATE };
      const parsed: unknown = JSON.parse(raw);
      return isSectionState(parsed) ? parsed : { ...DEFAULT_SECTION_STATE };
    } catch {
      return { ...DEFAULT_SECTION_STATE };
    }
  }

  function toggleSection(section: keyof SectionState) {
    sections = { ...sections, [section]: !sections[section] };
    if (!workspaceID) return;
    try {
      window.localStorage.setItem(`${SECTION_STORAGE_PREFIX}${workspaceID}`, JSON.stringify(sections));
    } catch {
      // Storage is an enhancement; disclosures still work when it is unavailable.
    }
  }

  $effect(() => {
    sections = loadSections(workspaceID);
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

  function handleStorage(event: StorageEvent) {
    if (!workspaceID || !currentUser?.id) return;
    if (event.key !== channelOrderStorageKey(workspaceID, currentUser.id)) return;
    channelOrder = parseChannelOrder(event.newValue);
  }

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
  let standardChannels = $derived(orderedChannels);

  $effect(() => {
    channelOrder = loadChannelOrder(workspaceID, currentUser?.id || "");
  });

  function shouldHandleClientNavigation(event: MouseEvent): boolean {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  }
</script>

<svelte:window onstorage={handleStorage} />

<aside id="primary-navigation" class="sidebar" aria-label="Channels and DMs">
  {#if showHeader}
    <header class="workspace-header">
      <WorkspaceSwitcher
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

  <div class="sidebar-scroll">
    <section class="sidebar-people-row" aria-label="Recent people">
      {#each recentPeople as person (person.id)}
        {@const conversation = directConversationForUser(directConversations, person.id)}
        <a
          href={conversation ? hrefForDirect(conversation.id) : "#"}
          class="sidebar-person"
          class:active={conversation?.id === selectedDirectID || selectedProfile?.id === person.id}
          title={person.display_name}
          aria-label={person.display_name}
          onclick={(event) => {
            if (conversation) {
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
            id={person.id}
            name={person.display_name}
            src={person.avatar_url}
            size={34}
          />
        </a>
      {/each}
      {#if recentPeople.length === 0}
        <span class="sidebar-people-empty">No recent people</span>
      {/if}
    </section>

    <ChannelList
      {workspaceID}
      expanded={sections.channels}
      channels={standardChannels}
      profiles={profileShortcuts}
      {directConversations}
      people={profilePeople}
      {selectedChannelID}
      {selectedDirectID}
      {hrefForChannel}
      {hrefForDirect}
      {onSelectChannel}
      {onSelectDirect}
      {onCreateChannel}
      onToggle={() => toggleSection("channels")}
      onReorder={saveChannelOrder}
      onAssignProfile={onAssignChannelProfile}
    />

    <DirectMessageList
      expanded={sections.directMessages}
      conversations={directConversations}
      profiles={[]}
      currentUserID={currentUser?.id}
      {selectedChannelID}
      {selectedDirectID}
      {hrefForChannel}
      {hrefForDirect}
      {onSelectChannel}
      {onSelectDirect}
      {onCreateDirect}
      {onHideDirect}
      {hiddenDirectTitle}
      {onUndoHideDirect}
      onToggle={() => toggleSection("directMessages")}
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
        class="dm-avatar"
        id={currentUser.id}
        name={currentUser.display_name}
        src={currentUser.avatar_url}
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
