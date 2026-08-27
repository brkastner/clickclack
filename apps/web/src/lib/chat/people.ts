import type { Channel, DirectConversation, Message, User } from "../types";

export type ChannelProfileShortcut = {
  id: string;
  channel_id: string;
  channel_name: string;
  bot_user_id: string;
  display_name: string;
  avatar_url: string;
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

export function userDisplayLabel(user?: User | null, fallback = "Local User"): string {
  const name = user?.display_name || fallback;
  return isDeletedBot(user) ? `${name} (deleted bot)` : name;
}

export function presentChannelUser(user: User | undefined, channel?: Channel): User | undefined {
  if (!user || user.kind !== "bot" || user.deleted_at) return user;
  const presentation = channel?.bot_presentations?.find(
    (candidate) => candidate.bot_user_id === user.id,
  );
  if (!presentation) return user;
  return {
    ...user,
    display_name: presentation.display_name,
    avatar_url: presentation.avatar_url || user.avatar_url,
  };
}

export function presentChannelMessage(message: Message, channel?: Channel): Message {
  if (!channel || message.channel_id !== channel.id) return message;
  const author = presentChannelUser(message.author, channel);
  const quotedAuthor = presentChannelUser(message.quoted_author, channel);
  if (author === message.author && quotedAuthor === message.quoted_author) return message;
  return { ...message, author, quoted_author: quotedAuthor };
}

export function presentChannelMessages(messages: Message[], channel?: Channel): Message[] {
  return messages.map((message) => presentChannelMessage(message, channel));
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
      if (member.id && member.id !== currentUserID && !member.deleted_at) {
        people.set(member.id, member);
      }
    }
  }
  for (const message of [...messageList].reverse()) {
    const author = message.author;
    if (author?.id && author.id !== currentUserID && !author.deleted_at) {
      people.set(author.id, author);
    }
  }
  return [...people.values()].slice(0, 12);
}

export function collectChannelProfileShortcuts(
  channels: Channel[],
  people: User[],
): ChannelProfileShortcut[] {
  const peopleByID = new Map(people.map((person) => [person.id, person]));
  return channels.flatMap((channel) => {
    const profileSource = channel.sidebar_section?.startsWith("profile:")
      ? channel.sidebar_section.slice("profile:".length)
      : "";
    // A copied presentation belongs to an assigned channel, not the profile
    // catalog. Only self-referential profile sections define draggable profiles.
    if (profileSource && profileSource !== channel.id) return [];
    return (channel.bot_presentations || []).flatMap((presentation) => {
      const bot = peopleByID.get(presentation.bot_user_id);
      if (!bot || bot.deleted_at) return [];
      const handle = userHandle(bot);
      if (!handle) return [];
      return [
        {
          id: `${channel.id}:${presentation.bot_user_id}`,
          channel_id: channel.id,
          channel_name: channel.name,
          bot_user_id: presentation.bot_user_id,
          display_name: presentation.display_name,
          avatar_url: presentation.avatar_url || bot.avatar_url,
          handle,
          unread_count: channel.unread_count || 0,
        },
      ];
    });
  });
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
