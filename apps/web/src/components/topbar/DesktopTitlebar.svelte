<script lang="ts">
  import { safeExternalChannelURL } from "../../lib/chat/channels";
  import type { ChannelNotificationPreference } from "../../lib/types";

  type Props = {
    channelNotifPreference?: ChannelNotificationPreference | null;
    channelNotifSaving?: boolean;
    channelTitle?: string;
    pinsAvailable?: boolean;
    pinnedOpen?: boolean;
    externalURL?: string;
    connected: boolean;
    mobileNavigation: boolean;
    mobileNavOpen: boolean;
    platform: string;
    searchQuery: string;
    sidebarCollapsed: boolean;
    workspaceName?: string;
    onOpenWorkspaceSettings: () => void;
    onResetSearch: () => void;
    onSearch: () => void;
    onSearchQuery: (value: string) => void;
    onToggleSidebar: () => void;
    onToggleChannelNotifications?: () => void;
    onPinnedItems: () => void;
  };

  function notifTitle(pref: ChannelNotificationPreference): string {
    if (pref === "muted") return "Channel muted - click to change";
    if (pref === "mentions") return "Notifications for @mentions only - click to change";
    return "All notifications enabled - click to change";
  }

  let {
    channelNotifPreference = undefined,
    channelNotifSaving = false,
    channelTitle,
    pinsAvailable = false,
    pinnedOpen = false,
    externalURL,
    connected,
    mobileNavigation,
    mobileNavOpen,
    platform,
    searchQuery,
    sidebarCollapsed,
    workspaceName,
    onOpenWorkspaceSettings,
    onResetSearch,
    onSearch,
    onSearchQuery,
    onToggleSidebar,
    onToggleChannelNotifications = () => {},
    onPinnedItems,
  }: Props = $props();

  const externalHref = $derived(safeExternalChannelURL(externalURL));
</script>

<header class="desktop-titlebar" data-platform={platform}>
  <div class="desktop-titlebar-safe-area">
    <div class="desktop-titlebar-leading">
      <button
        type="button"
        class="desktop-sidebar-toggle"
        aria-label={mobileNavigation
          ? mobileNavOpen
            ? "Close navigation"
            : "Open navigation"
          : sidebarCollapsed
            ? "Expand sidebar"
            : "Collapse sidebar"}
        title={mobileNavigation
          ? mobileNavOpen
            ? "Close navigation"
            : "Open navigation"
          : sidebarCollapsed
            ? "Expand sidebar"
            : "Collapse sidebar"}
        onclick={onToggleSidebar}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8" />
          <path d="M9 4v16" fill="none" stroke="currentColor" stroke-width="1.8" />
          <path
            d={mobileNavigation
              ? mobileNavOpen
                ? "m15 9-3 3 3 3"
                : "m9 9 3 3-3 3"
              : sidebarCollapsed
                ? "m13 9 3 3-3 3"
                : "m16 9-3 3 3 3"}
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      </button>
      <button
        type="button"
        class="desktop-titlebar-workspace"
        aria-label="Workspace settings"
        title="Workspace settings"
        onclick={onOpenWorkspaceSettings}
      >
        {workspaceName || "ClickClack"}
      </button>
      {#if channelTitle}
        <span class="topbar-divider desktop-titlebar-divider" aria-hidden="true"></span>
        <h1 class="desktop-titlebar-channel with-glyph" title={channelTitle}>{channelTitle}</h1>
        {#if externalHref}
          <a class="desktop-external-link" href={externalHref} target="_blank" rel="noopener" title="Open external channel" aria-label="Open external channel">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6m0-6-9 9m7 0v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
            </svg>
          </a>
        {/if}
      {/if}
    </div>

    <form
      class="search desktop-titlebar-search"
      onsubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="m20 20-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <input
        value={searchQuery}
        placeholder="Search messages"
        aria-label="Search messages"
        oninput={(event) => onSearchQuery(event.currentTarget.value)}
      />
      {#if searchQuery}
        <button type="button" class="search-clear" aria-label="Reset" onclick={onResetSearch}>×</button>
      {/if}
      <button type="submit" class="search-submit">Search</button>
    </form>

    {#if channelNotifPreference || pinsAvailable}
      <div class="desktop-titlebar-actions" aria-label="Channel tools">
        {#if channelNotifPreference}
          <button
            type="button"
            title={notifTitle(channelNotifPreference)}
            aria-label={notifTitle(channelNotifPreference)}
            aria-busy={channelNotifSaving}
            disabled={channelNotifSaving}
            onclick={onToggleChannelNotifications}
          >
            {#if channelNotifPreference === "muted"}
              <span aria-hidden="true">🔕</span>
            {:else if channelNotifPreference === "mentions"}
              <span aria-hidden="true">@</span>
            {:else}
              <span aria-hidden="true">🔔</span>
            {/if}
          </button>
        {/if}
        {#if pinsAvailable}
          <button
            type="button"
            title={pinnedOpen ? "Close pinned items" : "Pinned items"}
            aria-label={pinnedOpen ? "Close pinned items" : "Pinned items"}
            class:active={pinnedOpen}
            onclick={onPinnedItems}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m14 4 6 6-4 4v5l-2 2-5-5-4 4-1-1 4-4-5-5 2-2h5l4-4Z" />
            </svg>
          </button>
        {/if}
      </div>
    {/if}
    {#if !connected}
      <span class="desktop-titlebar-status" role="status">Connecting…</span>
    {/if}
  </div>
</header>
