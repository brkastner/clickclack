<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { api, readableAPIError } from "$lib/api";
  import { channelDisplayTitle } from "$lib/chat/channels";
  import { newNonce } from "$lib/chat/messages";
  import { dmTitle, isDeletedBot, userDisplayLabel } from "$lib/chat/people";
  import {
    buildHomePersonaGroups,
    buildHomeRecentItems,
    channelHomeSource,
    directHomeSource,
    messagePreview,
    recentContextMessages,
    type HomeRecentItem,
    type HomeRecentSource,
  } from "$lib/home-recent";
  import type { ComposerInputElement } from "$lib/chat/typeToFocus";
  import type { Channel, DirectConversation, Message, MessagePage, User } from "$lib/types";
  import type { WorkspaceViewProps } from "$lib/views";
  import Avatar from "../avatar/Avatar.svelte";
  import ChatComposer from "../composer/ChatComposer.svelte";
  import HomeDiagnostics from "./HomeDiagnostics.svelte";

  type HomeViewProps = WorkspaceViewProps & {
    workspaceRouteID?: string;
    currentUserID?: string;
    channels?: Channel[];
    directConversations?: DirectConversation[];
    users?: User[];
    workingConversationIDs?: ReadonlySet<string>;
    connected?: boolean;
    voiceStatus?: string;
  };

  let {
    workspaceID,
    workspaceRouteID = workspaceID,
    currentUserID = "",
    channels = [],
    directConversations = [],
    users = [],
    workingConversationIDs = new Set<string>(),
    connected = false,
    voiceStatus = "unknown",
  }: HomeViewProps = $props();

  let sources = $state<HomeRecentSource[]>([]);
  let loading = $state(true);
  let refreshing = $state(false);
  let partialFailures = $state(0);
  let error = $state("");
  let now = $state(Date.now());
  let selectedPersonaID = $state("");
  let expandedItemID = $state("");
  let composerBody = $state("");
  let composerInput = $state<ComposerInputElement | null>(null);
  let sendingItemID = $state("");
  let sendError = $state("");
  let requestSerial = 0;
  let loadController: AbortController | undefined;

  const items = $derived(buildHomeRecentItems(sources, users));
  const groups = $derived(buildHomePersonaGroups(items, workingConversationIDs));
  const personaGroups = $derived(groups.filter((group) => group.persona));
  const visibleGroups = $derived(
    selectedPersonaID ? groups.filter((group) => group.id === selectedPersonaID) : groups,
  );
  const usersByID = $derived(new Map(users.map((user) => [user.id, user])));

  function itemHref(routeID: string): string {
    return `/app/${encodeURIComponent(workspaceRouteID)}/${encodeURIComponent(routeID)}`;
  }

  function relativeTime(value: string): string {
    const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1_000));
    if (!Number.isFinite(seconds) || seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return days < 7 ? `${days}d ago` : new Date(value).toLocaleDateString();
  }

  function languageFor(value: string): string | undefined {
    return /[\u0400-\u04ff]/u.test(value) ? "ru" : undefined;
  }

  function messageAuthorName(message: Message): string {
    return userDisplayLabel(message.author ?? usersByID.get(message.author_id), "Unknown");
  }

  function toggleExpanded(itemID: string): void {
    if (sendingItemID) return;
    const opening = expandedItemID !== itemID;
    expandedItemID = opening ? itemID : "";
    composerBody = "";
    sendError = "";
    if (opening) void tick().then(() => composerInput?.focus());
  }

  function collapseExpanded(): void {
    expandedItemID = "";
    composerBody = "";
    sendError = "";
  }

  function handleSummaryKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && expandedItemID) {
      event.preventDefault();
      collapseExpanded();
    }
  }

  function handleComposerKeydown(event: KeyboardEvent, item: HomeRecentItem): void {
    if (event.key === "Escape") {
      event.preventDefault();
      collapseExpanded();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(item);
    }
  }

  async function sendMessage(item: HomeRecentItem): Promise<void> {
    const body = composerBody.trim();
    if (!body || sendingItemID) return;

    const itemID = item.id;
    const path = item.kind === "direct"
      ? `/api/dms/${encodeURIComponent(itemID)}/messages`
      : `/api/channels/${encodeURIComponent(itemID)}/messages`;
    sendingItemID = itemID;
    sendError = "";
    try {
      const { message } = await api<{ message: Message }>(path, {
        method: "POST",
        body: JSON.stringify({ body, nonce: newNonce() }),
      });
      sources = sources.map((source) =>
        source.id === itemID ? { ...source, messages: [...source.messages, message] } : source,
      );
      if (expandedItemID === itemID && composerBody.trim() === body) composerBody = "";
      void loadRecent();
    } catch (reason) {
      if (expandedItemID === itemID) {
        sendError = readableAPIError(reason, "Could not send this message.");
      }
    } finally {
      if (sendingItemID === itemID) sendingItemID = "";
    }
  }

  async function loadRecent(): Promise<void> {
    const serial = ++requestSerial;
    loadController?.abort();
    loadController = new AbortController();
    refreshing = true;
    error = "";

    const requests: Array<Promise<HomeRecentSource>> = [
      ...channels
        .filter((channel) => !channel.archived_at)
        .map(async (channel) => {
          const page = await api<MessagePage>(
            `/api/channels/${encodeURIComponent(channel.id)}/messages?mode=latest&limit=8`,
            { signal: loadController?.signal },
          );
          return channelHomeSource(channel, page.messages, `#${channelDisplayTitle(channel)}`);
        }),
      ...directConversations.map(async (conversation) => {
        const page = await api<MessagePage>(
          `/api/dms/${encodeURIComponent(conversation.id)}/messages?mode=latest&limit=8`,
          { signal: loadController?.signal },
        );
        return directHomeSource(
          conversation,
          page.messages,
          dmTitle(conversation, currentUserID) || "Direct conversation",
        );
      }),
    ];

    try {
      const settled = await Promise.allSettled(requests);
      if (serial !== requestSerial) return;
      const loadedSources = settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      partialFailures = settled.length - loadedSources.length;
      if (requests.length > 0 && loadedSources.length === 0) {
        throw new Error("Recent activity is temporarily unavailable");
      }
      sources = loadedSources;
    } catch (reason) {
      if (serial === requestSerial && !loadController.signal.aborted) {
        error = reason instanceof Error ? reason.message : "Could not load recent activity";
      }
    } finally {
      if (serial === requestSerial) {
        loading = false;
        refreshing = false;
      }
    }
  }

  $effect(() => {
    const signature = [
      workspaceID,
      currentUserID,
      ...channels.map((channel) => `${channel.id}:${channel.last_seq ?? 0}:${channel.unread_count ?? 0}`),
      ...directConversations.map((conversation) =>
        `${conversation.id}:${conversation.last_seq ?? 0}:${conversation.unread_count ?? 0}`,
      ),
    ].join("|");
    if (!signature) return;
    const timer = window.setTimeout(() => void loadRecent(), 80);
    return () => window.clearTimeout(timer);
  });

  $effect(() => {
    if (selectedPersonaID && !groups.some((group) => group.id === selectedPersonaID)) {
      selectedPersonaID = "";
    }
    if (expandedItemID && !items.some((item) => item.id === expandedItemID)) {
      collapseExpanded();
    }
  });

  onMount(() => {
    const clock = window.setInterval(() => (now = Date.now()), 60_000);
    return () => window.clearInterval(clock);
  });

  onDestroy(() => {
    requestSerial++;
    loadController?.abort();
  });
</script>

<svelte:window onfocus={() => !loading && void loadRecent()} ononline={() => void loadRecent()} />

<section class="home-view">
  <header class="home-view__toolbar">
    <div class="home-view__heading">
      <span class="home-view__eyebrow">home</span>
      <span class="home-view__slash" aria-hidden="true">/</span>
      <h1>recent activity</h1>
      <span class="home-view__status" aria-live="polite">
        {refreshing && !loading ? "updating…" : `${groups.length} active ${groups.length === 1 ? "persona" : "personas"}`}
      </span>
    </div>

    {#if personaGroups.length > 1}
      <div class="home-view__filters" aria-label="Filter recent activity by persona">
        <button
          type="button"
          class:is-active={selectedPersonaID === ""}
          aria-pressed={selectedPersonaID === ""}
          onclick={() => (selectedPersonaID = "")}
        >all</button>
        {#each personaGroups as group (group.id)}
          {@const name = userDisplayLabel(group.persona!)}
          <button
            type="button"
            class:is-active={selectedPersonaID === group.id}
            aria-pressed={selectedPersonaID === group.id}
            onclick={() => (selectedPersonaID = group.id)}
          >
            <Avatar
              class="home-filter__avatar"
              id={group.persona!.id}
              name={name}
              isBot={group.persona!.kind === "bot" && !group.persona!.deleted_at}
              src={isDeletedBot(group.persona) ? undefined : group.persona!.avatar_url}
              lightSrc={isDeletedBot(group.persona) ? undefined : group.persona!.avatar_url_light}
              size={22}
            />
            <span lang={languageFor(name)}>{name}</span>
          </button>
        {/each}
      </div>
    {/if}
  </header>

  <div class="home-view__canvas">
    <div class="home-view__columns">
    <div class="home-view__feed">
    {#if loading}
      <div class="home-personas" aria-label="Loading recent activity" aria-busy="true">
        {#each Array(3) as _, index (index)}
          <div class="home-persona home-persona--skeleton">
            <span></span><i></i><b></b><b></b>
          </div>
        {/each}
      </div>
    {:else if error}
      <div class="home-view__notice" role="alert">
        <strong>Home couldn’t load.</strong>
        <span>{error}</span>
        <button type="button" onclick={() => void loadRecent()}>try again</button>
      </div>
    {:else}
      {#if partialFailures > 0}
        <p class="home-view__partial" role="status">
          Some conversations could not be loaded. Showing everything else.
        </p>
      {/if}

      {#if visibleGroups.length === 0}
        <div class="home-view__empty">
          <span aria-hidden="true">☕</span>
          <strong>Nothing recent yet.</strong>
          <p>New channel and direct messages will show up here.</p>
        </div>
      {:else}
        <ol class="home-personas" aria-label="Recent activity grouped by persona">
          {#each visibleGroups as group (group.id)}
            {@const personaName = group.persona ? userDisplayLabel(group.persona) : "Unassigned"}
            {@const visibleItems = group.items.slice(0, 4)}
            <li class="home-persona" class:is-unread={group.unreadCount > 0}>
              {#if group.persona}
                <Avatar
                  class="home-persona__art"
                  id={group.persona.id}
                  name={personaName}
                  isBot={group.persona.kind === "bot" && !group.persona.deleted_at}
                  src={isDeletedBot(group.persona) ? undefined : group.persona.avatar_url}
                  lightSrc={isDeletedBot(group.persona) ? undefined : group.persona.avatar_url_light}
                  size={300}
                  loading="lazy"
                />
              {/if}

              <header class="home-persona__header">
                <Avatar
                  class="home-persona__avatar"
                  id={group.persona?.id || group.id}
                  name={personaName}
                  isBot={group.persona?.kind === "bot" && !group.persona.deleted_at}
                  src={isDeletedBot(group.persona) ? undefined : group.persona?.avatar_url}
                  lightSrc={isDeletedBot(group.persona) ? undefined : group.persona?.avatar_url_light}
                  size={52}
                />
                <div>
                  <h2 lang={languageFor(personaName)}>{personaName}</h2>
                  <p>{group.persona?.handle ? `@${group.persona.handle}` : "workspace activity"}</p>
                </div>
                {#if group.working}
                  <span class="home-persona__working"><i></i> working</span>
                {:else if group.unreadCount > 0}
                  <span class="home-persona__unread">{group.unreadCount > 99 ? "99+" : group.unreadCount} unread</span>
                {/if}
              </header>

              <div class="home-persona__activity">
                {#each visibleItems as item (item.id)}
                  {@const expanded = expandedItemID === item.id}
                  {@const contextMessages = recentContextMessages(item.messages)}
                  <article
                    class="home-activity"
                    class:is-unread={item.unreadCount > 0}
                    class:is-expanded={expanded}
                  >
                    <div class="home-activity__summary">
                      <button
                        type="button"
                        class="home-activity__toggle"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} ${item.title}: ${item.preview}`}
                        onclick={() => toggleExpanded(item.id)}
                        onkeydown={handleSummaryKeydown}
                      ></button>
                      <div class="home-activity__meta">
                        <a href={itemHref(item.routeID)}>{item.title}</a>
                        {#if workingConversationIDs.has(item.id)}
                          <span class="home-activity__working">working</span>
                        {/if}
                        <time datetime={item.message.created_at}>{relativeTime(item.message.created_at)}</time>
                      </div>
                      {#if expanded && contextMessages.length > 0}
                        <ol class="home-activity__context" aria-label={`Recent messages in ${item.title}`}>
                          {#each contextMessages as message (message.id)}
                            <li>
                              <div>
                                <strong lang={languageFor(messageAuthorName(message))}>{messageAuthorName(message)}</strong>
                                <time datetime={message.created_at}>{relativeTime(message.created_at)}</time>
                              </div>
                              <p>{messagePreview(message)}</p>
                            </li>
                          {/each}
                        </ol>
                      {/if}
                      <p class="home-activity__latest">{item.preview}</p>
                      <a
                        class="home-activity__view"
                        href={itemHref(item.routeID)}
                        aria-label={`View ${item.title}`}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </a>
                    </div>

                    {#if expanded}
                      <div class="home-activity__expanded">
                        <div class="home-activity__composer-dock">
                          {#if sendError}
                            <p class="home-activity__send-error" role="status">{sendError}</p>
                          {/if}
                          <ChatComposer
                            value={composerBody}
                            placeholder={`Reply to ${item.title}`}
                            ariaLabel={`Reply to ${item.title}`}
                            submitLabel="Send"
                            formClass="composer home-activity__composer"
                            disabled={sendingItemID === item.id}
                            mentionPeople={users}
                            onValue={(value) => {
                              if (expandedItemID === item.id && !sendingItemID) composerBody = value;
                            }}
                            onSubmit={() => void sendMessage(item)}
                            onKeydown={(event) => handleComposerKeydown(event, item)}
                            onFocus={() => (sendError = "")}
                            onInputRef={(node) => (composerInput = node)}
                          />
                        </div>
                      </div>
                    {/if}
                  </article>
                {/each}
              </div>

              {#if group.items.length > visibleItems.length}
                <p class="home-persona__more">
                  +{group.items.length - visibleItems.length} more recent {group.items.length - visibleItems.length === 1 ? "conversation" : "conversations"}
                </p>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    {/if}
    </div>
    <HomeDiagnostics {connected} {voiceStatus} />
    </div>
  </div>
</section>

<style>
  .home-view {
    --home-filter-avatar-size: 20px;
    --home-persona-avatar-size: 52px;

    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
    color: var(--text);
    font-size: 120%;
  }

  :global(:root[data-avatar-size="double"]) .home-view {
    --home-filter-avatar-size: 30px;
    --home-persona-avatar-size: 78px;
  }

  .home-view__toolbar {
    position: relative;
    z-index: 3;
    display: grid;
    flex: 0 0 auto;
    min-height: 82px;
    padding: 17px clamp(18px, 3vw, 32px) 14px;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: blur(18px);
    gap: 12px;
  }

  .home-view__heading,
  .home-view__filters {
    display: flex;
    align-items: center;
  }

  .home-view__heading { gap: 9px; }

  .home-view__eyebrow,
  .home-view__slash,
  .home-view__status {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 14.4px;
  }

  .home-view__eyebrow {
    color: var(--accent);
    font-weight: 800;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .home-view__heading h1 {
    margin: 0;
    color: var(--text-strong);
    font-family: var(--font-display);
    font-size: 22.8px;
    letter-spacing: -.025em;
  }

  .home-view__status { margin-left: auto; }

  .home-view__filters {
    gap: 7px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .home-view__filters::-webkit-scrollbar { display: none; }

  .home-view__filters button {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
    min-height: 29px;
    padding: 3px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface);
    color: var(--muted);
    font: 700 14.4px var(--font-display);
    cursor: pointer;
  }

  .home-view__filters button:hover,
  .home-view__filters button.is-active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
    color: var(--text-strong);
  }

  .home-view__filters button:focus-visible,
  .home-view__notice button:focus-visible,
  .home-activity__toggle:focus-visible,
  .home-activity__meta a:focus-visible,
  .home-activity__view:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  :global(.home-filter__avatar) {
    display: grid;
    width: var(--home-filter-avatar-size);
    height: var(--home-filter-avatar-size);
    overflow: hidden;
    border-radius: 6px;
    place-items: center;
  }

  :global(.home-filter__avatar img) { width: 100%; height: 100%; object-fit: cover; }

  .home-view__canvas {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: clamp(18px, 3vw, 34px);
    background-color: var(--bg);
    background-image: radial-gradient(color-mix(in srgb, var(--line-strong) 45%, transparent) .8px, transparent .8px);
    background-size: 22px 22px;
  }

  .home-view__feed { min-width: 0; }

  .home-view__columns {
    display: grid;
    grid-template-columns: minmax(0, 1050px) 320px;
    gap: 24px;
    max-width: 1394px;
    margin: 0 auto;
    align-items: start;
  }

  @media (max-width: 1100px) {
    .home-view__columns { grid-template-columns: minmax(0, 1fr); }
  }

  .home-personas {
    display: grid;
    max-width: 1050px;
    margin: 0 auto;
    padding: 0;
    list-style: none;
    gap: 16px;
  }

  .home-persona {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel) 95%, transparent);
    box-shadow: 0 9px 28px rgb(0 0 0 / .06);
  }

  .home-persona.is-unread { border-left: 3px solid var(--rp-love); }

  :global(.home-persona__art) {
    position: absolute;
    z-index: -1;
    top: -42px;
    right: -26px;
    display: grid;
    width: 300px;
    height: 300px;
    overflow: hidden;
    opacity: .12;
    pointer-events: none;
    place-items: center;
    filter: saturate(.7);
    -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 52%, #000 100%);
    mask-image: linear-gradient(90deg, transparent 0%, #000 52%, #000 100%);
  }

  :global(.home-persona__art img) { width: 100%; height: 100%; object-fit: cover; }

  .home-persona__header {
    display: grid;
    grid-template-columns: var(--home-persona-avatar-size) minmax(0, 1fr) auto;
    align-items: center;
    gap: 13px;
    min-height: 78px;
    padding: 13px 16px;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--panel) 72%, transparent);
  }

  :global(.home-persona__avatar) {
    display: grid;
    width: var(--home-persona-avatar-size);
    height: var(--home-persona-avatar-size);
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    background: var(--panel-2);
    place-items: center;
  }

  :global(.home-persona__avatar img) { width: 100%; height: 100%; object-fit: cover; }

  .home-persona__header h2 {
    margin: 0;
    color: var(--text-strong);
    font: 800 20.4px/1.2 var(--font-display);
    letter-spacing: -.015em;
  }

  .home-persona__header p {
    margin: 4px 0 0;
    color: var(--muted);
    font: 13.2px var(--font-mono);
  }

  .home-persona__working,
  .home-persona__unread {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 999px;
    font: 750 12px var(--font-mono);
    letter-spacing: .045em;
    text-transform: uppercase;
  }

  .home-persona__working {
    background: color-mix(in srgb, var(--rp-foam) 14%, transparent);
    color: var(--rp-foam);
  }

  .home-persona__working i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 16%, transparent);
    animation: home-working-pulse 1.6s ease-in-out infinite;
  }

  .home-persona__unread {
    background: color-mix(in srgb, var(--rp-love) 13%, transparent);
    color: var(--rp-love);
  }

  .home-persona__activity { position: relative; z-index: 1; }

  .home-activity {
    position: relative;
    border-bottom: 1px solid var(--line);
    color: var(--text);
  }

  .home-activity:last-child { border-bottom: 0; }

  .home-activity__summary {
    position: relative;
    display: grid;
    min-height: 68px;
    padding: 11px 48px 11px 16px;
    gap: 5px;
  }

  .home-activity__summary:hover,
  .home-activity.is-expanded .home-activity__summary {
    background: color-mix(in srgb, var(--accent) 7%, var(--hover));
  }

  .home-activity__toggle {
    position: absolute;
    z-index: 0;
    inset: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .home-activity__meta {
    position: relative;
    z-index: 1;
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }

  .home-activity__meta a {
    min-width: 0;
    overflow: hidden;
    color: var(--text-strong);
    font: 750 14.4px var(--font-display);
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: auto;
  }

  .home-activity__meta a:hover { color: var(--accent); text-decoration: underline; }

  .home-activity__meta time {
    flex: 0 0 auto;
    margin-left: auto;
    color: var(--muted);
    font: 12px var(--font-mono);
  }

  .home-activity__working {
    flex: 0 0 auto;
    color: var(--rp-foam);
    font: 750 10.8px var(--font-mono);
    letter-spacing: .05em;
    text-transform: uppercase;
  }

  .home-activity p { font-size: 14.4px; }

  .home-activity__latest,
  .home-activity__context p {
    display: -webkit-box;
    position: relative;
    z-index: 1;
    margin: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: 14.4px;
    line-height: 1.45;
    pointer-events: none;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .home-activity.is-unread .home-activity__latest { color: var(--text); font-weight: 600; }

  .home-activity__context {
    position: relative;
    z-index: 1;
    display: grid;
    margin: 3px 0 4px;
    padding: 0;
    border-block: 1px solid color-mix(in srgb, var(--line-strong) 68%, transparent);
    list-style: none;
    pointer-events: none;
  }

  .home-activity__context li { padding: 8px 0; }
  .home-activity__context li + li { border-top: 1px solid var(--line); }
  .home-activity__context li > div { display: flex; align-items: baseline; gap: 8px; }
  .home-activity__context strong { color: var(--text-strong); font: 700 12.6px var(--font-display); }
  .home-activity__context time { margin-left: auto; color: var(--muted); font: 10.8px var(--font-mono); }
  .home-activity__context p { margin-top: 2px; font-size: 13.2px; }

  .home-activity__view {
    position: absolute;
    z-index: 2;
    top: 50%;
    right: 12px;
    display: grid;
    width: 28px;
    height: 32px;
    color: var(--muted);
    transform: translateY(-50%);
    place-items: center;
  }

  .home-activity__view svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform .15s ease;
  }

  .home-activity__view:hover { color: var(--accent); }
  .home-activity__view:hover svg { transform: translateX(2px); }

  .home-activity__expanded {
    position: relative;
    z-index: 2;
    padding: 12px 16px 15px;
    border-top: 1px solid var(--line);
    background: color-mix(in srgb, var(--panel-2) 82%, transparent);
  }

  .home-activity__composer-dock { display: grid; gap: 7px; }
  :global(.home-activity__composer) { min-width: 0; }

  .home-activity__send-error {
    margin: 0;
    color: var(--danger);
    font: 12px/1.4 var(--font-mono);
  }

  .home-persona__more {
    margin: 0;
    padding: 8px 16px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font: 12px var(--font-mono);
  }

  .home-view__notice,
  .home-view__empty {
    display: grid;
    max-width: 720px;
    justify-items: start;
    gap: 8px;
    margin: 0 auto;
    padding: 28px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
  }

  .home-view__notice span,
  .home-view__empty p,
  .home-view__partial { color: var(--muted); }

  .home-view__notice button {
    padding: 7px 11px;
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    background: var(--panel-2);
    color: var(--text-strong);
    cursor: pointer;
  }

  .home-view__empty { justify-items: center; padding: 48px 24px; text-align: center; }
  .home-view__empty > span { font-size: 38.4px; }
  .home-view__empty p { margin: 0; font-size: 15.6px; }

  .home-view__partial {
    max-width: 1050px;
    margin: 0 auto 12px;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--warn) 30%, var(--line));
    border-radius: 6px;
    background: color-mix(in srgb, var(--warn) 8%, transparent);
    font-size: 14.4px;
  }

  .home-persona--skeleton {
    display: grid;
    min-height: 190px;
    align-content: center;
    padding: 20px;
    gap: 12px;
  }

  .home-persona--skeleton span,
  .home-persona--skeleton i,
  .home-persona--skeleton b {
    display: block;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: var(--hover-strong);
    animation: home-skeleton-pulse 1.3s ease-in-out infinite alternate;
  }

  .home-persona--skeleton span { width: 52px; height: 52px; border-radius: 10px; }
  .home-persona--skeleton i { width: 28%; height: 12px; }
  .home-persona--skeleton b { width: 82%; height: 14px; }
  .home-persona--skeleton b:last-child { width: 62%; }

  @keyframes home-skeleton-pulse { to { opacity: .42; } }
  @keyframes home-working-pulse { 50% { opacity: .45; transform: scale(.8); } }

  @media (prefers-reduced-motion: reduce) {
    .home-persona--skeleton span,
    .home-persona--skeleton i,
    .home-persona--skeleton b,
    .home-persona__working i { animation: none; }
  }

  @media (max-width: 640px) {
    .home-view { --home-persona-avatar-size: 44px; }
    :global(:root[data-avatar-size="double"]) .home-view { --home-persona-avatar-size: 66px; }
    .home-view__toolbar {
      padding: calc(17px + var(--safe-area-top)) calc(16px + var(--safe-area-right)) 14px
        calc(66px + var(--safe-area-left));
    }
    .home-view__status { display: none; }
    .home-view__canvas {
      padding: 14px calc(14px + var(--safe-area-right)) calc(14px + var(--safe-area-bottom))
        calc(14px + var(--safe-area-left));
    }
    .home-persona__header { grid-template-columns: var(--home-persona-avatar-size) minmax(0, 1fr); padding: 11px 12px; }
    .home-persona__working,
    .home-persona__unread { grid-column: 2; justify-self: start; }
    .home-activity__summary { padding-inline: 12px 42px; }
    .home-activity__expanded { padding-inline: 12px; }
    .home-activity__view { right: 7px; }
    :global(.home-persona__art) { right: -90px; opacity: .09; }
  }
</style>
