// Live tangent state. There is at most one tangent at a time, held in module
// memory: hiding the panel or leaving chat for settings keeps it, a full
// reload drops it (and asks the server to close it on the way out), and
// starting a new one replaces it.

import { APIError, api, apiURL } from "./api";
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

export const tangentChat = $state({
  tangent: null as Tangent | null,
  bot: null as User | null,
  source: null as TangentSource | null,
  messages: [] as TangentMessage[],
  // Whether the panel is showing. The tangent survives while hidden.
  visible: false,
  // The bot said it's working, or the owner's last message hasn't been
  // answered yet.
  working: false,
  ended: null as TangentEndReason | null,
  opening: false,
  error: "",
  draft: "",
  // Set when someone asks for a new tangent while one exists, so the panel
  // can ask whether to open the existing one or replace it.
  pendingStart: null as PendingStart | null,
  // Bumped when the composer should take focus.
  focusRequest: 0,
});

let unloadHooked = false;

function hookUnload() {
  if (unloadHooked || typeof window === "undefined") return;
  unloadHooked = true;
  // A reload discards the tangent. Tell the server so the agent side stops
  // hearing about it; keepalive lets the request outlive the page.
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    const id = tangentChat.tangent?.id;
    if (!id || tangentChat.ended) return;
    try {
      void fetch(apiURL(`/api/tangents/${encodeURIComponent(id)}`), {
        method: "DELETE",
        credentials: "include",
        keepalive: true,
        headers: { "X-ClickClack-CSRF": "1" },
      }).catch(() => {});
    } catch {
      // Best effort: the server's idle timeout and per-owner cap clean up too.
    }
  });
}

function reset() {
  tangentChat.tangent = null;
  tangentChat.bot = null;
  tangentChat.source = null;
  tangentChat.messages = [];
  tangentChat.working = false;
  tangentChat.ended = null;
  tangentChat.error = "";
  tangentChat.draft = "";
  tangentChat.pendingStart = null;
}

export function hasLiveTangent(): boolean {
  return tangentChat.tangent !== null && tangentChat.ended === null;
}

export function showTangent() {
  tangentChat.visible = true;
  tangentChat.focusRequest += 1;
}

export function hideTangent() {
  tangentChat.visible = false;
  tangentChat.pendingStart = null;
}

/**
 * Ask for a tangent with bot from source. When a live tangent already exists
 * the panel asks first, unless force is set by that very prompt.
 */
export async function requestTangent(
  source: TangentSource,
  bot: User,
  force = false,
): Promise<void> {
  if (!force && hasLiveTangent()) {
    tangentChat.pendingStart = { source, bot };
    tangentChat.visible = true;
    return;
  }
  await startTangent(source, bot);
}

let startSerial = 0;

async function startTangent(source: TangentSource, bot: User): Promise<void> {
  if (tangentChat.opening) return;
  hookUnload();
  const serial = (startSerial += 1);
  const previous = tangentChat.tangent;
  const previousEnded = tangentChat.ended;
  reset();
  tangentChat.source = source;
  tangentChat.bot = bot;
  tangentChat.visible = true;
  tangentChat.opening = true;
  if (previous && !previousEnded) void closeOnServer(previous.id);
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
    // Discarded or replaced while this request was in flight.
    if (serial !== startSerial) {
      void closeOnServer(data.tangent.id);
      return;
    }
    tangentChat.tangent = data.tangent;
    tangentChat.focusRequest += 1;
  } catch (error) {
    if (serial === startSerial) tangentChat.error = errorText(error, "Couldn't start the tangent.");
  } finally {
    if (serial === startSerial) tangentChat.opening = false;
  }
}

async function closeOnServer(id: string) {
  try {
    await api(`/api/tangents/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    // Already gone is fine.
  }
}

/** Throw the tangent away and hide the panel. */
export function discardTangent() {
  const current = tangentChat.tangent;
  const ended = tangentChat.ended;
  startSerial += 1;
  tangentChat.opening = false;
  reset();
  tangentChat.visible = false;
  if (current && !ended) void closeOnServer(current.id);
}

let clientSerial = 0;

export async function sendTangentMessage(body: string, retryOf?: TangentMessage): Promise<void> {
  const tangent = tangentChat.tangent;
  const text = body.trim();
  if (!tangent || tangentChat.ended || !text) return;
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
  tangentChat.messages = retryOf
    ? tangentChat.messages.map((message) => (message.client_id === clientID ? optimistic : message))
    : [...tangentChat.messages, optimistic];
  tangentChat.working = true;
  tangentChat.error = "";
  try {
    const data = await api<{ message: TangentMessage }>(
      `/api/tangents/${encodeURIComponent(tangent.id)}/messages`,
      { method: "POST", body: JSON.stringify({ body: text, client_id: clientID }) },
    );
    if (tangentChat.tangent?.id !== tangent.id) return;
    tangentChat.messages = applyTangentMessage(tangentChat.messages, data.message);
  } catch (error) {
    if (tangentChat.tangent?.id !== tangent.id) return;
    tangentChat.working = false;
    if (error instanceof APIError && error.status === 404) {
      tangentChat.ended = "expired";
      tangentChat.messages = tangentChat.messages.map((message) =>
        message.client_id === clientID ? { ...message, pending: false, failed: true } : message,
      );
      return;
    }
    tangentChat.messages = tangentChat.messages.map((message) =>
      message.client_id === clientID ? { ...message, pending: false, failed: true } : message,
    );
    tangentChat.error = errorText(error, "Couldn't send. Try again.");
  }
}

/**
 * Apply a tangent.* realtime frame. Returns true for every tangent frame so
 * the caller can stop there, even when it belongs to a tangent this tab no
 * longer holds.
 */
export function handleTangentEvent(event: RealtimeEvent): boolean {
  if (!event.type.startsWith("tangent.")) return false;
  const payload = event.payload as Record<string, unknown>;
  const current = tangentChat.tangent;
  if (!current || payload.tangent_id !== current.id) return true;
  switch (event.type) {
    case "tangent.message": {
      const message = payload.message as TangentMessage | undefined;
      if (!message || typeof message.id !== "string") return true;
      tangentChat.messages = applyTangentMessage(tangentChat.messages, message);
      if (message.author_id === current.bot_user_id) tangentChat.working = false;
      return true;
    }
    case "tangent.activity":
      tangentChat.working = payload.state === "working";
      return true;
    case "tangent.closed":
      tangentChat.ended = parseTangentEndReason(payload.reason);
      tangentChat.working = false;
      return true;
    default:
      return true;
  }
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof APIError) {
    try {
      const body = JSON.parse(error.message) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return body.error.trim();
    } catch {
      // Fall through to the fallback.
    }
  }
  return fallback;
}
