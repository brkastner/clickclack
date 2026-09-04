type UnreadItem = {
  id: string;
  unread_count?: number;
};

export type PersonaUnreadSummary = {
  direct: number;
  channels: number;
  total: number;
};

function unreadCount(item: UnreadItem | undefined, selectedID: string): number {
  if (!item || item.id === selectedID) return 0;
  const count = item.unread_count ?? 0;
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

export function personaUnreadSummary(
  direct: UnreadItem | undefined,
  channels: readonly UnreadItem[],
  selectedDirectID = "",
  selectedChannelID = "",
): PersonaUnreadSummary {
  const directUnread = unreadCount(direct, selectedDirectID);
  const channelUnread = channels.reduce(
    (total, channel) => total + unreadCount(channel, selectedChannelID),
    0,
  );
  return {
    direct: directUnread,
    channels: channelUnread,
    total: directUnread + channelUnread,
  };
}
