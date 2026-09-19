import type { Message, MessagePage } from "./types";

export type ConversationPeekTarget = {
  id: string;
  routeID: string;
  kind: "channel" | "direct";
  title: string;
};

/** Base REST path for a conversation's message collection. */
export function conversationMessagesPath(kind: "channel" | "direct", id: string): string {
  const segment = kind === "direct" ? "dms" : "channels";
  return `/api/${segment}/${encodeURIComponent(id)}/messages`;
}

/** Full message query path for one peek page. */
export function conversationPeekPath(
  kind: "channel" | "direct",
  id: string,
  query: string,
): string {
  const base = conversationMessagesPath(kind, id);
  return query ? `${base}?${query}` : base;
}

/** Read path for marking a conversation read through a sequence. */
export function conversationReadPath(kind: "channel" | "direct", id: string): string {
  const segment = kind === "direct" ? "dms" : "channels";
  return `/api/${segment}/${encodeURIComponent(id)}/read`;
}

function messageSeq(message: Message): number {
  return message.channel_seq ?? 0;
}

function sortKey(message: Message): [number, number, string] {
  return [messageSeq(message), Date.parse(message.created_at) || 0, message.id];
}

/** Merge message lists by id, newest last, keeping the later copy of a duplicate. */
export function mergePeekMessages(...lists: Message[][]): Message[] {
  const byID = new Map<string, Message>();
  for (const list of lists) {
    for (const message of list) byID.set(message.id, message);
  }
  return [...byID.values()].sort((a, b) => {
    const left = sortKey(a);
    const right = sortKey(b);
    return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]);
  });
}

/**
 * Fold a newly fetched page into the peek window.
 *
 * `older` pages extend the window backwards and keep the existing newest edge;
 * every other page owns the newest edge it reports.
 */
export function foldPeekPage(
  current: MessagePage | undefined,
  incoming: MessagePage,
  direction: "replace" | "older" | "newer",
): MessagePage {
  if (!current || direction === "replace") return incoming;
  const messages = mergePeekMessages(current.messages, incoming.messages);
  if (direction === "older") {
    return {
      messages,
      oldest_seq: incoming.oldest_seq || current.oldest_seq,
      newest_seq: current.newest_seq || incoming.newest_seq,
      has_older: incoming.has_older,
      has_newer: current.has_newer,
    };
  }
  return {
    messages,
    oldest_seq: current.oldest_seq || incoming.oldest_seq,
    newest_seq: Math.max(current.newest_seq, incoming.newest_seq),
    has_older: current.has_older,
    has_newer: incoming.has_newer,
  };
}

/** Insert or replace one locally known message in the peek window. */
export function applyPeekMessage(page: MessagePage, message: Message): MessagePage {
  const messages = mergePeekMessages(page.messages, [message]);
  const seq = messageSeq(message);
  return {
    ...page,
    messages,
    newest_seq: Math.max(page.newest_seq, seq),
    oldest_seq: page.oldest_seq || seq,
  };
}

/** Highest sequence present in the peek window. */
export function peekReadThroughSeq(page: MessagePage | undefined): number {
  if (!page) return 0;
  return page.messages.reduce(
    (highest, message) => Math.max(highest, messageSeq(message)),
    page.newest_seq || 0,
  );
}
