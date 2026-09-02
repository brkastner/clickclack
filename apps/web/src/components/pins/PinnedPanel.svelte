<script lang="ts">
  import { enhanceMarkdown } from "../../lib/actions/markdown";
  import { enhanceMentions } from "../../lib/actions/mention-highlight";
  import { markdown, time } from "../../lib/format";
  import { uploadURL } from "../../lib/uploads";
  import type { Channel, Message, Topic, Upload, User } from "../../lib/types";
  import MediaAttachment from "../MediaAttachment.svelte";
  import TopicBadge from "../messages/TopicBadge.svelte";

  type Props = {
    messages: Message[];
    channel?: Channel;
    loading?: boolean;
    error?: string;
    topics?: Topic[];
    mentionPeople?: User[];
    mentionAttentionUserID?: string;
    maxPins?: number;
    onClose: () => void;
    onOpenThread: (message: Message) => void;
    onOpenImage: (url: string, title: string, attachments: Upload[]) => void;
    onOpenArtifact: (upload: Upload) => void;
    onUnpin: (message: Message) => Promise<void>;
    onSelectTopic?: (topicID: string) => void;
  };

  let {
    messages,
    channel,
    loading = false,
    error = "",
    topics = [],
    mentionPeople = [],
    mentionAttentionUserID,
    maxPins = 100,
    onClose,
    onOpenThread,
    onOpenImage,
    onOpenArtifact,
    onUnpin,
    onSelectTopic,
  }: Props = $props();
  let unpinningMessageIDs = $state(new Set<string>());
  let actionError = $state("");

  async function unpinMessage(message: Message) {
    if (unpinningMessageIDs.has(message.id)) return;
    unpinningMessageIDs = new Set(unpinningMessageIDs).add(message.id);
    actionError = "";
    try {
      await onUnpin(message);
    } catch (caught) {
      actionError = caught instanceof Error ? caught.message : "Could not unpin message";
    } finally {
      const next = new Set(unpinningMessageIDs);
      next.delete(message.id);
      unpinningMessageIDs = next;
    }
  }
</script>

<div class="pinned-panel">
  <header class="pinned-panel__header">
    <div>
      <h2 class="pinned-panel__title">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m14 4 6 6-4 4v5l-2 2-5-5-4 4-1-1 4-4-5-5 2-2h5l4-4Z" />
        </svg>
        Pinned Messages
        <span class="pinned-panel__count">{messages.length} / {maxPins} pinned</span>
      </h2>
      <p class="pinned-panel__limit">Shared across this channel, with a maximum of {maxPins} messages.</p>
    </div>
    <button type="button" class="pinned-panel__close" aria-label="Close pinned panel" onclick={onClose}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  </header>

  <div class="pinned-panel__body">
    {#if loading}
      <div class="pinned-panel__status">Loading...</div>
    {:else if error}
      <div class="pinned-panel__status pinned-panel__status--error">{error}</div>
    {:else}
      {#if actionError}
        <div class="pinned-panel__status pinned-panel__status--error" role="status">{actionError}</div>
      {/if}
      {#if messages.length === 0}
        <div class="pinned-panel__empty">
        <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="m14 4 6 6-4 4v5l-2 2-5-5-4 4-1-1 4-4-5-5 2-2h5l4-4Z" />
        </svg>
        <p>No pinned messages</p>
        <p class="pinned-panel__hint">Pin important messages to keep them easily accessible.</p>
        </div>
      {:else}
        <div class="pinned-panel__list">
        {#each messages as message (message.id)}
          {@const presentedMessage = message}
          {@const topic = topics.find((candidate) => candidate.id === message.topic_id)}
          <div class="pinned-panel__item" data-message-id={message.id}>
            <div class="pinned-item__meta">
              <span class="pinned-item__author">{presentedMessage.author?.display_name || "Unknown"}</span>
              <time class="pinned-item__time">{time(message.created_at)}</time>
            </div>
            <TopicBadge {topic} onSelect={onSelectTopic} />
            <div
              class="pinned-item__body markdown"
              use:enhanceMarkdown
              use:enhanceMentions={{ people: mentionPeople, attentionUserID: mentionAttentionUserID }}
            >{@html markdown(message.body)}</div>
            {#if message.attachments?.length}
              <div class="attachment-grid">
                {#each message.attachments as attachment (attachment.id)}
                  <MediaAttachment
                    upload={attachment}
                    url={uploadURL(attachment)}
                    attachments={message.attachments}
                    onOpenImage={onOpenImage}
                    onOpenArtifact={onOpenArtifact}
                  />
                {/each}
              </div>
            {/if}
            <div class="pinned-item__actions">
              <button
                type="button"
                class="pinned-item__action"
                aria-label="Open thread"
                onclick={() => onOpenThread(message)}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 12a8 8 0 0 1-11.6 7.16L3 21l1.84-6.4A8 8 0 1 1 21 12Z"/>
                </svg>
              </button>
              <button
                type="button"
                class="pinned-item__action pinned-item__action--danger"
                aria-label="Unpin message"
                title="Unpin"
                disabled={unpinningMessageIDs.has(message.id)}
                onclick={() => unpinMessage(message)}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m14 4 6 6-4 4v5l-2 2-5-5-4 4-1-1 4-4-5-5 2-2h5l4-4Z"/>
                </svg>
              </button>
            </div>
          </div>
        {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .pinned-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--panel, #fff);
    border-left: 1px solid var(--border, #e0e0e0);
    min-width: 320px;
    max-width: 420px;
  }

  .pinned-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border, #e0e0e0);
    flex-shrink: 0;
  }

  .pinned-panel__title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    margin: 0;
    color: var(--text, #1a1a1a);
  }

  .pinned-panel__count {
    color: var(--muted);
    font-size: 11px;
    font-weight: 550;
  }

  .pinned-panel__limit {
    margin: 3px 0 0 22px;
    color: var(--muted);
    font-size: 11px;
  }

  .pinned-panel__close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    color: var(--text-muted, #666);
    transition: background 0.1s;
  }

  .pinned-panel__close:hover {
    background: var(--hover, rgba(0,0,0,0.06));
  }

  .pinned-panel__body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
  }

  .pinned-panel__status {
    padding: 20px;
    text-align: center;
    color: var(--text-muted, #666);
    font-size: 13px;
  }

  .pinned-panel__status--error {
    color: var(--danger, #e03e2f);
  }

  .pinned-panel__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: var(--text-muted, #999);
    text-align: center;
  }

  .pinned-panel__empty svg {
    margin-bottom: 12px;
    opacity: 0.5;
  }

  .pinned-panel__empty p {
    margin: 2px 0;
    font-size: 14px;
  }

  .pinned-panel__hint {
    font-size: 12px !important;
    opacity: 0.7;
  }

  .pinned-panel__list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .pinned-panel__item {
    padding: 10px 12px;
    border-radius: var(--radius, 8px);
    background: var(--bg-subtle, #f8f8f8);
    border: 1px solid var(--border, #eee);
  }

  .pinned-item__meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .pinned-item__author {
    font-size: 13px;
    font-weight: 600;
    color: var(--text, #1a1a1a);
  }

  .pinned-item__time {
    font-size: 11px;
    color: var(--text-muted, #999);
  }

  .pinned-item__body {
    font-size: 13px;
    line-height: 1.4;
    color: var(--text, #1a1a1a);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }

  .pinned-item__body :global(p) {
    margin: 0;
  }

  .attachment-grid {
    display: flex;
    gap: 4px;
    margin-top: 4px;
    flex-wrap: wrap;
  }

  .pinned-item__actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
    justify-content: flex-end;
  }

  .pinned-item__action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    color: var(--text-muted, #888);
    transition: background 0.1s, color 0.1s;
  }

  .pinned-item__action:hover {
    background: var(--hover, rgba(0,0,0,0.06));
    color: var(--text, #1a1a1a);
  }

  .pinned-item__action--danger:hover {
    background: color-mix(in srgb, var(--danger, #e03e2f) 10%, transparent);
    color: var(--danger, #e03e2f);
  }
</style>
