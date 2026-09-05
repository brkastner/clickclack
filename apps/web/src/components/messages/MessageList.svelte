<script lang="ts" module>
  export type MessageListState = {
    atBottom: boolean;
    anchorMessageID?: string;
    anchorPixelOffset?: number;
  };

  export type MessageListViewportState = {
    atBottom: boolean;
    nearOlder: boolean;
    nearNewer: boolean;
  };

  export type MessageListHandle = {
    scrollToBottom: () => Promise<void>;
    scrollToMessage: (id: string) => boolean;
    scrollToDivider: (fallbackToAround?: boolean) => boolean;
    captureState: () => MessageListState | null;
    isFollowing: () => boolean;
    isNearBottom: (tolerancePx?: number) => boolean;
  };
</script>

<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { Virtualizer, type VirtualizerHandle } from "virtua/svelte";
  import { groupMessages, type MessageGroup as Group } from "../../lib/chat/messages";
  import { channelDisplayTitle } from "../../lib/chat/channels";
  import { dmTitle } from "../../lib/chat/people";
  import { middleAutoscrollVelocity, pageScrollDelta } from "../../lib/chat/scrolling";
  import type { MessageEdit, MessageEditController } from "../../lib/messageEditing.svelte";
  import { messageAudioPlayback } from "../../lib/messageAudioPlayback";
  import { recentAutoLoadAttachmentIDs } from "../../lib/media-loading";
  import type { ReactionController } from "../../lib/reactions.svelte";
  import type { Channel, DirectConversation, Message, Topic, Upload, User } from "../../lib/types";
  import { activeDecisionID as newestDecisionID } from "../../lib/chat/decision-prompt";
  import HistoryLoader from "./HistoryLoader.svelte";
  import MessageGroup from "./MessageGroup.svelte";

  type Item =
    | { kind: "loader"; id: string; direction: "older" | "newer"; rows: number }
    | { kind: "day"; id: string; label: string }
    | { kind: "group"; id: string; group: Group }
    | { kind: "divider"; id: string };

  type Props = {
    messages: Message[];
    viewKey: string;
    loading?: boolean;
    unreadCount?: number;
    unreadBoundarySeq?: number;
    unreadBoundaryLoaded?: boolean;
    unreadSince?: string;
    hasOlder?: boolean;
    hasNewer?: boolean;
    loadingOlder?: boolean;
    loadingNewer?: boolean;
    prepending?: boolean;
    restoreState?: MessageListState;
    selectedDirect?: DirectConversation;
    selectedChannel?: Channel;
    channels?: Channel[];
    selectedThreadID?: string;
    currentUserID?: string;
    mentionPeople?: User[];
    mentionAttentionUserID?: string;
    reactionController: ReactionController;
    reactionsDisabled?: boolean;
    canDeleteAnyMessage?: boolean;
    deletingMessageIDs?: ReadonlySet<string>;
    onListRef: (handle: MessageListHandle | null) => void;
    onActivateMessageComposer: () => void;
    onInlineImagePointerUp: (event: PointerEvent) => void;
    onOpenProfile: (profile?: Message["author"]) => void;
    onReply: (message: Message, context: "channel" | "dm") => void;
    onOpenThread: (message: Message) => void;
    onJumpToQuote: (message: Message) => void;
    onOpenImage: (url: string, title: string, attachments: Upload[]) => void;
    onOpenArtifact: (upload: Upload) => void;
    onAddAttachmentToMessage: (upload: Upload) => void;
    onResend?: (message: Message) => void;
    onLoadOlder?: () => void;
    onLoadNewer?: (source?: "scroll" | "wheel") => void;
    onJumpToUnread?: () => void;
    onHistorySettled?: (state: MessageListViewportState) => void;
    onReachedBottom?: () => void;
    onMarkRead?: (readThroughSeq?: number) => void;
    onRetry?: (message: Message) => void;
    onDiscard?: (message: Message) => void;
    onDeleteMessage?: (message: Message) => void;
    channelID?: string;
    pinnedMessageIDs?: ReadonlySet<string>;
    onTogglePin?: (message: Message, pinned: boolean) => Promise<void>;
    onCopyLink?: (message: Message) => Promise<string>;
    /**
     * True when `messages` is the conversation's complete latest window: no
     * newer page unloaded, no topic filter, no hidden commentary.
     *
     * Decision buttons are only live under that guarantee. A filtered or partial
     * view can make a decision look newest while newer messages exist, and
     * buttons that look live after the bridge stopped matching them would send
     * "1" into an ordinary agent turn.
     */
    timelineComplete?: boolean;
    onDecisionAnswer?: (reply: string) => void;
    onDecisionPrefill?: (reply: string) => void;
    editController?: MessageEditController;
    editScope?: string;
    onMessageEdited?: (message: MessageEdit) => void;
    topics?: Topic[];
    onSelectTopic?: (topicID: string) => void;
  };

  let {
    messages,
    viewKey,
    loading = false,
    unreadCount = 0,
    unreadBoundarySeq = 0,
    unreadBoundaryLoaded = false,
    unreadSince = "",
    hasOlder = false,
    hasNewer = false,
    loadingOlder = false,
    loadingNewer = false,
    prepending = false,
    restoreState,
    selectedDirect,
    selectedChannel,
    channels = [],
    selectedThreadID,
    currentUserID,
    mentionPeople = [],
    mentionAttentionUserID,
    reactionController,
    reactionsDisabled = false,
    canDeleteAnyMessage = false,
    deletingMessageIDs = new Set<string>(),
    onListRef,
    onActivateMessageComposer,
    onInlineImagePointerUp,
    onOpenProfile,
    onReply,
    onOpenThread,
    onJumpToQuote,
    onOpenImage,
    onOpenArtifact,
    onAddAttachmentToMessage,
    onResend,
    onLoadOlder,
    onLoadNewer,
    onJumpToUnread,
    onHistorySettled,
    onReachedBottom,
    onMarkRead,
    onRetry,
    onDiscard,
    onDeleteMessage,
    channelID = "",
    pinnedMessageIDs = new Set<string>(),
    onTogglePin,
    onCopyLink,
    timelineComplete = false,
    onDecisionAnswer,
    onDecisionPrefill,
    editController,
    editScope = "",
    onMessageEdited,
    topics = [],
    onSelectTopic = () => {},
  }: Props = $props();

  // Sub-pixel tolerance — matches virtua's official chat example (FIXME comment
  // in their source notes devicePixelRatio rounding can prevent reaching exactly 0).
  const ANCHOR_THRESHOLD_PX = 1.5;
  const OLDER_LOAD_THRESHOLD_PX = 160;
  const NEWER_LOAD_THRESHOLD_PX = 260;
  const RESTORE_FAIL_OPEN_MS = 3_000;
  const UNREAD_EXIT_MS = 180;
  const MIDDLE_MOUSE_BUTTON = 1;
  const MIDDLE_SCROLL_INTERACTIVE_TARGETS =
    "a, button, input, textarea, select, [contenteditable='true'], .attachment-grid, .media-tile";

  let virtualizer: VirtualizerHandle | undefined = $state();
  let scrollEl: HTMLDivElement | undefined = $state();
  let historyLoaderEl: HTMLDivElement | undefined = $state();
  let historyLoaderHeight = $state(0);
  let viewportHeight = $state(0);
  let middleAutoscrolling = $state(false);
  let middleAutoscrollAnchorX = $state(0);
  let middleAutoscrollAnchorY = $state(0);
  let middleAutoscrollCurrentY = 0;
  let middleAutoscrollPointerID: number | null = null;
  let middleAutoscrollFrame: number | undefined;
  let middleAutoscrollTimestamp = 0;
  let middleAutoscrollViewKey = $state("");
  let replyContext = $derived(selectedDirect ? "dm" : "channel");
  let autoLoadAttachmentIDs = $derived(recentAutoLoadAttachmentIDs(messages));
  let dismissedUnreadViewKey = $state("");
  let dismissedUnreadBoundarySeq = $state(-1);
  let dismissedUnreadCount = $state(0);
  let targetUnreadCount = $derived(
    dismissedUnreadViewKey === viewKey &&
      dismissedUnreadBoundarySeq === unreadBoundarySeq &&
      unreadCount <= dismissedUnreadCount
      ? 0
      : unreadCount,
  );
  let displayUnreadViewKey = $state("");
  let displayUnreadCount = $state(0);
  let unreadClearing = $state(false);
  let unreadExitTimer: number | undefined;
  let dividerUnreadCount = $derived(targetUnreadCount > 0 ? targetUnreadCount : displayUnreadCount);
  let messageAudioOverlayVisible = $derived(
    $messageAudioPlayback.status === "playing" || $messageAudioPlayback.status === "paused",
  );

  function toggleActiveMessageAudio() {
    if ($messageAudioPlayback.status === "playing") {
      messageAudioPlayback.pause();
    } else if ($messageAudioPlayback.status === "paused") {
      void messageAudioPlayback.resume();
    }
  }

  function clearUnreadExitTimer() {
    if (!unreadExitTimer) return;
    window.clearTimeout(unreadExitTimer);
    unreadExitTimer = undefined;
  }

  $effect(() => {
    if (displayUnreadViewKey && displayUnreadViewKey !== viewKey) {
      clearUnreadExitTimer();
      displayUnreadCount = 0;
      displayUnreadViewKey = "";
      unreadClearing = false;
      return;
    }

    if (targetUnreadCount > 0) {
      clearUnreadExitTimer();
      displayUnreadViewKey = viewKey;
      displayUnreadCount = targetUnreadCount;
      unreadClearing = false;
      return;
    }

    if (displayUnreadCount > 0 && !unreadClearing) {
      unreadClearing = true;
      unreadExitTimer = window.setTimeout(() => {
        unreadExitTimer = undefined;
        if (targetUnreadCount > 0) return;
        displayUnreadCount = 0;
        displayUnreadViewKey = "";
        unreadClearing = false;
      }, UNREAD_EXIT_MS);
    }
  });

  onDestroy(clearUnreadExitTimer);
  let listSpansUnreadBoundary = $derived.by(() => {
    const targetSeq = unreadBoundarySeq + 1;
    if (dividerUnreadCount <= 0 || targetSeq <= 0) return false;
    let oldestSeq = Number.POSITIVE_INFINITY;
    let newestSeq = 0;
    for (const message of messages) {
      if (message.parent_message_id) continue;
      const seq = message.channel_seq || 0;
      if (seq <= 0) continue;
      oldestSeq = Math.min(oldestSeq, seq);
      newestSeq = Math.max(newestSeq, seq);
    }
    return oldestSeq <= targetSeq && newestSeq >= targetSeq;
  });
  let canUseUnreadDivider = $derived(unreadBoundaryLoaded && listSpansUnreadBoundary);

  // Which decision prompt, if any, is still waiting on an answer. This is a
  // whole-timeline question rather than a per-group one, so it is decided here
  // and passed down.
  let liveDecisionID = $derived(
    onDecisionAnswer ? newestDecisionID(messages, timelineComplete) : null,
  );

  let items = $derived.by<Item[]>(() => {
    const out: Item[] = [];
    let inserted = false;
    const crosses = (m: Message): boolean => {
      if (!canUseUnreadDivider) return false;
      if (m.parent_message_id) return false;
      if (m.author?.id === currentUserID || m.author_id === currentUserID) return false;
      return dividerUnreadCount > 0 && (m.channel_seq || 0) > unreadBoundarySeq;
    };
    for (const group of groupMessages(messages, selectedChannel, channels, mentionPeople)) {
      let splitIdx = -1;
      if (!inserted) {
        for (let i = 0; i < group.messages.length; i++) {
          if (crosses(group.messages[i])) {
            splitIdx = i;
            break;
          }
        }
      }
      if (group.dayLabel) {
        out.push({ kind: "day", id: `day-${group.key}`, label: group.dayLabel });
      }
      if (splitIdx === -1) {
        out.push({ kind: "group", id: group.key, group });
      } else if (splitIdx === 0) {
        out.push({ kind: "divider", id: `div-${group.key}` });
        out.push({ kind: "group", id: group.key, group });
        inserted = true;
      } else {
        const before: Group = {
          ...group,
          key: `${group.key}-pre`,
          messages: group.messages.slice(0, splitIdx),
        };
        const after: Group = {
          ...group,
          key: `${group.key}-post`,
          dayLabel: null,
          messages: group.messages.slice(splitIdx),
          timestamp: group.messages[splitIdx].created_at,
        };
        out.push({ kind: "group", id: before.key, group: before });
        out.push({ kind: "divider", id: `div-${group.key}` });
        out.push({ kind: "group", id: after.key, group: after });
        inserted = true;
      }
    }
    if (loadingNewer) out.push({ kind: "loader", id: "loader-newer", direction: "newer", rows: 3 });
    return out;
  });

  // shouldStickToBottom mirrors virtua's chat example: a ref-style flag updated
  // synchronously in onscroll using the live offset/scrollSize. The items effect
  // reads this flag, so appends preserve the previous user-driven value instead
  // of guessing from post-mutation layout.
  let shouldStickToBottom = true;
  // Same-turn agent activity folds into one keyed synthetic row. Appending an
  // activity row changes that row's height without changing items.length, so
  // keep a separate revision for layout-affecting preamble content.
  let preambleLayoutRevision = $derived.by(() =>
    messages
      .map((message) => {
        const block = message.preamble_block;
        if (!block) return "";
        const content = block.items
          .map((item) =>
            item.type === "commentary"
              ? `${item.id}\u0000${item.body}`
              : `${item.id}\u0000${item.name}\u0000${item.detail || ""}\u0000${item.full}`,
          )
          .join("\u0001");
        return `${message.id}\u0000${block.final ? "final" : "live"}\u0000${content}`;
      })
      .filter(Boolean)
      .join("\u0002"),
  );
  // Reactive mirror for the FAB visibility only. Never gates programmatic scroll.
  let atBottom = $state(true);
  let revealed = $state(false);
  let lastViewKey: string | undefined;
  let lastItemCount = 0;
  let lastMessageID = "";
  let lastPreambleLayoutRevision = "";
  let lastRestoreState: MessageListState | undefined;
  // A proxied snapshot keeps its identity when a parent stores it in $state.
  let capturedScrollState = $state<MessageListState>();
  let capturedScrollGeneration = 0;
  let pendingRestore = false;
  let suppressPagination = false;
  let newerEdgeConsumed = false;
  let wasLoadingNewer = false;
  let suppressPaginationGeneration = 0;
  let scrollCommandGeneration = 0;

  function beginScrollCommand(cancelPendingRestore = true): number {
    if (cancelPendingRestore) {
      pendingRestore = false;
      revealed = true;
    }
    scrollCommandGeneration += 1;
    return scrollCommandGeneration;
  }

  function isCurrentScrollCommand(key: string, generation: number): boolean {
    return isCurrentView(key) && generation === scrollCommandGeneration;
  }

  function interruptScroll() {
    const generation = beginScrollCommand();
    suppressPagination = false;
    // Cancellation still releases pagination after the browser applies user input.
    void emitSettledAfterFrames(viewKey, generation);
  }

  function suppressProgrammaticPagination(frames = 2) {
    const generation = ++suppressPaginationGeneration;
    suppressPagination = true;
    const release = (remaining: number) => {
      requestAnimationFrame(() => {
        if (generation !== suppressPaginationGeneration) return;
        if (remaining <= 1) {
          suppressPagination = false;
          return;
        }
        release(remaining - 1);
      });
    };
    release(frames);
  }

  function virtuaBottomDistance(): number {
    if (!virtualizer) return 0;
    const scrollSize = virtualizer.getScrollSize() + historyLoaderHeight;
    return Math.max(0, scrollSize - virtualizer.getScrollOffset() - virtualizer.getViewportSize());
  }

  function checkAtBottom(): boolean {
    if (!virtualizer) return true;
    return virtuaBottomDistance() <= ANCHOR_THRESHOLD_PX;
  }

  function checkNearBottom(tolerancePx = ANCHOR_THRESHOLD_PX): boolean {
    if (!virtualizer) return true;
    return virtuaBottomDistance() <= tolerancePx;
  }

  function viewportState(): MessageListViewportState {
    if (!virtualizer) return { atBottom: true, nearOlder: false, nearNewer: false };
    const distance = virtuaBottomDistance();
    return {
      atBottom: checkAtBottom(),
      nearOlder: virtualizer.getScrollOffset() - historyLoaderHeight <= OLDER_LOAD_THRESHOLD_PX,
      nearNewer: distance <= NEWER_LOAD_THRESHOLD_PX,
    };
  }

  function emitHistorySettled() {
    onHistorySettled?.(viewportState());
  }

  function notifyReachedBottom(settledFollow = false) {
    // A late list snapshot can add unread UI while following awaits layout.
    if (hasNewer || (!settledFollow && targetUnreadCount > 0)) return;
    onReachedBottom?.();
  }

  $effect(() => {
    if (loadingNewer) {
      wasLoadingNewer = true;
      return;
    }
    if (!wasLoadingNewer) return;
    wasLoadingNewer = false;
    newerEdgeConsumed = false;
  });

  async function scrollToBottom() {
    if (!virtualizer || items.length === 0) return;
    shouldStickToBottom = !hasNewer;
    await scrollLastItemIntoView(beginScrollCommand());
  }

  async function scrollLastItemIntoView(generation = beginScrollCommand()) {
    if (!virtualizer || !scrollEl || items.length === 0) return;
    const key = viewKey;
    if (document.activeElement === scrollEl) scrollEl.blur();
    let previousScrollSize = -1;
    // Re-pin until virtua measures the keyed item's final size. All seeks write
    // the viewport directly: virtua's imperative API retains resize callbacks
    // that outlive this owner's command generation.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await tick();
      if (!virtualizer || !scrollEl || !isCurrentScrollCommand(key, generation)) return;
      shouldStickToBottom = !hasNewer;
      suppressProgrammaticPagination(2);
      scrollEl.scrollTop = scrollEl.scrollHeight;
      await nextFrame();
      if (!virtualizer || !isCurrentScrollCommand(key, generation)) return;
      const scrollSize = virtualizer.getScrollSize();
      const measurementStable =
        previousScrollSize >= 0 && Math.abs(scrollSize - previousScrollSize) <= ANCHOR_THRESHOLD_PX;
      previousScrollSize = scrollSize;
      if (measurementStable && checkAtBottom()) break;
    }
    revealed = true;
    shouldStickToBottom = !hasNewer;
    if (checkAtBottom()) {
      atBottom = true;
      notifyReachedBottom(true);
    }
    emitHistorySettled();
  }

  function stopMiddleAutoscroll() {
    const pointerID = middleAutoscrollPointerID;
    middleAutoscrollPointerID = null;
    middleAutoscrolling = false;
    middleAutoscrollTimestamp = 0;
    if (middleAutoscrollFrame !== undefined) {
      window.cancelAnimationFrame(middleAutoscrollFrame);
      middleAutoscrollFrame = undefined;
    }
    if (scrollEl && pointerID !== null && scrollEl.hasPointerCapture(pointerID)) {
      scrollEl.releasePointerCapture(pointerID);
    }
  }

  function animateMiddleAutoscroll(timestamp: number) {
    if (!middleAutoscrolling || !scrollEl) return;
    const elapsed = middleAutoscrollTimestamp
      ? Math.min(50, timestamp - middleAutoscrollTimestamp)
      : 1000 / 60;
    middleAutoscrollTimestamp = timestamp;
    const velocity = middleAutoscrollVelocity(
      middleAutoscrollCurrentY - middleAutoscrollAnchorY,
    );
    if (velocity) scrollEl.scrollTop += (velocity * elapsed) / 1000;
    middleAutoscrollFrame = window.requestAnimationFrame(animateMiddleAutoscroll);
  }

  function handleMiddlePointerDown(event: PointerEvent) {
    if (event.button !== MIDDLE_MOUSE_BUTTON || !scrollEl || !virtualizer) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(MIDDLE_SCROLL_INTERACTIVE_TARGETS)) return;
    interruptScroll();
    event.preventDefault();
    event.stopPropagation();
    stopMiddleAutoscroll();
    const hostBounds = scrollEl.parentElement?.getBoundingClientRect() ?? scrollEl.getBoundingClientRect();
    middleAutoscrollPointerID = event.pointerId;
    middleAutoscrollAnchorX = event.clientX - hostBounds.left;
    middleAutoscrollAnchorY = event.clientY - hostBounds.top;
    middleAutoscrollCurrentY = event.clientY - hostBounds.top;
    middleAutoscrolling = true;
    scrollEl.setPointerCapture(event.pointerId);
    middleAutoscrollFrame = window.requestAnimationFrame(animateMiddleAutoscroll);
  }

  function handleMiddlePointerMove(event: PointerEvent) {
    if (!middleAutoscrolling || event.pointerId !== middleAutoscrollPointerID || !scrollEl) return;
    event.preventDefault();
    const hostBounds = scrollEl.parentElement?.getBoundingClientRect() ?? scrollEl.getBoundingClientRect();
    middleAutoscrollCurrentY = event.clientY - hostBounds.top;
  }

  function handleMiddlePointerEnd(event: PointerEvent) {
    if (event.pointerId !== middleAutoscrollPointerID) return;
    event.preventDefault();
    event.stopPropagation();
    stopMiddleAutoscroll();
  }

  function handleMiddleAuxClick(event: MouseEvent) {
    if (event.button !== MIDDLE_MOUSE_BUTTON) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(MIDDLE_SCROLL_INTERACTIVE_TARGETS)) return;
    event.preventDefault();
  }

  $effect(() => {
    if (middleAutoscrollViewKey === viewKey) return;
    stopMiddleAutoscroll();
    middleAutoscrollViewKey = viewKey;
  });

  $effect(() => {
    if (!scrollEl) return;
    const el = scrollEl;
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.deltaY === 0) return;
      interruptScroll();
      if (event.deltaY > 0 && hasNewer && checkAtBottom()) {
        newerEdgeConsumed = true;
        onLoadNewer?.("wheel");
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        !(target instanceof HTMLElement) ||
        target.isContentEditable ||
        target.closest("input, textarea, select") ||
        (event.key === " " && target.closest("button, [role=button]"))
      ) return;
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
        interruptScroll();
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!event.defaultPrevented && event.touches.length === 1) interruptScroll();
    };
    const onPointerDown = (event: PointerEvent) => {
      // Native scrollbar presses target the scrollport, not a message child.
      if (event.target === el && event.button === 0) interruptScroll();
      handleMiddlePointerDown(event);
    };
    const onWindowBlur = () => stopMiddleAutoscroll();
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", handleMiddlePointerMove);
    el.addEventListener("pointerup", handleMiddlePointerEnd);
    el.addEventListener("pointercancel", handleMiddlePointerEnd);
    el.addEventListener("lostpointercapture", handleMiddlePointerEnd);
    el.addEventListener("auxclick", handleMiddleAuxClick);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      stopMiddleAutoscroll();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", handleMiddlePointerMove);
      el.removeEventListener("pointerup", handleMiddlePointerEnd);
      el.removeEventListener("pointercancel", handleMiddlePointerEnd);
      el.removeEventListener("lostpointercapture", handleMiddlePointerEnd);
      el.removeEventListener("auxclick", handleMiddleAuxClick);
      window.removeEventListener("blur", onWindowBlur);
    };
  });

  $effect(() => {
    if (!scrollEl) return;
    const handlePageKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== "PageUp" && event.key !== "PageDown") ||
        !scrollEl ||
        !virtualizer
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"]')) return;
      const editable = target?.closest("input, textarea, select, [contenteditable='true']");
      if (editable && !target?.closest(".composer-editor__content")) return;
      event.preventDefault();
      interruptScroll();
      const direction = event.key === "PageUp" ? -1 : 1;
      scrollEl.scrollTop += pageScrollDelta(scrollEl.clientHeight, direction);
    };
    window.addEventListener("keydown", handlePageKey);
    return () => window.removeEventListener("keydown", handlePageKey);
  });

  function findMessageIndex(messageID: string): number {
    return items.findIndex(
      (it) => it.kind === "group" && it.group.messages.some((m) => m.id === messageID),
    );
  }

  // History loader: render it only while an older page is actively being
  // fetched/settled. Keeping an idle block above the virtualizer changes the
  // effective start offset after restore and can make bottom land short.
  const SKELETON_ROW_PX = 52;
  let skeletonRows = $derived.by(() => {
    if (!hasOlder || loading || !prepending) return 0;
    const target = Math.max(viewportHeight, 480);
    return Math.max(4, Math.ceil(target / SKELETON_ROW_PX));
  });

  $effect(() => {
    if (!scrollEl) return;
    const measure = () => {
      if (scrollEl) viewportHeight = scrollEl.clientHeight;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  });

  let prevSkeletonHeight = 0;
  $effect(() => {
    if (!historyLoaderEl || !scrollEl) {
      historyLoaderHeight = 0;
      prevSkeletonHeight = 0;
      return;
    }
    const el = historyLoaderEl;
    const apply = () => {
      const next = el.offsetHeight;
      const prev = prevSkeletonHeight;
      historyLoaderHeight = next;
      prevSkeletonHeight = next;
      // Skip the first measurement; initial mount is handled by restoration.
      if (prev > 0 && next !== prev) {
        const delta = next - prev;
        if (scrollEl && scrollEl.scrollTop > 0) scrollEl.scrollTop += delta;
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      historyLoaderHeight = 0;
      prevSkeletonHeight = 0;
    };
  });

  function findDividerIndex(): number {
    return items.findIndex((it) => it.kind === "divider");
  }

  function maxLoadedSeq(): number {
    let seq = 0;
    for (const message of messages) {
      seq = Math.max(seq, message.channel_seq || 0);
    }
    return seq;
  }

  function markUnreadRead() {
    dismissedUnreadViewKey = viewKey;
    dismissedUnreadBoundarySeq = unreadBoundarySeq;
    dismissedUnreadCount = unreadCount;
    onMarkRead?.(maxLoadedSeq());
  }

  function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function isCurrentView(key: string): boolean {
    return key === viewKey && key === lastViewKey;
  }

  async function settleVirtualTarget(
    key: string,
    generation: number,
    indexForTarget: () => number,
    selector: string,
    pixelOffset = 0,
  ): Promise<boolean> {
    suppressProgrammaticPagination(3);
    for (let attempt = 0; attempt < 24; attempt++) {
      if (!isCurrentScrollCommand(key, generation)) return false;
      if (!virtualizer || !scrollEl) return false;
      const target = scrollEl.querySelector<HTMLElement>(selector);
      if (target) {
        const delta = target.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top - pixelOffset;
        if (Math.abs(delta) <= ANCHOR_THRESHOLD_PX) return true;
        scrollEl.scrollTop += delta;
      } else {
        const idx = indexForTarget();
        if (idx < 0) return false;
        scrollEl.scrollTop = historyLoaderHeight + virtualizer.getItemOffset(idx);
      }
      await nextFrame();
    }
    return false;
  }

  function scrollToTarget(
    indexForTarget: () => number,
    selector: string,
    onUnsettled?: () => void,
  ): boolean {
    if (!virtualizer || indexForTarget() < 0) return false;
    shouldStickToBottom = false;
    const key = viewKey;
    const generation = beginScrollCommand();
    void settleVirtualTarget(key, generation, indexForTarget, selector).then(async (settled) => {
      if (!isCurrentScrollCommand(key, generation)) return;
      emitHistorySettled();
      // Settling can remove the history loader above the target.
      await tick();
      if (!isCurrentScrollCommand(key, generation)) return;
      if (settled) settled = await settleVirtualTarget(key, generation, indexForTarget, selector);
      if (!settled && isCurrentScrollCommand(key, generation)) onUnsettled?.();
    });
    return true;
  }

  function scrollToMessage(messageID: string): boolean {
    return scrollToTarget(
      () => findMessageIndex(messageID),
      `[data-message-id="${CSS.escape(messageID)}"]`,
    );
  }

  function scrollToDivider(fallbackToAround = true): boolean {
    return scrollToTarget(
      findDividerIndex,
      "[data-unread-divider='true']",
      fallbackToAround ? onJumpToUnread : undefined,
    );
  }

  function jumpToUnreadBoundary() {
    if (canUseUnreadDivider && scrollToDivider(false)) return;
    if (onJumpToUnread) {
      onJumpToUnread();
      return;
    }
  }

  function captureState(): MessageListState | null {
    if (!virtualizer || !scrollEl) return null;
    capturedScrollState = { atBottom: checkAtBottom() };
    capturedScrollGeneration = scrollCommandGeneration;
    if (!capturedScrollState.atBottom) {
      const top = scrollEl.getBoundingClientRect().top;
      for (const row of scrollEl.querySelectorAll<HTMLElement>("[data-message-id]")) {
        const bounds = row.getBoundingClientRect();
        if (bounds.bottom <= top) continue;
        capturedScrollState.anchorMessageID = row.dataset.messageId;
        capturedScrollState.anchorPixelOffset = bounds.top - top;
        break;
      }
    }
    return capturedScrollState;
  }

  $effect(() => {
    onListRef({
      scrollToBottom,
      scrollToMessage,
      scrollToDivider,
      captureState,
      isFollowing: () => shouldStickToBottom,
      isNearBottom: (tolerancePx?: number) => checkNearBottom(tolerancePx),
    });
    return () => onListRef(null);
  });

  // Drive scroll on data change. Mirrors the official chat example's
  // useEffect([items]): if shouldStickToBottom, pin to last index. The flag is
  // the source of truth — last user scroll set it, item-append doesn't move it.
  $effect(() => {
    const key = viewKey;
    const count = items.length;
    const layoutRevision = preambleLayoutRevision;
    // Ordinary messages can grow an existing group without adding a virtual item.
    const newestMessageID = messages.at(-1)?.id || "";
    const newestMessageChanged = newestMessageID !== lastMessageID;
    lastMessageID = newestMessageID;

    if (key !== lastViewKey) {
      lastViewKey = key;
      lastItemCount = count;
      lastPreambleLayoutRevision = layoutRevision;
      lastRestoreState = restoreState;
      capturedScrollState = undefined;
      shouldStickToBottom = true;
      atBottom = true;
      revealed = false;
      newerEdgeConsumed = false;
      startRestore(key, restoreState, true);
      return;
    }

    const target = restoreState;
    const restoreChanged = target && target !== lastRestoreState;
    if (restoreChanged) {
      // Only the first admission of a capture yields to intervening input.
      const interrupted = target === capturedScrollState && capturedScrollGeneration !== scrollCommandGeneration;
      capturedScrollState = undefined;
      lastRestoreState = target;
      if (!interrupted && (target.atBottom || target.anchorMessageID)) {
        lastItemCount = count;
        lastPreambleLayoutRevision = layoutRevision;
        startRestore(key, target, target.atBottom);
        return;
      }
      if (interrupted && !shouldStickToBottom && virtualizer) {
        handleScroll(virtualizer.getScrollOffset());
      }
    }

    const dataChanged =
      restoreChanged || count !== lastItemCount || newestMessageChanged || layoutRevision !== lastPreambleLayoutRevision;
    if (dataChanged && shouldStickToBottom && !hasNewer && !pendingRestore) {
      void scrollLastItemIntoView();
    } else if (dataChanged && !pendingRestore) {
      void emitSettledAfterFrames(key);
    }
    lastItemCount = count;
    lastPreambleLayoutRevision = layoutRevision;
  });

  async function emitSettledAfterFrames(key: string, generation = scrollCommandGeneration) {
    await tick();
    await nextFrame();
    if (isCurrentScrollCommand(key, generation)) emitHistorySettled();
  }

  function startRestore(key: string, target: MessageListState | undefined, fallbackToBottom: boolean) {
    pendingRestore = true;
    const restore = runRestore(key, target, fallbackToBottom);
    const generation = scrollCommandGeneration;
    const timeout = window.setTimeout(() => {
      if (!pendingRestore || !isCurrentScrollCommand(key, generation)) return;
      console.error("message history restore timed out");
      beginScrollCommand();
      emitHistorySettled();
    }, RESTORE_FAIL_OPEN_MS);
    void restore
      .catch((error) => {
        if (!isCurrentScrollCommand(key, generation)) return;
        console.error("message history restore failed", error);
        beginScrollCommand();
        emitHistorySettled();
      })
      .finally(() => window.clearTimeout(timeout));
  }

  async function runRestore(key: string, target: MessageListState | undefined, fallbackToBottom: boolean) {
    const generation = beginScrollCommand(false);
    const anchorID = target && !target.atBottom ? target.anchorMessageID : undefined;
    const settleAnchor = anchorID
      ? () => settleVirtualTarget(
          key, generation, () => findMessageIndex(anchorID),
          `[data-message-id="${CSS.escape(anchorID)}"]`, target?.anchorPixelOffset ?? 0,
        )
      : undefined;
    let restoredToUnreadDivider = false;
    await tick();
    await nextFrame();
    if (!isCurrentScrollCommand(key, generation)) return;
    if (settleAnchor) {
      const restored = await settleAnchor();
      if (!isCurrentScrollCommand(key, generation)) return;
      if (!restored && fallbackToBottom) await scrollLastItemIntoView(generation);
      else shouldStickToBottom = false;
    } else {
      const dividerIdx = items.findIndex((it) => it.kind === "divider");
      if (dividerIdx >= 0 && virtualizer) {
        restoredToUnreadDivider = true;
        await settleVirtualTarget(
          key,
          generation,
          () => findDividerIndex(),
          "[data-unread-divider='true']",
        );
        shouldStickToBottom = false;
      } else {
        await scrollLastItemIntoView(generation);
      }
    }
    await nextFrame();
    if (!isCurrentScrollCommand(key, generation)) return;
    pendingRestore = false;
    revealed = true;
    atBottom = checkAtBottom();
    shouldStickToBottom = atBottom && !hasNewer;
    if (!restoredToUnreadDivider) {
      if (atBottom) notifyReachedBottom();
      if (virtualizer) handleScroll(virtualizer.getScrollOffset());
    }
    emitHistorySettled();
    if (settleAnchor) {
      // Removing the history loader changes the row's viewport position.
      await tick();
      if (isCurrentScrollCommand(key, generation)) await settleAnchor();
    }
  }

  function handleScroll(offset: number) {
    if (!virtualizer || (pendingRestore && !revealed)) return;
    const distance = virtuaBottomDistance();
    const sticky = checkAtBottom();
    const nearNewer = sticky || distance <= NEWER_LOAD_THRESHOLD_PX;
    shouldStickToBottom = sticky && !hasNewer;
    atBottom = sticky;
    if (!hasNewer) newerEdgeConsumed = false;
    if (!sticky && hasOlder && offset - historyLoaderHeight <= OLDER_LOAD_THRESHOLD_PX) onLoadOlder?.();
    if (!suppressPagination && hasNewer && nearNewer && !newerEdgeConsumed) {
      newerEdgeConsumed = true;
      onLoadNewer?.("scroll");
    }
    if (sticky && !suppressPagination) notifyReachedBottom();
  }
</script>

<div
  class="messages"
  class:is-revealing={loading || (!revealed && messages.length > 0)}
  role="log"
  aria-live="polite"
  onpointerdown={onActivateMessageComposer}
  onpointerup={onInlineImagePointerUp}
>
  {#if !loading && messages.length === 0}
    <div class="empty">
      <div class="empty-icon">
        {#if selectedDirect}@{:else}#{/if}
      </div>
      <strong>
        {#if selectedDirect}
          This is the start of your conversation with {dmTitle(selectedDirect, currentUserID)}.
        {:else if selectedChannel}
          Welcome to #{channelDisplayTitle(selectedChannel)}!
        {:else}
          Pick a channel to get started.
        {/if}
      </strong>
      <span>Send a message in Markdown — code fences, lists, links all work. Threads open from any message.</span>
    </div>
  {:else if messages.length > 0}
    <div
      class="messages-scroll"
      class:is-middle-autoscrolling={middleAutoscrolling}
      bind:this={scrollEl}
      tabindex="-1"
    >
      <div class="messages-spacer"></div>
      {#if skeletonRows > 0}
        <div
          class="messages-history-pad"
          bind:this={historyLoaderEl}
          aria-hidden={loadingOlder ? "false" : "true"}
        >
          <HistoryLoader direction="older" rows={skeletonRows} />
        </div>
      {/if}
      <!-- Keep revealed controls clickable while virtua debounces scroll-end. -->
      <Virtualizer
        bind:this={virtualizer}
        data={items}
        getKey={(item: Item) => item.id}
        itemProps={() => loading || !revealed ? undefined : { style: { "pointer-events": "auto" } }}
        scrollRef={scrollEl}
        shift={prepending}
        startMargin={historyLoaderHeight}
        onscroll={handleScroll}
      >
        {#snippet children(item: Item, _index: number)}
          {#if item.kind === "loader"}
            <HistoryLoader direction={item.direction} rows={item.rows} />
          {:else if item.kind === "day"}
            <div class="day-divider"><span>{item.label}</span></div>
          {:else if item.kind === "divider"}
            <div
              class="new-messages-divider"
              class:is-clearing={unreadClearing}
              data-unread-divider="true"
              role="separator"
              aria-label="New messages"
            >
              <span>New</span>
            </div>
          {:else if item.kind === "group"}
            <MessageGroup
              group={item.group}
              {autoLoadAttachmentIDs}
              {currentUserID}
              {reactionController}
              {reactionsDisabled}
              {selectedThreadID}
              {mentionPeople}
              {mentionAttentionUserID}
              {replyContext}
              {canDeleteAnyMessage}
              {deletingMessageIDs}
              {editController}
              {editScope}
              {onMessageEdited}
              {onOpenProfile}
              {onReply}
              {onOpenThread}
              {onJumpToQuote}
              {onOpenImage}
              {onOpenArtifact}
              {onAddAttachmentToMessage}
              {onResend}
              {onRetry}
              {onDiscard}
              {onDeleteMessage}
              {topics}
              {onSelectTopic}
              {channelID}
              {pinnedMessageIDs}
              {onTogglePin}
              {onCopyLink}
              activeDecisionID={liveDecisionID}
              {onDecisionAnswer}
              {onDecisionPrefill}
            />
          {/if}
        {/snippet}
      </Virtualizer>
    </div>
  {/if}
  {#if middleAutoscrolling}
    <div
      class="middle-autoscroll-anchor"
      style={`left: ${middleAutoscrollAnchorX}px; top: ${middleAutoscrollAnchorY}px;`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 28 36" width="18" height="24">
        <path fill="currentColor" d="m14 1 5 6h-3v7h-4V7H9l5-6Zm0 34-5-6h3v-7h4v7h3l-5 6Z"/>
        <circle cx="14" cy="18" r="3" fill="currentColor"/>
      </svg>
    </div>
  {/if}
  {#if messageAudioOverlayVisible}
    <div
      class="message-audio-overlay"
      role="group"
      aria-label="Text-to-speech playback controls"
      data-testid="message-audio-overlay"
    >
      <button
        type="button"
        class="message-audio-overlay__control"
        aria-label="Restart playback"
        data-tooltip="Restart"
        onclick={() => void messageAudioPlayback.restart()}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 4v6h6M5.8 15a7 7 0 1 0 .2-6.9L4 10"/>
        </svg>
      </button>
      <button
        type="button"
        class="message-audio-overlay__control message-audio-overlay__control--primary"
        aria-label={$messageAudioPlayback.status === "playing" ? "Pause playback" : "Resume playback"}
        data-tooltip={$messageAudioPlayback.status === "playing" ? "Pause" : "Play"}
        onclick={toggleActiveMessageAudio}
      >
        {#if $messageAudioPlayback.status === "playing"}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="M7 5h4v14H7zm6 0h4v14h-4z"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="m8 5 11 7-11 7V5Z"/>
          </svg>
        {/if}
      </button>
      <button
        type="button"
        class="message-audio-overlay__control"
        aria-label="Stop playback"
        data-tooltip="Stop"
        onclick={() => messageAudioPlayback.stop()}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>
        </svg>
      </button>
    </div>
  {/if}
  {#if !loading && messages.length > 0 && displayUnreadCount > 0}
    <div
      class="unread-bar"
      class:has-audio-overlay={messageAudioOverlayVisible}
      class:is-clearing={unreadClearing}
      role="status"
      aria-hidden={unreadClearing ? "true" : undefined}
    >
      <button
        type="button"
        class="unread-bar__jump"
        disabled={unreadClearing}
        onclick={jumpToUnreadBoundary}
        aria-label={`Jump to ${displayUnreadCount > 0 ? displayUnreadCount : ""} new message${displayUnreadCount === 1 ? "" : "s"}`.replace(/  +/g, " ")}
      >
        <span class="unread-bar__label">
          {displayUnreadCount > 99 ? "99+" : displayUnreadCount} new message{displayUnreadCount === 1 ? "" : "s"}{unreadSince ? ` since ${unreadSince}` : ""}
        </span>
      </button>
      <button
        type="button"
        class="unread-bar__mark"
        disabled={unreadClearing}
        onclick={markUnreadRead}
        aria-label="Mark as read"
      >
        <span>Mark read</span>
      </button>
    </div>
  {/if}
</div>
