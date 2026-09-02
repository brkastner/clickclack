import type { Channel, DirectConversation, Message, User } from "../types";

export type ChannelProfileShortcut = {
  id: string;
  bot_user_id: string;
  display_name: string;
  avatar_url: string;
  avatar_url_light?: string;
  handle: string;
  unread_count: number;
};

export function workspaceInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

export function avatarInitial(name?: string | null): string {
  if (!name) return "?";
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toUpperCase() : "?";
}

export function handleLabel(value?: string | null): string {
  return value ? `@${value}` : "";
}

export function userHandle(user?: User | null): string {
  return user?.handle || user?.former_handle || "";
}

export function isDeletedBot(user?: User | null): boolean {
  return user?.kind === "bot" && !!user.deleted_at;
}

export function replaceCachedUser(candidate: User, updated: User): User {
  return candidate.id === updated.id ? updated : candidate;
}

export function replaceMessageUsers(message: Message, updated: User): Message {
  const author = message.author ? replaceCachedUser(message.author, updated) : undefined;
  const quotedAuthor = message.quoted_author
    ? replaceCachedUser(message.quoted_author, updated)
    : undefined;
  if (author === message.author && quotedAuthor === message.quoted_author) return message;
  return { ...message, author, quoted_author: quotedAuthor };
}

export function replaceConversationUsers(
  conversation: DirectConversation,
  updated: User,
): DirectConversation {
  const members = conversation.members.map((member) => replaceCachedUser(member, updated));
  return members.every((member, index) => member === conversation.members[index])
    ? conversation
    : { ...conversation, members };
}

export function userDisplayLabel(user?: User | null, fallback = "Local User"): string {
  const name = user?.display_name || fallback;
  return isDeletedBot(user) ? `${name} (deleted bot)` : name;
}

export function avatarHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function dmAvatarUser(conversation: DirectConversation, currentUserID?: string): User {
  return (
    conversation.members.find((member) => member.id !== currentUserID) || conversation.members[0]
  );
}

export function dmTitle(conversation: DirectConversation, currentUserID?: string): string {
  const others = conversation.members.filter((member) => member.id !== currentUserID);
  const list = others.length > 0 ? others : conversation.members;
  return list.map((member) => userDisplayLabel(member)).join(", ");
}

export function collectRecentPeople(
  messageList: Message[],
  conversations: DirectConversation[],
  currentUserID: string,
): User[] {
  const people = new Map<string, User>();
  for (const conversation of conversations) {
    for (const member of conversation.members) {
      if (member.id && member.id !== currentUserID && !member.deleted_at)
        people.set(member.id, member);
    }
  }
  for (const message of [...messageList].reverse()) {
    const author = message.author;
    if (author?.id && author.id !== currentUserID && !author.deleted_at)
      people.set(author.id, author);
  }
  return [...people.values()].slice(0, 12);
}

export function collectChannelProfileShortcuts(
  _channels: Channel[],
  people: User[],
): ChannelProfileShortcut[] {
  return people
    .filter((person) => person.kind === "bot" && !person.deleted_at && userHandle(person))
    .map((bot) => ({
      id: bot.id,
      bot_user_id: bot.id,
      display_name: bot.display_name,
      avatar_url: bot.avatar_url,
      ...(bot.avatar_url_light ? { avatar_url_light: bot.avatar_url_light } : {}),
      handle: userHandle(bot),
      unread_count: 0,
    }));
}

export function moveChannelInOrder(
  order: string[],
  movingID: string,
  targetID: string,
  before: boolean,
): string[] {
  if (!movingID || !targetID || movingID === targetID) return order;
  const next = [...order];
  const from = next.indexOf(movingID);
  if (from < 0) return order;
  next.splice(from, 1);
  const target = next.indexOf(targetID);
  if (target < 0) return order;
  next.splice(target + (before ? 0 : 1), 0, movingID);
  return next;
}

export function collectMentionPeople(
  currentUser: User | null,
  recent: User[],
  workspaceMembers: User[],
  direct: DirectConversation | undefined,
): User[] {
  const people = new Map<string, User>();
  for (const person of workspaceMembers) {
    if (person.id && !person.deleted_at) people.set(person.id, person);
  }
  for (const person of direct?.members || []) {
    if (person.id && !person.deleted_at) people.set(person.id, person);
  }
  for (const person of recent) {
    if (person.id && !person.deleted_at) people.set(person.id, person);
  }
  if (currentUser?.id) people.set(currentUser.id, currentUser);
  return [...people.values()];
}

export function directConversationForUser(
  conversations: DirectConversation[],
  memberID: string,
): DirectConversation | undefined {
  return conversations.find((conversation) =>
    conversation.members.some((member) => member.id === memberID),
  );
}
