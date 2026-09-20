import type { Channel } from "./types";

export function channelActivityTime(channel: Channel): number {
  const value = Date.parse(channel.last_message_at || "");
  return Number.isFinite(value) ? value : 0;
}

export function channelsByRecency(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) => channelActivityTime(b) - channelActivityTime(a));
}

export function personaActivityTime(channels: Channel[], personaID: string): number {
  return channels.reduce(
    (latest, channel) =>
      !channel.archived_at && channel.bot_assignments?.some((a) => a.bot_user_id === personaID)
        ? Math.max(latest, channelActivityTime(channel))
        : latest,
    0,
  );
}
