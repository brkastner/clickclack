<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { api, readableAPIError } from "$lib/api";
  import { portal } from "$lib/actions/portal";
  import { coalesceAgentActivity } from "$lib/chat/agent-activity";
  import { newNonce } from "$lib/chat/messages";
  import { isDeletedBot, userDisplayLabel } from "$lib/chat/people";
  import { INITIAL_MESSAGE_LIMIT, PAGE_MESSAGE_LIMIT } from "$lib/chat/messageWindow";
  import {
    applyPeekMessage,
    conversationPeekPath,
    conversationReadPath,
    foldPeekPage,
    peekReadThroughSeq,
    type ConversationPeekTarget,
  } from "$lib/conversation-peek";
  import { ReactionController } from "$lib/reactions.svelte";
  import { uploadURL } from "$lib/uploads";
  import type { ComposerInputElement } from "$lib/chat/typeToFocus";
  import type {
    Channel,
    DirectConversation,
    Message,
    MessagePage,
    Upload,
    User,
  } from "$lib/types";
  import Avatar from "../avatar/Avatar.svelte";
  import ChatComposer from "../composer/ChatComposer.svelte";
  import MessageList, { type MessageListHandle } from "../messages/MessageList.svelte";

  type Props = {
    target: ConversationPeekTarget;
    href: string;
    persona?: User;
    channel?: Channel;
    direct?: DirectConversation;
    channels?: Channel[];
    users?: User[];
    currentUserID?: string;
    working?: boolean;
    unreadCount?: number;
    /** Changes whenever the workspace reports new activity for this conversation. */
    activitySignal?: string;
    onClose: () => void;
    onSent?: (message: Message) => void;
    onRead?: (conversationID: string, seq: number) => void;
  };

  let {
    target,
    href,
    persona,
    channel,
    direct,
    channels = [],
    users = [],
    currentUserID = "",
    working = false,
    unreadCount = 0,
    activitySignal = "",
    onClose,
    onSent,
    onRead,
  }: Props = $props();

  const reactionController = new ReactionController(() => currentUserID);

  let page = $state<MessagePage | undefined>(undefined);
  let loading = $state(true);
  let loadingOlder = $state(false);
  let prepending = $state(false);
  let error = $state("");
  let sendError = $state("");
  let sending = $state(false);
  let body = $state("");
  let replyTarget = $state<Message | null>(null);
  let list = $state<MessageListHandle | null>(null);
  let composerInput = $state<ComposerInputElement | null>(null);
  let dialog = $state<HTMLDivElement | null>(null);
  let markedSeq = 0;
  let appliedSignal = "";
  let controller: AbortController | undefined;
  let serial = 0;

  const messages = $derived(coalesceAgentActivity(
    page?.messages ?? [],
    { hideCommentary: false, hideToolCalls: false },
    Date.now(),
  ));
  const canSend = $derived(direct?.can_send ?? true);
  const personaName = $derived(persona ? userDisplayLabel(persona) : "");
  const subtitle = $derived(
    persona?.handle ? `@${persona.handle}` : target.kind === "direct" ? "direct message" : "channel",
  );

  function peekPath(query: string): string {
    return conversationPeekPath(target.kind, target.id, query);
  }

  async function fetchPage(query: string, direction: "replace" | "older" | "newer"): Promise<void> {
    const current = ++serial;
    const data = await api<MessagePage>(peekPath(query), { signal: controller?.signal });
    if (current !== serial && direction === "replace") return;
    page = foldPeekPage(page, data, direction);
    reactionController.seedMessages(data.messages);
  }

  async function load(): Promise<void> {
    loading = true;
    error = "";
    try {
      await fetchPage(`mode=latest&limit=${INITIAL_MESSAGE_LIMIT}`, "replace");
      await tick();
      void list?.scrollToBottom();
      markRead();
    } catch (reason) {
      if (!controller?.signal.aborted) {
        error = readableAPIError(reason, "Could not load this conversation.");
      }
    } finally {
      loading = false;
    }
  }

  async function loadOlder(): Promise<void> {
    if (loadingOlder || !page?.has_older || page.oldest_seq <= 0) return;
    loadingOlder = true;
    prepending = true;
    try {
      await fetchPage(`before_seq=${encodeURIComponent(String(page.oldest_seq))}&limit=${PAGE_MESSAGE_LIMIT}`, "older");
    } catch {
      // Keep the window as-is; the loader row stays available for a retry.
    } finally {
      loadingOlder = false;
      await tick();
      prepending = false;
    }
  }

  async function loadNewer(): Promise<void> {
    if (!page || loading) return;
    const following = list?.isNearBottom(120) ?? true;
    try {
      await fetchPage(`after_seq=${encodeURIComponent(String(page.newest_seq))}&limit=${PAGE_MESSAGE_LIMIT}`, "newer");
    } catch {
      return;
    }
    if (following) {
      await tick();
      void list?.scrollToBottom();
      markRead();
    }
  }

  /** Report the newest sequence in view as read, at most once per sequence. */
  function markRead(): void {
    const seq = peekReadThroughSeq(page);
    if (seq <= 0 || seq <= markedSeq) return;
    markedSeq = seq;
    onRead?.(target.id, seq);
    void api(conversationReadPath(target.kind, target.id), {
      method: "POST",
      body: JSON.stringify({ seq }),
    }).catch(() => {
      // Read receipts are advisory; a failure resolves on the next open.
    });
  }

  async function send(): Promise<void> {
    const text = body.trim();
    if (!text || sending || !canSend) return;
    sending = true;
    sendError = "";
    const payload: Record<string, unknown> = { body: text, nonce: newNonce() };
    if (replyTarget) payload.quoted_message_id = replyTarget.id;
    try {
      const { message } = await api<{ message: Message }>(peekPath(""), {
        method: "POST",
        body: JSON.stringify(payload),
      });
      body = "";
      replyTarget = null;
      if (page) page = applyPeekMessage(page, message);
      reactionController.seedMessages([message]);
      onSent?.(message);
      await tick();
      void list?.scrollToBottom();
    } catch (reason) {
      sendError = readableAPIError(reason, "Could not send this message.");
    } finally {
      sending = false;
      composerInput?.focus();
    }
  }

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

  function focusableInDialog(): HTMLElement[] {
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
  }

  /** Keep Tab and Shift+Tab inside the dialog while it owns the screen. */
  function trapTab(event: KeyboardEvent): void {
    const nodes = focusableInDialog();
    if (nodes.length === 0) {
      event.preventDefault();
      dialog?.focus();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!active || !dialog?.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Tab") {
      trapTab(event);
      return;
    }
    if (event.key !== "Escape") return;
    const origin = event.target as HTMLElement | null;
    // A composer suggestion list or picker owns Escape until it closes itself.
    if (origin?.closest("[data-handles-escape]")) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  function openImage(url: string): void {
    window.open(url, "_blank", "noopener");
  }

  onMount(() => {
    controller = new AbortController();
    // The first load already reads the tail, so only later signals need a refetch.
    appliedSignal = activitySignal;
    void load();
    const previousFocus = document.activeElement as HTMLElement | null;
    void tick().then(() => composerInput?.focus());
    return () => previousFocus?.focus?.();
  });

  onDestroy(() => {
    serial++;
    controller?.abort();
    reactionController.clear();
  });

  $effect(() => {
    // Re-read the tail whenever the workspace reports fresh activity here.
    const signal = activitySignal;
    // Depend on loading and page too, so a signal that lands mid-load still applies.
    if (loading || !page || signal === appliedSignal) return;
    appliedSignal = signal;
    void loadNewer();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-scrim conversation-peek-scrim" role="presentation" use:portal>
  <button
    class="modal-backdrop"
    type="button"
    aria-label={`Dismiss ${target.title}`}
    onclick={onClose}
  ></button>

  <div
    class="conversation-peek"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={`${target.title} conversation`}
    bind:this={dialog}
  >
    <header class="conversation-peek__header">
      {#if persona}
        <Avatar
          class="conversation-peek__avatar"
          id={persona.id}
          name={personaName}
          isBot={persona.kind === "bot" && !persona.deleted_at}
          src={isDeletedBot(persona) ? undefined : persona.avatar_url}
          lightSrc={isDeletedBot(persona) ? undefined : persona.avatar_url_light}
          size={40}
        />
      {/if}
      <div class="conversation-peek__title">
        <h2>{target.title}</h2>
        <p>{persona ? `${personaName} · ${subtitle}` : subtitle}</p>
      </div>

      {#if working}
        <span class="conversation-peek__working"><i></i> working</span>
      {:else if unreadCount > 0}
        <span class="conversation-peek__unread">{unreadCount > 99 ? "99+" : unreadCount} unread</span>
      {/if}

      <a class="conversation-peek__open" {href}>open full view</a>
      <button type="button" class="conversation-peek__close" aria-label="Close conversation" onclick={onClose}>
        &times;
      </button>
    </header>

    {#if error}
      <div class="conversation-peek__notice" role="alert">
        <span>{error}</span>
        <button type="button" onclick={() => void load()}>try again</button>
      </div>
    {/if}

    <div class="conversation-peek__body">
      <MessageList
        {messages}
        viewKey={`peek:${target.id}`}
        channelID={target.kind === "channel" ? target.id : ""}
        selectedChannel={channel}
        selectedDirect={direct}
        {channels}
        mentionPeople={users}
        {currentUserID}
        {reactionController}
        {loading}
        hasOlder={page?.has_older ?? false}
        hasNewer={page?.has_newer ?? false}
        reactionsDisabled={!canSend}
        {loadingOlder}
        {prepending}
        timelineComplete={!(page?.has_newer ?? false)}
        onListRef={(handle) => (list = handle)}
        onActivateMessageComposer={() => {}}
        onInlineImagePointerUp={() => {}}
        onOpenProfile={() => {}}
        onReply={(message) => {
          replyTarget = message;
          void tick().then(() => composerInput?.focus());
        }}
        onOpenThread={() => (window.location.href = href)}
        onJumpToQuote={() => {}}
        onOpenImage={(url) => openImage(url)}
        onOpenArtifact={(upload: Upload) => openImage(uploadURL(upload))}
        onAddAttachmentToMessage={() => {}}
        onLoadOlder={() => void loadOlder()}
        onLoadNewer={() => void loadNewer()}
        onReachedBottom={markRead}
        onMarkRead={markRead}
      />
    </div>

    <div class="conversation-peek__dock">
      {#if sendError}
        <p class="conversation-peek__error" role="status">{sendError}</p>
      {/if}
      <ChatComposer
        value={body}
        placeholder={`Message ${target.title}`}
        ariaLabel={`Message ${target.title}`}
        submitLabel="Send"
        disabled={sending || !canSend}
        {replyTarget}
        showToolbar
        mentionPeople={users}
        onValue={(value) => (body = value)}
        onSubmit={() => void send()}
        onKeydown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
        onFocus={() => (sendError = "")}
        onInputRef={(node) => (composerInput = node)}
        onClearReply={() => (replyTarget = null)}
      />
    </div>
  </div>
</div>

<style>
  .conversation-peek-scrim { z-index: 60; }

  .conversation-peek {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    width: min(1180px, 100%);
    height: 100%;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-xl);
    background: var(--panel);
    box-shadow: var(--key-edge), var(--shadow);
  }

  .conversation-peek__header {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--panel-2) 70%, transparent);
  }

  :global(.conversation-peek__avatar) {
    display: grid;
    width: 40px;
    height: 40px;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: 9px;
    background: var(--panel-2);
    place-items: center;
  }

  :global(.conversation-peek__avatar img) { width: 100%; height: 100%; object-fit: cover; }

  .conversation-peek__title { min-width: 0; }

  .conversation-peek__title h2 {
    margin: 0;
    overflow: hidden;
    color: var(--text-strong);
    font: 800 17px/1.2 var(--font-display);
    letter-spacing: -.015em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conversation-peek__title p {
    margin: 3px 0 0;
    color: var(--muted);
    font: 12px var(--font-mono);
  }

  .conversation-peek__working,
  .conversation-peek__unread {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    padding: 4px 8px;
    border-radius: 999px;
    font: 750 11px var(--font-mono);
    letter-spacing: .045em;
    text-transform: uppercase;
  }

  .conversation-peek__working {
    background: color-mix(in srgb, var(--rp-foam) 14%, transparent);
    color: var(--rp-foam);
  }

  .conversation-peek__working i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .conversation-peek__unread {
    background: color-mix(in srgb, var(--rp-love) 13%, transparent);
    color: var(--rp-love);
  }

  .conversation-peek__open {
    flex: 0 0 auto;
    padding: 6px 10px;
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    background: var(--panel-2);
    color: var(--text-strong);
    font: 700 12px var(--font-mono);
    text-decoration: none;
  }

  .conversation-peek__working + .conversation-peek__open,
  .conversation-peek__unread + .conversation-peek__open { margin-left: 0; }
  .conversation-peek__title + .conversation-peek__open { margin-left: auto; }

  .conversation-peek__open:hover {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line-strong));
    color: var(--accent);
  }

  .conversation-peek__close {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    font-size: 21px;
    line-height: 1;
    cursor: pointer;
  }

  .conversation-peek__close:hover { border-color: var(--line-strong); color: var(--text-strong); }

  .conversation-peek__notice {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--text);
    font-size: 13px;
  }

  .conversation-peek__notice button {
    padding: 4px 9px;
    border: 1px solid var(--line-strong);
    border-radius: 5px;
    background: var(--panel-2);
    color: var(--text-strong);
    cursor: pointer;
  }

  .conversation-peek__body {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
  }

  .conversation-peek__body :global(.messages) { flex: 1 1 auto; min-height: 0; }

  .conversation-peek__dock {
    display: grid;
    flex: 0 0 auto;
    gap: 6px;
    padding: 10px 14px 14px;
    background: var(--panel);
  }

  .conversation-peek__dock :global(.composer) {
    padding: 0;
    background: none;
  }

  .conversation-peek__dock :global(.composer-card) {
    box-shadow: none;
  }

  .conversation-peek__error {
    margin: 0;
    color: var(--danger);
    font: 12px/1.4 var(--font-mono);
  }

  @media (max-width: 720px) {
    .conversation-peek { width: 100%; height: 100%; border-radius: var(--radius-lg); }
    .conversation-peek__open { display: none; }
  }
</style>
