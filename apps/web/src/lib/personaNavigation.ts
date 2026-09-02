import type { Channel } from "./types";

export type PersonaChannelPins = Record<string, string>;

const MAX_PINNED_PERSONAS = 100;
const MAX_ID_LENGTH = 128;

export function parsePersonaChannelPins(raw: string | null): PersonaChannelPins {
  if (!raw || raw.length > 32_768) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value).filter(
      ([personaID, channelID]) =>
        personaID.length <= MAX_ID_LENGTH &&
        typeof channelID === "string" &&
        channelID.length <= MAX_ID_LENGTH,
    );
    return entries.length <= MAX_PINNED_PERSONAS ? Object.fromEntries(entries) : {};
  } catch {
    return {};
  }
}

export function pinnedPersonaChannel(
  pins: PersonaChannelPins,
  personaID: string,
  channels: Channel[],
): Channel | undefined {
  const channelID = pins[personaID];
  if (!channelID) return undefined;
  return channels.find(
    (channel) =>
      channel.id === channelID &&
      !channel.archived_at &&
      channel.bot_assignments?.some((assignment) => assignment.bot_user_id === personaID),
  );
}
