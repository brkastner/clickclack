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

export type SidebarPeopleShelfEntry =
  | { kind: "person"; person: User }
  | { kind: "profile"; profile: ChannelProfileShortcut };

export type SidebarPeopleShelfReplacement = {
  personName: string;
  profileName: string;
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

export function collectSidebarPeopleShelf(
  recentPeople: User[],
  profiles: ChannelProfileShortcut[],
  replacement: SidebarPeopleShelfReplacement,
  limit = 4,
): SidebarPeopleShelfEntry[] {
  const people = recentPeople.slice(1).concat(recentPeople.slice(0, 1)).slice(0, limit);
  const entries: SidebarPeopleShelfEntry[] = people.map((person) => ({
    kind: "person",
    person,
  }));
  const normalizedPersonName = replacement.personName.trim().toLocaleLowerCase();
  const normalizedProfileName = replacement.profileName.trim().toLocaleLowerCase();
  const personIndex = people.findIndex(
    (person) => person.display_name.trim().toLocaleLowerCase() === normalizedPersonName,
  );
  const profile = profiles.find(
    (candidate) => candidate.display_name.trim().toLocaleLowerCase() === normalizedProfileName,
  );
  if (personIndex >= 0 && profile) entries[personIndex] = { kind: "profile", profile };
  return entries;
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

// Sidebar profile groups follow the viewer's channel order, keyed by each
// profile's source channel. Profiles whose source channel is missing keep their
// original relative position at the end.
export function orderProfileShortcuts(
  profiles: ChannelProfileShortcut[],
  channelIDs: string[],
): ChannelProfileShortcut[] {
  const rank = new Map<string, number>();
  channelIDs.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  return profiles
    .map((profile, index) => ({ profile, index }))
    .sort((a, b) => {
      const left = rank.get(a.profile.channel_id) ?? Number.MAX_SAFE_INTEGER;
      const right = rank.get(b.profile.channel_id) ?? Number.MAX_SAFE_INTEGER;
      return left === right ? a.index - b.index : left - right;
    })
    .map((entry) => entry.profile);
}

// One channel-scoped face for a bot, as shown in the profile editor. A lane's
// `is_canonical` marks the profile whose label already matches the bot's own
// display name, so the editor can warn that renaming the bot also renames it.
export type ProfilePersonaLane = {
  channel_id: string;
  channel_name: string;
  display_name: string;
  avatar_url: string;
  is_canonical: boolean;
};

// Collects the persona lanes wrapping one bot, ordered by the viewer's channel
// order so the editor matches the sidebar. Only self-referential profile
// sections are lanes; copied presentations on assigned channels are not.
export function collectBotPersonaLanes(
  profiles: ChannelProfileShortcut[],
  botUserID: string,
  people: User[],
  channelIDs: string[] = [],
): ProfilePersonaLane[] {
  if (!botUserID) return [];
  const owned = profiles.filter((profile) => profile.bot_user_id === botUserID);
  return orderProfileShortcuts(owned, channelIDs).map((profile) => ({
    channel_id: profile.channel_id,
    channel_name: profile.channel_name,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    is_canonical: profileIsCanonicalIdentity(profile, people),
  }));
}

// Moves one channel ID within a viewer order, landing before or after the
// target. Returns the original order when either ID is absent.
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

// A profile is the bot's canonical identity when its label matches the bot's
// own display name. Persona profiles (several labels over one bot) are wrappers
// and keep their own channel; only a canonical profile stands for the bot
// itself and therefore opens that bot's direct conversation.
export function profileIsCanonicalIdentity(
  profile: Pick<ChannelProfileShortcut, "bot_user_id" | "display_name">,
  people: User[],
): boolean {
  const bot = people.find((person) => person.id === profile.bot_user_id);
  if (!bot || bot.deleted_at) return false;
  const label = profile.display_name.trim();
  return label !== "" && label === (bot.display_name || "").trim();
}

// Resolves the conversation a profile header should open. Canonical profiles
// target the bot's DM; personas and any canonical profile without a DM fall
// back to the profile's own source channel.
export function profileHeaderTarget(
  profile: Pick<ChannelProfileShortcut, "bot_user_id" | "display_name" | "channel_id">,
  people: User[],
  conversations: DirectConversation[],
): { kind: "direct"; id: string } | { kind: "channel"; id: string } {
  if (profileIsCanonicalIdentity(profile, people)) {
    const direct = directConversationForUser(conversations, profile.bot_user_id);
    if (direct) return { kind: "direct", id: direct.id };
  }
  return { kind: "channel", id: profile.channel_id };
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
