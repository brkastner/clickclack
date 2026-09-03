import React, { useEffect, useMemo, useRef, useState } from "react";
import { createReactIsland, type ReactIsland } from "../../lib/react-island";
import { enhanceMarkdown } from "../../lib/actions/markdown";
import { enhanceMentions } from "../../lib/actions/mention-highlight";
import { classifyArtifact, artifactKindLabel } from "../../lib/artifacts";
import { markdown, time } from "../../lib/format";
import { recentAutoLoadAttachmentIDs } from "../../lib/media-loading";
import { formatBytes, uploadURL } from "../../lib/uploads";
import type { Message, Topic, Upload, User } from "../../lib/types";
import "./pinned-panel.css";

export type PinnedPanelProps = {
  messages: Message[];
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

function PinnedPanelFallback({ onClose, maxPins = 100 }: PinnedPanelProps) {
  return (
    <section className="pinned-panel" role="alert">
      <PanelHeader count={0} maxPins={maxPins} onClose={onClose} />
      <div className="pinned-panel__status pinned-panel__status--error">
        Pinned messages couldn’t be displayed.
      </div>
    </section>
  );
}

function PinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14 4 6 6-4 4v5l-2 2-5-5-4 4-1-1 4-4-5-5 2-2h5l4-4Z"
      />
    </svg>
  );
}

function PanelHeader({
  count,
  maxPins,
  onClose,
}: {
  count: number;
  maxPins: number;
  onClose: () => void;
}) {
  return (
    <header className="pinned-panel__header">
      <div className="pinned-panel__heading">
        <div className="pinned-panel__eyebrow">
          <PinIcon />
          <h2>Pinned messages</h2>
          <span>
            {count} of {maxPins}
          </span>
        </div>
        <p>Important messages saved for everyone in this channel.</p>
      </div>
      <button
        type="button"
        className="pinned-panel__close"
        aria-label="Close pinned panel"
        onClick={onClose}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            d="M18 6 6 18M6 6l12 12"
          />
        </svg>
      </button>
    </header>
  );
}

function MessageBody({
  message,
  people,
  attentionUserID,
}: {
  message: Message;
  people: User[];
  attentionUserID?: string;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => markdown(message.body), [message.body]);

  useEffect(() => {
    if (!bodyRef.current) return;
    const markdownEnhancement = enhanceMarkdown(bodyRef.current);
    const mentionEnhancement = enhanceMentions(bodyRef.current, { people, attentionUserID });
    return () => {
      markdownEnhancement.destroy();
      mentionEnhancement.destroy();
    };
  }, [html, people, attentionUserID]);

  return (
    <div
      ref={bodyRef}
      className="pinned-item__body markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Attachment({
  upload,
  attachments,
  eager,
  onOpenImage,
  onOpenArtifact,
}: {
  upload: Upload;
  attachments: Upload[];
  eager: boolean;
  onOpenImage: PinnedPanelProps["onOpenImage"];
  onOpenArtifact: PinnedPanelProps["onOpenArtifact"];
}) {
  const [manuallyLoaded, setManuallyLoaded] = useState(false);
  const loaded = eager || manuallyLoaded;
  const url = uploadURL(upload);
  const contentType = (upload.content_type || "").split(";")[0].trim().toLowerCase();
  const artifactKind = classifyArtifact(upload);
  const isImage = artifactKind === "unsupported" && contentType.startsWith("image/");
  const isVideo = artifactKind === "unsupported" && contentType.startsWith("video/");
  const isAudio = artifactKind === "unsupported" && contentType.startsWith("audio/");
  const canPreview = artifactKind !== "unsupported";

  if ((isImage || isVideo || isAudio) && !loaded) {
    return (
      <button
        type="button"
        className="media-tile media-tile--deferred"
        aria-label={`Load preview for ${upload.filename}`}
        onClick={() => setManuallyLoaded(true)}
      >
        <span className="media-tile__deferred-icon" aria-hidden="true">
          {isVideo ? "▶" : isAudio ? "♪" : "◫"}
        </span>
        <span className="media-tile__deferred-copy">
          <strong>{upload.filename}</strong>
          <small>Load preview · {formatBytes(upload.byte_size)}</small>
        </span>
      </button>
    );
  }
  if (isImage) {
    return (
      <button
        type="button"
        className="pinned-attachment pinned-attachment--image"
        aria-label={`Open image ${upload.filename}`}
        onClick={() => onOpenImage(url, upload.filename, attachments)}
      >
        <img src={url} alt={upload.filename} loading="lazy" decoding="async" />
      </button>
    );
  }
  if (isVideo)
    return (
      <video
        className="pinned-attachment"
        controls
        preload="metadata"
        src={url}
        aria-label={upload.filename}
      />
    );
  if (isAudio)
    return (
      <audio
        className="pinned-attachment"
        controls
        preload="metadata"
        src={url}
        aria-label={upload.filename}
      />
    );
  if (canPreview) {
    return (
      <button
        type="button"
        className="pinned-attachment pinned-attachment--file"
        onClick={() => onOpenArtifact(upload)}
      >
        <span>{artifactKindLabel(artifactKind)}</span>
        <strong>{upload.filename}</strong>
        <small>{formatBytes(upload.byte_size)}</small>
      </button>
    );
  }
  return (
    <a className="pinned-attachment pinned-attachment--file" href={url} download={upload.filename}>
      <span>FILE</span>
      <strong>{upload.filename}</strong>
      <small>{formatBytes(upload.byte_size)}</small>
    </a>
  );
}

function PinnedMessage({
  message,
  topic,
  people,
  attentionUserID,
  eagerAttachmentIDs,
  onOpenThread,
  onOpenImage,
  onOpenArtifact,
  onUnpin,
  onSelectTopic,
}: {
  message: Message;
  topic?: Topic;
  people: User[];
  attentionUserID?: string;
  eagerAttachmentIDs: ReadonlySet<string>;
  onOpenThread: PinnedPanelProps["onOpenThread"];
  onOpenImage: PinnedPanelProps["onOpenImage"];
  onOpenArtifact: PinnedPanelProps["onOpenArtifact"];
  onUnpin: PinnedPanelProps["onUnpin"];
  onSelectTopic?: PinnedPanelProps["onSelectTopic"];
}) {
  const [unpinning, setUnpinning] = useState(false);
  const [actionError, setActionError] = useState("");
  const unpin = async () => {
    if (unpinning) return;
    setUnpinning(true);
    setActionError("");
    try {
      await onUnpin(message);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not unpin message");
    } finally {
      setUnpinning(false);
    }
  };

  return (
    <article className="pinned-item" data-message-id={message.id}>
      <div className="pinned-item__meta">
        <div className="pinned-item__identity">
          <span className="pinned-item__avatar" aria-hidden="true">
            {(message.author?.display_name || "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="pinned-item__author">{message.author?.display_name || "Unknown"}</span>
        </div>
        <time dateTime={message.created_at}>{time(message.created_at)}</time>
      </div>
      {topic &&
        (onSelectTopic ? (
          <button type="button" className="message-topic" onClick={() => onSelectTopic(topic.id)}>
            {topic.name}
          </button>
        ) : (
          <span className="message-topic">{topic.name}</span>
        ))}
      <MessageBody message={message} people={people} attentionUserID={attentionUserID} />
      {message.attachments?.length ? (
        <div className="pinned-item__attachments">
          {message.attachments.map((upload) => (
            <Attachment
              key={upload.id}
              upload={upload}
              attachments={message.attachments || []}
              eager={eagerAttachmentIDs.has(upload.id)}
              onOpenImage={onOpenImage}
              onOpenArtifact={onOpenArtifact}
            />
          ))}
        </div>
      ) : null}
      {actionError && (
        <p className="pinned-item__error" role="status">
          {actionError}
        </p>
      )}
      <div className="pinned-item__actions">
        <button type="button" aria-label="Open thread" onClick={() => onOpenThread(message)}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 12a8 8 0 0 1-11.6 7.16L3 21l1.84-6.4A8 8 0 1 1 21 12Z"
            />
          </svg>
          <span>Thread</span>
        </button>
        <button
          type="button"
          className="danger"
          aria-label="Unpin message"
          disabled={unpinning}
          onClick={() => void unpin()}
        >
          <PinIcon size={14} />
          <span>{unpinning ? "Unpinning…" : "Unpin"}</span>
        </button>
      </div>
    </article>
  );
}

function PinnedPanel({
  messages,
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
}: PinnedPanelProps) {
  const topicsByID = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics]);
  const eagerAttachmentIDs = useMemo(() => recentAutoLoadAttachmentIDs(messages), [messages]);
  return (
    <section className="pinned-panel">
      <PanelHeader count={messages.length} maxPins={maxPins} onClose={onClose} />
      <div className="pinned-panel__body">
        {loading ? (
          <div className="pinned-panel__status">Loading pinned messages…</div>
        ) : error ? (
          <div className="pinned-panel__status pinned-panel__status--error">{error}</div>
        ) : messages.length === 0 ? (
          <div className="pinned-panel__empty">
            <span>
              <PinIcon size={22} />
            </span>
            <strong>No pinned messages yet</strong>
            <p>Pin anything worth keeping close.</p>
          </div>
        ) : (
          <div className="pinned-panel__list">
            {messages.map((message) => (
              <PinnedMessage
                key={message.id}
                message={message}
                topic={message.topic_id ? topicsByID.get(message.topic_id) : undefined}
                people={mentionPeople}
                attentionUserID={mentionAttentionUserID}
                eagerAttachmentIDs={eagerAttachmentIDs}
                onOpenThread={onOpenThread}
                onOpenImage={onOpenImage}
                onOpenArtifact={onOpenArtifact}
                onUnpin={onUnpin}
                onSelectTopic={onSelectTopic}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export type PinnedPanelIsland = ReactIsland<PinnedPanelProps>;

export const mountPinnedPanelIsland = createReactIsland<PinnedPanelProps>({
  name: "Pinned messages",
  component: PinnedPanel,
  fallback: PinnedPanelFallback,
});
