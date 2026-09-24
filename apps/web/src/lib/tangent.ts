// Tangents: private, throwaway side chats with a conversation's agent.
//
// This file is the pure core, importable from plain node tests: the wire
// types, who a tangent can be opened with, the Ctrl+L chord, and how incoming
// messages reconcile with optimistic sends. Live state lives in
// tangent-state.svelte.ts.

import type { ShortcutEvent } from "./command-palette";
import type { Channel, DirectConversation, User } from "./types";

export type Tangent = {
  id: string;
  workspace_id: string;
  channel_id?: string;
  direct_conversation_id?: string;
  owner_user_id: string;
  bot_user_id: string;
  created_at: string;
};

export type TangentMessage = {
  id: string;
  tangent_id: string;
  author_id: string;
  body: string;
  client_id?: string;
  created_at: string;
  // Local-only send states for the owner's optimistic rows.
  pending?: boolean;
  failed?: boolean;
};

// Why a tangent stopped. "closed" is the owner discarding it, "replaced" is
// the server evicting it for a newer one, "access_lost" is either side losing
// the source conversation, and "expired" covers a server restart or idle
// timeout noticed on the next send.
export type TangentEndReason = "closed" | "replaced" | "access_lost" | "expired";

export type TangentSource = {
  workspaceID: string;
  channelID?: string;
  directID?: string;
  // "#general" or a DM title, shown in the panel header.
  label: string;
};

/**
 * The agents a tangent can be opened with from the current conversation: bot
 * members of a DM, or the bots assigned to a channel. Deleted bots never
 * qualify, and the list keeps a stable order so palette rows don't jump.
 */
export function tangentAgentCandidates(params: {
  direct?: DirectConversation;
  channel?: Channel;
  currentUserID: string;
  lookupUser: (userID: string) => User | undefined;
}): User[] {
  const seen = new Set<string>();
  const bots: User[] = [];
  const add = (candidate: User | undefined) => {
    if (!candidate || candidate.kind !== "bot" || candidate.deleted_at) return;
    if (candidate.id === params.currentUserID || seen.has(candidate.id)) return;
    seen.add(candidate.id);
    bots.push(candidate);
  };
  if (params.direct) {
    for (const member of params.direct.members) add(member);
  } else if (params.channel) {
    for (const assignment of params.channel.bot_assignments ?? []) {
      add(params.lookupUser(assignment.bot_user_id));
    }
  }
  return bots;
}

/**
 * Ctrl+L everywhere, and Cmd+L on macOS. Like the palette chord, Shift and Alt
 * variants are left alone.
 */
export function isTangentShortcut(event: ShortcutEvent, mac: boolean): boolean {
  if (event.isComposing || event.altKey || event.shiftKey) return false;
  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!primary) return false;
  return event.key.toLowerCase() === "l" || event.code === "KeyL";
}

/**
 * Fold one message into the list. A message echoing an optimistic send
 * (same client_id) replaces it in place; a message already present by id is
 * ignored, since the HTTP response and the realtime frame both deliver it.
 */
export function applyTangentMessage(
  list: TangentMessage[],
  message: TangentMessage,
): TangentMessage[] {
  if (list.some((existing) => existing.id === message.id)) return list;
  if (message.client_id) {
    const index = list.findIndex((existing) =>
      existing.pending || existing.failed ? existing.client_id === message.client_id : false,
    );
    if (index >= 0) {
      const next = list.slice();
      next[index] = { ...message };
      return next;
    }
  }
  return [...list, { ...message }];
}

export function tangentEndMessage(reason: TangentEndReason): string {
  switch (reason) {
    case "closed":
      return "This tangent was discarded.";
    case "replaced":
      return "A newer tangent replaced this one.";
    case "access_lost":
      return "This tangent ended because its conversation is no longer shared.";
    case "expired":
      return "This tangent ended. The server was restarted or it sat idle too long.";
  }
}

export function parseTangentEndReason(value: unknown): TangentEndReason {
  return value === "closed" || value === "replaced" || value === "access_lost" ? value : "expired";
}
