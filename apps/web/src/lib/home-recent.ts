import type { Channel, DirectConversation, Message, User } from "./types";

export type HomeRecentSource = {
  id: string;
  routeID: string;
  kind: "channel" | "direct";
  title: string;
  unreadCount: number;
  messages: Message[];
  assignedBotIDs?: string[];
  members?: User[];
};

export type HomeRecentItem = HomeRecentSource & {
  message: Message;
  persona?: User;
  preview: string;
};

export type HomePersonaGroup = {
  id: string;
  persona?: User;
  items: HomeRecentItem[];
  latestAt: string;
  unreadCount: number;
  working: boolean;
};

export function latestUsefulMessage(messages: Message[]): Message | undefined {
  return [...messages]
    .reverse()
    .find((message) => !message.deleted_at && (message.body.trim() || message.attachments?.length));
}

export function messagePreview(message: Message, maxLength = 180): string {
  const body = message.body
    .replace(/```[^\n]*\n?/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[`*_>#~]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const text = body || (message.attachments?.length ? "Shared an attachment" : "Message");
  return Array.from(text).length > maxLength
    ? `${Array.from(text)
        .slice(0, maxLength - 1)
        .join("")}…`
    : text;
}

export function resolveHomePersona(
  source: Pick<HomeRecentSource, "assignedBotIDs" | "members">,
  message: Message,
  usersByID: ReadonlyMap<string, User>,
): User | undefined {
  if (message.author?.kind === "bot") return message.author;
  const author = usersByID.get(message.author_id);
  if (author?.kind === "bot") return author;

  const candidateIDs = [
    ...(source.assignedBotIDs ?? []),
    ...(source.members ?? []).filter((member) => member.kind === "bot").map((member) => member.id),
  ];
  const uniqueIDs = [...new Set(candidateIDs)].sort();
  return uniqueIDs.map((id) => usersByID.get(id)).find(Boolean);
}

export function buildHomeRecentItems(
  sources: HomeRecentSource[],
  users: User[],
  limit = 30,
): HomeRecentItem[] {
  const usersByID = new Map(users.map((user) => [user.id, user]));
  return sources
    .flatMap((source) => {
      const message = latestUsefulMessage(source.messages);
      return message
        ? [
            {
              ...source,
              message,
              persona: resolveHomePersona(source, message, usersByID),
              preview: messagePreview(message),
            },
          ]
        : [];
    })
    .sort((a, b) => {
      const time = Date.parse(b.message.created_at) - Date.parse(a.message.created_at);
      return time || a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}

export function buildHomePersonaGroups(
  items: HomeRecentItem[],
  workingConversationIDs: ReadonlySet<string> = new Set(),
  limit = 12,
): HomePersonaGroup[] {
  const groups = new Map<string, HomePersonaGroup>();

  for (const item of items) {
    const id = item.persona?.id || `unassigned:${item.message.author_id || item.id}`;
    const existing = groups.get(id);
    if (existing) {
      existing.items.push(item);
      existing.unreadCount += item.unreadCount;
      existing.working ||= workingConversationIDs.has(item.id);
      continue;
    }
    groups.set(id, {
      id,
      persona: item.persona,
      items: [item],
      latestAt: item.message.created_at,
      unreadCount: item.unreadCount,
      working: workingConversationIDs.has(item.id),
    });
  }

  return [...groups.values()]
    .sort((a, b) => {
      const time = Date.parse(b.latestAt) - Date.parse(a.latestAt);
      return time || a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}

export function channelHomeSource(
  channel: Channel,
  messages: Message[],
  title: string,
): HomeRecentSource {
  return {
    id: channel.id,
    routeID: channel.route_id || channel.id,
    kind: "channel",
    title,
    unreadCount: channel.unread_count ?? 0,
    messages,
    assignedBotIDs: channel.bot_assignments?.map((assignment) => assignment.bot_user_id),
  };
}

export function directHomeSource(
  conversation: DirectConversation,
  messages: Message[],
  title: string,
): HomeRecentSource {
  return {
    id: conversation.id,
    routeID: conversation.route_id || conversation.id,
    kind: "direct",
    title,
    unreadCount: conversation.unread_count ?? 0,
    messages,
    members: conversation.members,
  };
}
