import type { TangentSource } from "./tangent";

// Labels are presentation, not identity. A DM and a channel never share a slot.
export function tangentSourceKey(source: TangentSource | null): string {
  if (!source) return "";
  return JSON.stringify([
    source.workspaceID,
    source.directID ? "direct" : "channel",
    source.directID || source.channelID,
  ]);
}

export function tangentContextKey(source: TangentSource, botID: string): string {
  return JSON.stringify([tangentSourceKey(source), botID]);
}
