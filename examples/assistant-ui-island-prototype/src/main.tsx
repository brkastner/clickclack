import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  type AppendMessage,
  type ThreadMessageLike,
  useAuiState,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import {
  MarkdownTextPrimitive,
  type MarkdownTextPrimitiveProps,
} from "@assistant-ui/react-markdown";
import {
  Check,
  Clipboard,
  Copy,
  Ellipsis,
  MessageCircleReply,
  LoaderCircle,
  MessageSquare,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  SmilePlus,
  Trash2,
  Volume2,
} from "lucide-react";
import { StrictMode, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import remarkGfm from "remark-gfm";
import "./prototype.css";

type ActivityItem =
  | { id: string; type: "commentary"; body: string }
  | { id: string; type: "tool"; name: string; detail: string; full: string };

type ActivityBlock = {
  final: boolean;
  items: ActivityItem[];
};

type ClickClackMessage = {
  id: string;
  authorKind: "user" | "bot";
  authorName: string;
  handle: string;
  avatarURL: string;
  body: string;
  createdAt: string;
  edited?: boolean;
  pinned?: boolean;
  reactions?: Record<string, number>;
  activity?: ActivityBlock;
};

type PrototypeSnapshot = {
  messages: ClickClackMessage[];
  isRunning: boolean;
  notice: string;
};

type MessageMetadata = {
  authorName: string;
  handle: string;
  avatarURL: string;
  edited: boolean;
  pinned: boolean;
  reactions: Record<string, number>;
  activity?: ActivityBlock;
};

type Listener = () => void;

class ClickClackPrototypeStore {
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private snapshot: PrototypeSnapshot = {
    messages: [
      {
        id: "user-1",
        authorKind: "user",
        authorName: "kas",
        handle: "@kas",
        avatarURL: "/avatars/kas.webp",
        body: "@claw please disable footer for kai, `/usage off` doesn't seem to be sticking",
        createdAt: new Date(Date.now() - 180_000).toISOString(),
      },
      {
        id: "assistant-1",
        authorKind: "bot",
        authorName: "клешня",
        handle: "@claw",
        avatarURL: "/avatars/claw.webp",
        body: "done. all **123/123 stored Kai sessions** now have `responseUsage: off`, and `/new` or reset preserves it. no restart needed.\n\nOpenClaw currently has no agent-level usage-footer default, so a completely new Kai destination may still inherit the global `full` default.",
        createdAt: new Date(Date.now() - 160_000).toISOString(),
        pinned: false,
        reactions: { "✅": 1 },
        activity: {
          final: true,
          items: [
            {
              id: "commentary-1",
              type: "commentary",
              body: "I’ll inspect the stored Kai sessions and the reset path before changing the default.",
            },
            {
              id: "tool-1",
              type: "tool",
              name: "exec",
              detail: "read session settings",
              full: "openclaw sessions list --agent kai --format json",
            },
            {
              id: "tool-2",
              type: "tool",
              name: "exec",
              detail: "update 123 session records",
              full: "responseUsage: off\nupdated: 123\nfailed: 0",
            },
          ],
        },
      },
      {
        id: "assistant-plain",
        authorKind: "bot",
        authorName: "клешня",
        handle: "@claw",
        avatarURL: "/avatars/claw.webp",
        body: "that covers the existing Kai destinations. I left the global default alone, so new non-Kai destinations keep their current footer behavior.",
        createdAt: new Date(Date.now() - 120_000).toISOString(),
        reactions: {},
      },
      {
        id: "user-2",
        authorKind: "user",
        authorName: "kas",
        handle: "@kas",
        avatarURL: "/avatars/kas.webp",
        body: "For segment two, the script should focus on the creative people in guild rather than scarlet placing. Regenerate it, check the dialogue, then stitch the final pass together.",
        createdAt: new Date(Date.now() - 70_000).toISOString(),
      },
      {
        id: "assistant-2",
        authorKind: "bot",
        authorName: "Kai",
        handle: "@kai",
        avatarURL: "/avatars/kai.webp",
        body: "got it. I’ll treat the guild’s creative work as the center of segment two, regenerate Scarlet and Kali only if the dialogue needs it, and keep the final audio pass consistent across Scarlet’s lines.",
        createdAt: new Date(Date.now() - 45_000).toISOString(),
        reactions: {},
        activity: {
          final: true,
          items: [
            {
              id: "commentary-2",
              type: "commentary",
              body: "I’m checking the current segment-two script and the last audio assembly notes.",
            },
            {
              id: "tool-3",
              type: "tool",
              name: "read",
              detail: "segment-2-script-v5.md",
              full: "Read the current dialogue and speaker ordering.",
            },
          ],
        },
      },
    ],
    isRunning: false,
    notice: "right-click any message or use its hover actions",
  };

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  regenerate = async (_parentId?: string | null) => {
    this.cancel(false);
    const assistant = [...this.snapshot.messages]
      .reverse()
      .find((message) => message.authorKind === "bot");
    if (!assistant) return;
    const chunks = [
      "I checked the current script and the latest audio notes. ",
      "The cleaner version keeps the guild’s creative work at the center, limits regenerated dialogue to Scarlet and Kali, ",
      "then applies the same v6 treatment before the final stitch.",
    ];
    this.patch({
      isRunning: true,
      notice: "OpenClaw turn streaming through the external store",
      messages: this.snapshot.messages.map((message) =>
        message.id === assistant.id
          ? {
              ...message,
              body: "",
              activity: {
                final: false,
                items: [
                  {
                    id: `commentary-${Date.now()}`,
                    type: "commentary",
                    body: "I’m checking the script, dialogue revisions, and the existing v6 audio pass.",
                  },
                  {
                    id: `tool-${Date.now()}`,
                    type: "tool",
                    name: "read",
                    detail: "segment two production notes",
                    full: "Inspecting script revision, regenerated dialogue, and final assembly constraints.",
                  },
                ],
              },
            }
          : message,
      ),
    });
    let index = 0;
    this.timer = setInterval(() => {
      const chunk = chunks[index++];
      if (!chunk) {
        this.cancel(false);
        this.patch({
          notice: "stream settled, activity collapsed automatically",
          messages: this.snapshot.messages.map((message) =>
            message.id === assistant.id && message.activity
              ? { ...message, activity: { ...message.activity, final: true } }
              : message,
          ),
        });
        return;
      }
      this.patch({
        messages: this.snapshot.messages.map((message) =>
          message.id === assistant.id ? { ...message, body: message.body + chunk } : message,
        ),
      });
    }, 560);
  };

  cancel = (recordNotice = true) => {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!this.snapshot.isRunning) return;
    this.patch({
      isRunning: false,
      notice: recordNotice ? "OpenClaw turn cancelled" : this.snapshot.notice,
    });
  };

  action = (messageId: string, action: string) => {
    this.patch({ notice: `${action} routed to ClickClack for ${messageId}` });
  };

  togglePin = (messageId: string) => {
    const message = this.snapshot.messages.find((candidate) => candidate.id === messageId);
    if (!message) return;
    this.patch({
      notice: `${message.pinned ? "unpinned" : "pinned"} ${messageId}`,
      messages: this.snapshot.messages.map((candidate) =>
        candidate.id === messageId ? { ...candidate, pinned: !candidate.pinned } : candidate,
      ),
    });
  };

  react = (messageId: string, emoji: string) => {
    this.patch({
      notice: `reacted ${emoji} to ${messageId}`,
      messages: this.snapshot.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              reactions: {
                ...message.reactions,
                [emoji]: (message.reactions?.[emoji] ?? 0) + 1,
              },
            }
          : message,
      ),
    });
  };

  delete = (messageId: string) => {
    this.patch({
      notice: `deleted ${messageId}`,
      messages: this.snapshot.messages.filter((message) => message.id !== messageId),
    });
  };

  private patch(update: Partial<PrototypeSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }
}

const store = new ClickClackPrototypeStore();

function convertMessage(message: ClickClackMessage): ThreadMessageLike {
  const metadata: MessageMetadata = {
    authorName: message.authorName,
    handle: message.handle,
    avatarURL: message.avatarURL,
    edited: message.edited === true,
    pinned: message.pinned === true,
    reactions: message.reactions ?? {},
    activity: message.activity,
  };
  return {
    id: message.id,
    role: message.authorKind === "bot" ? "assistant" : "user",
    content: [{ type: "text", text: message.body }],
    createdAt: new Date(message.createdAt),
    metadata: { custom: metadata },
  };
}

function PrototypeRuntimeProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const onNew = useCallback(async (_message: AppendMessage) => undefined, []);
  const onReload = useCallback(async (parentId: string | null) => store.regenerate(parentId), []);
  const onCancel = useCallback(async () => store.cancel(), []);
  const runtime = useExternalStoreRuntime({
    messages: snapshot.messages,
    isRunning: snapshot.isRunning,
    convertMessage,
    onNew,
    onReload,
    onCancel,
  });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

function useMessageMetadata() {
  const message = useAuiState((state) => state.message);
  return {
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    custom: message.metadata.custom as MessageMetadata | undefined,
  };
}

function preprocessMentions(text: string) {
  return text.replace(/(^|[\s([{])@([\p{L}\p{N}_-]+)/gu, "$1[@$2](#mention-$2)");
}

const markdownComponents: NonNullable<MarkdownTextPrimitiveProps["components"]> = {
  a: (props) => {
    const { node, href, children, ...linkProps } = props;
    void node;
    if (href?.startsWith("#mention-")) {
      return (
        <span className="mention" data-mention={href.slice("#mention-".length)}>
          {children}
        </span>
      );
    }
    return (
      <a href={href} {...linkProps}>
        {children}
      </a>
    );
  },
};

function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      preprocess={preprocessMentions}
      components={markdownComponents}
      className="message-markdown"
    />
  );
}

function MessageParts() {
  return (
    <MessagePrimitive.Parts>
      {({ part }) => {
        if (part.type === "text") return <MarkdownText />;
        return null;
      }}
    </MessagePrimitive.Parts>
  );
}

function Activity({ block }: { block: ActivityBlock }) {
  const [open, setOpen] = useState(!block.final);
  useEffect(() => setOpen(!block.final), [block.final]);
  return (
    <section className={`activity-card ${block.final ? "is-final" : "is-live"}`}>
      <button
        type="button"
        className="activity-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="thinking-icon">✦</span>
        <span className="activity-label">
          {block.final ? (open ? "Hide thinking" : "Show thinking") : "Thinking…"}
        </span>
        <span className="activity-state">
          {block.final ? `${block.items.length} steps` : "live"}
        </span>
        <span className={`activity-chevron ${open ? "open" : ""}`}>▸</span>
      </button>
      {open && (
        <div className="activity-flow">
          {block.items.map((item) =>
            item.type === "commentary" ? (
              <p key={item.id}>{item.body}</p>
            ) : (
              <details className="tool-row" key={item.id}>
                <summary>
                  <span>⌁</span>
                  <strong>{item.name}</strong>
                  <span>{item.detail}</span>
                </summary>
                <pre>{item.full}</pre>
              </details>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function MessageMenu({ open, close }: { open: boolean; close: () => void }) {
  const message = useMessageMetadata();
  const meta = message.custom;
  const run = (action: () => void) => {
    action();
    close();
  };
  return (
    <div
      className={`message-context-menu ${open ? "is-open" : ""}`}
      role="menu"
      aria-label="Message actions"
      aria-hidden={!open}
    >
      <button role="menuitem" onClick={() => run(() => store.action(message.id, "reply"))}>
        <MessageCircleReply /> Reply
      </button>
      <button role="menuitem" onClick={() => run(() => store.react(message.id, "👍"))}>
        <SmilePlus /> React
      </button>
      <button role="menuitem" onClick={() => run(() => store.action(message.id, "copy link"))}>
        <Clipboard /> Copy link
      </button>
      {message.role === "user" && (
        <button role="menuitem" onClick={() => run(() => store.action(message.id, "edit"))}>
          <Pencil /> Edit message
        </button>
      )}
      <button role="menuitem" onClick={() => run(() => store.togglePin(message.id))}>
        {meta?.pinned ? <PinOff /> : <Pin />} {meta?.pinned ? "Unpin" : "Pin"}
      </button>
      <div className="menu-separator" />
      <button
        className="danger"
        role="menuitem"
        onClick={() => run(() => store.delete(message.id))}
      >
        <Trash2 /> Delete
      </button>
    </div>
  );
}

type AudioActionState = "idle" | "generating" | "playing" | "ready";

function PlayAloudAction() {
  const message = useMessageMetadata();
  const [audioState, setAudioState] = useState<AudioActionState>("idle");

  useEffect(() => {
    if (audioState === "generating") {
      const timer = window.setTimeout(() => setAudioState("playing"), 900);
      return () => window.clearTimeout(timer);
    }
    if (audioState === "playing") {
      const timer = window.setTimeout(() => setAudioState("ready"), 2400);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [audioState]);

  const label =
    audioState === "idle"
      ? "Play aloud"
      : audioState === "generating"
        ? "Generating speech"
        : audioState === "playing"
          ? "Pause playback"
          : "Play again";

  const activate = () => {
    if (audioState === "generating") return;
    if (audioState === "playing") {
      setAudioState("ready");
      return;
    }
    if (audioState === "idle") {
      store.action(message.id, "play aloud");
      setAudioState("generating");
      return;
    }
    store.action(message.id, "replay cached speech");
    setAudioState("playing");
  };

  return (
    <button
      type="button"
      className={`message-action message-audio-action is-${audioState}`}
      title={label}
      aria-label={label}
      aria-busy={audioState === "generating"}
      onClick={activate}
    >
      {audioState === "idle" && <Volume2 />}
      {audioState === "generating" && <LoaderCircle />}
      {audioState === "playing" && <Pause />}
      {audioState === "ready" && <Play />}
    </button>
  );
}

function MessageActions({ assistant, onMore }: { assistant: boolean; onMore: () => void }) {
  const message = useMessageMetadata();
  return (
    <ActionBarPrimitive.Root autohide="always" className="message-actions">
      <ActionBarPrimitive.Copy className="message-action" title="Copy message">
        <Copy className="copy-default" />
        <Check className="copy-confirmed" />
      </ActionBarPrimitive.Copy>
      <button
        type="button"
        className="message-action"
        title="Reply"
        onClick={() => store.action(message.id, "reply")}
      >
        <MessageCircleReply />
      </button>
      <button
        type="button"
        className="message-action"
        title="React"
        onClick={() => store.react(message.id, "👍")}
      >
        <SmilePlus />
      </button>
      {assistant && <PlayAloudAction />}
      {assistant && (
        <ActionBarPrimitive.Reload className="message-action" title="Regenerate response">
          <RefreshCw />
        </ActionBarPrimitive.Reload>
      )}
      <button type="button" className="message-action" title="More actions" onClick={onMore}>
        <Ellipsis />
      </button>
    </ActionBarPrimitive.Root>
  );
}

function MessageFrame({ assistant }: { assistant: boolean }) {
  const message = useMessageMetadata();
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = message.custom;
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".message-context-menu, .message-actions")) return;
      setMenuOpen(false);
    };
    const close = () => setMenuOpen(false);
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("blur", close);
    };
  }, [menuOpen]);
  const initials = meta?.authorName.slice(0, 2).toUpperCase() ?? "?";
  return (
    <MessagePrimitive.Root
      className={`message-row ${assistant ? "assistant-message" : "user-message"}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div className="message-avatar" aria-hidden="true">
        {meta?.avatarURL ? <img src={meta.avatarURL} alt="" /> : initials}
      </div>
      <div className="message-column">
        <header className="message-header">
          <strong>{meta?.authorName}</strong>
          {assistant && <span className="bot-badge">BOT</span>}
          <span className="message-handle">{meta?.handle}</span>
          <time>
            {message.createdAt?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </time>
          {meta?.edited && <span>edited</span>}
          {meta?.pinned && <Pin className="pinned-icon" />}
        </header>
        <div className={assistant && meta?.activity ? "assistant-card" : "message-body"}>
          {assistant && meta?.activity && <Activity block={meta.activity} />}
          <div className={assistant && meta?.activity ? "assistant-answer" : undefined}>
            <MessageParts />
          </div>
        </div>
        {Object.keys(meta?.reactions ?? {}).length > 0 && (
          <div className="reaction-row">
            {Object.entries(meta?.reactions ?? {}).map(([emoji, count]) => (
              <button key={emoji} type="button" onClick={() => store.react(message.id, emoji)}>
                {emoji} <span>{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={`message-action-slot ${menuOpen ? "is-menu-open" : ""}`}>
        <MessageActions assistant={assistant} onMore={() => setMenuOpen(true)} />
        <MessageMenu open={menuOpen} close={() => setMenuOpen(false)} />
      </div>
    </MessagePrimitive.Root>
  );
}

function UserMessage() {
  return <MessageFrame assistant={false} />;
}

function AssistantMessage() {
  return <MessageFrame assistant />;
}

function IslandStatus() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <div className="island-status" role="status">
      <span className={snapshot.isRunning ? "status-dot running" : "status-dot"} />
      {snapshot.notice}
    </div>
  );
}

function AssistantIsland() {
  const [bubbles, setBubbles] = useState(false);
  return (
    <PrototypeRuntimeProvider>
      <section className={`assistant-island ${bubbles ? "layout-bubbles" : "layout-inline"}`}>
        <header className="channel-header">
          <div>
            <strong># friends-podcast</strong>
            <span>4 members · OpenClaw connected</span>
          </div>
          <div className="header-actions">
            <IslandStatus />
            <button
              type="button"
              className="bubble-toggle"
              aria-pressed={bubbles}
              onClick={() => setBubbles((enabled) => !enabled)}
            >
              <MessageSquare /> Bubbles {bubbles ? "on" : "off"}
            </button>
            <button type="button" onClick={() => void store.regenerate()}>
              <RefreshCw /> Run live turn
            </button>
          </div>
        </header>
        <ThreadPrimitive.Root className="thread-root">
          <ThreadPrimitive.Viewport className="thread-viewport">
            <ThreadPrimitive.Messages>
              {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
            </ThreadPrimitive.Messages>
            <ThreadPrimitive.ScrollToBottom className="scroll-bottom" aria-label="Scroll to bottom">
              ↓
            </ThreadPrimitive.ScrollToBottom>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </section>
    </PrototypeRuntimeProvider>
  );
}

export function mountAssistantUIIsland(element: HTMLElement) {
  const root = createRoot(element);
  root.render(
    <StrictMode>
      <AssistantIsland />
    </StrictMode>,
  );
  return () => root.unmount();
}

const target = document.querySelector<HTMLElement>("#assistant-ui-island");
if (!target) throw new Error("assistant-ui prototype mount is missing");
mountAssistantUIIsland(target);
