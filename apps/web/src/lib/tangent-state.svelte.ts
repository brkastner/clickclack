// Ephemeral tangents are scoped to their source conversation and bot. Navigation
// hides the previous slot; replies keep updating that slot, never the new chat.
import { APIError, api, apiURL } from "./api";
import { tangentContextKey, tangentSourceKey } from "./tangent-context";
import {
  applyTangentMessage,
  parseTangentEndReason,
  type Tangent,
  type TangentEndReason,
  type TangentMessage,
  type TangentSource,
} from "./tangent";
import type { RealtimeEvent, User } from "./types";

type PendingStart = { source: TangentSource; bot: User };
function emptyChat() {
  return {
    tangent: null as Tangent | null,
    bot: null as User | null,
    source: null as TangentSource | null,
    messages: [] as TangentMessage[],
    visible: false,
    working: false,
    ended: null as TangentEndReason | null,
    opening: false,
    error: "",
    draft: "",
    pendingStart: null as PendingStart | null,
    focusRequest: 0,
    startSerial: 0,
  };
}
function reactiveChat() {
  const chat = $state(emptyChat());
  return chat;
}
type TangentChat = ReturnType<typeof emptyChat>;
export const tangentStore = $state({ current: emptyChat() });
const chats = new Map<string, TangentChat>();
const selectedBots = new Map<string, string>();
let activeSourceKey = "";
let ownerID = "";
let unloadHooked = false;
let clientSerial = 0;

/** Select only state belonging to the conversation currently on screen. */
export function selectTangentContext(source: TangentSource | null, userID: string) {
  // During a ChatApp remount /api/me is still loading. An unknown owner
  // must not discard slots belonging to the same signed-in user.
  if (userID && ownerID !== userID) {
    for (const chat of chats.values()) closeChat(chat);
    chats.clear();
    selectedBots.clear();
    activeSourceKey = "";
    tangentStore.current = emptyChat();
    ownerID = userID;
  }
  const nextKey = tangentSourceKey(source);
  if (nextKey === activeSourceKey) return;
  hideTangent();
  activeSourceKey = nextKey;
  const selected = selectedBots.get(nextKey);
  tangentStore.current = (selected && chats.get(selected)) || emptyChat();
  // Returning to a source doesn't pop its panel open until explicitly asked.
  hideTangent();
}

function hookUnload() {
  if (unloadHooked || typeof window === "undefined") return;
  unloadHooked = true;
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    for (const chat of chats.values()) {
      chat.startSerial += 1;
      const id = chat.tangent?.id;
      if (!id || chat.ended) continue;
      try {
        void fetch(apiURL(`/api/tangents/${encodeURIComponent(id)}`), {
          method: "DELETE",
          credentials: "include",
          keepalive: true,
          headers: { "X-ClickClack-CSRF": "1" },
        }).catch(() => {});
      } catch {
        /* The server's idle timeout cleans up if unload delivery fails. */
      }
    }
  });
}

export function hasLiveTangent(): boolean {
  const chat = tangentStore.current;
  return chat.tangent !== null && chat.ended === null;
}
export function showTangent() {
  if (!activeSourceKey) return;
  tangentStore.current.visible = true;
  tangentStore.current.focusRequest += 1;
}
export function hideTangent() {
  tangentStore.current.visible = false;
  tangentStore.current.pendingStart = null;
}

export async function requestTangent(
  source: TangentSource,
  bot: User,
  force = false,
): Promise<void> {
  // A stale palette callback must not select a conversation we already left.
  if (tangentSourceKey(source) !== activeSourceKey) return;
  const key = tangentContextKey(source, bot.id);
  let chat = chats.get(key);
  if (!chat) {
    // Match the server's four-tangent cap and bound local transcript retention.
    if (chats.size >= 4) {
      const oldestKey = chats.keys().next().value!;
      closeChat(chats.get(oldestKey)!);
      chats.delete(oldestKey);
      for (const [sourceKey, selected] of selectedBots) {
        if (selected === oldestKey) selectedBots.delete(sourceKey);
      }
    }
    chat = reactiveChat();
    chats.set(key, chat);
  }
  hideTangent();
  selectedBots.set(activeSourceKey, key);
  tangentStore.current = chat;
  chat.visible = true;
  if (!force && chat.tangent && !chat.ended) {
    chat.pendingStart = { source, bot };
    return;
  }
  await startTangent(chat, source, bot);
}

async function startTangent(chat: TangentChat, source: TangentSource, bot: User): Promise<void> {
  if (chat.opening) return;
  hookUnload();
  closeChat(chat);
  const serial = chat.startSerial;
  Object.assign(chat, emptyChat(), {
    startSerial: serial,
    source,
    bot,
    visible: true,
    opening: true,
  });
  try {
    const data = await api<{ tangent: Tangent }>("/api/tangents", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: source.workspaceID,
        ...(source.directID
          ? { direct_conversation_id: source.directID }
          : { channel_id: source.channelID }),
        bot_user_id: bot.id,
      }),
    });
    if (serial !== chat.startSerial) {
      void closeOnServer(data.tangent.id);
      return;
    }
    chat.tangent = data.tangent;
    chat.focusRequest += 1;
  } catch (error) {
    if (serial === chat.startSerial) chat.error = errorText(error, "couldn't start the tangent.");
  } finally {
    if (serial === chat.startSerial) chat.opening = false;
  }
}
async function closeOnServer(id: string) {
  try {
    await api(`/api/tangents/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* Already gone is fine. */
  }
}
function closeChat(chat: TangentChat) {
  chat.startSerial += 1;
  if (chat.tangent && !chat.ended) void closeOnServer(chat.tangent.id);
  chat.tangent = null;
  chat.opening = false;
  chat.visible = false;
}
export function discardTangent() {
  const chat = tangentStore.current;
  closeChat(chat);
  Object.assign(chat, emptyChat(), { startSerial: chat.startSerial });
}

export async function sendTangentMessage(body: string, retryOf?: TangentMessage): Promise<void> {
  // Capture the owning slot before awaiting. Navigation cannot redirect it.
  const chat = tangentStore.current;
  const tangent = chat.tangent;
  const text = body.trim();
  if (!tangent || chat.ended || !text) return;
  const clientID = retryOf?.client_id ?? `tc_${Date.now().toString(36)}_${(clientSerial += 1)}`;
  const optimistic: TangentMessage = {
    id: `local:${clientID}`,
    tangent_id: tangent.id,
    author_id: tangent.owner_user_id,
    body: text,
    client_id: clientID,
    created_at: new Date().toISOString(),
    pending: true,
  };
  chat.messages = retryOf
    ? chat.messages.map((message) => (message.client_id === clientID ? optimistic : message))
    : [...chat.messages, optimistic];
  chat.working = true;
  chat.error = "";
  try {
    const data = await api<{ message: TangentMessage }>(
      `/api/tangents/${encodeURIComponent(tangent.id)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ body: text, client_id: clientID }),
      },
    );
    if (chat.tangent?.id !== tangent.id) return;
    chat.messages = applyTangentMessage(chat.messages, data.message);
  } catch (error) {
    if (chat.tangent?.id !== tangent.id) return;
    chat.working = false;
    chat.messages = chat.messages.map((message) =>
      message.client_id === clientID ? { ...message, pending: false, failed: true } : message,
    );
    if (error instanceof APIError && error.status === 404) chat.ended = "expired";
    else chat.error = errorText(error, "couldn't send. try again.");
  }
}

export function handleTangentEvent(event: RealtimeEvent): boolean {
  if (!event.type.startsWith("tangent.")) return false;
  const payload = event.payload as Record<string, unknown>;
  const chat = [...chats.values()].find((slot) => slot.tangent?.id === payload.tangent_id);
  const current = chat?.tangent;
  if (!chat || !current) return true;
  switch (event.type) {
    case "tangent.message": {
      const message = payload.message as TangentMessage | undefined;
      if (!message || typeof message.id !== "string") return true;
      chat.messages = applyTangentMessage(chat.messages, message);
      if (message.author_id === current.bot_user_id) chat.working = false;
      break;
    }
    case "tangent.activity":
      chat.working = payload.state === "working";
      break;
    case "tangent.closed":
      chat.ended = parseTangentEndReason(payload.reason);
      chat.working = false;
      break;
  }
  return true;
}
function errorText(error: unknown, fallback: string): string {
  if (error instanceof APIError) {
    try {
      const body = JSON.parse(error.message) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return body.error.trim();
    } catch {
      /* Fall through to the fallback. */
    }
  }
  return fallback;
}
