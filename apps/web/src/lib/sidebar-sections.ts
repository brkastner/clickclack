export type SectionState = {
  channels: boolean;
  directMessages: boolean;
  archived: boolean;
  personas: Record<string, boolean>;
};

export function defaultSections(): SectionState {
  return { channels: true, directMessages: true, archived: true, personas: {} };
}

export function sectionStorageKey(workspaceID: string): string {
  return `clickclack:sidebar-sections:v1:${workspaceID}`;
}

export function parseSectionState(raw: string | null): SectionState {
  if (!raw) return defaultSections();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaultSections();
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.channels !== "boolean" || typeof candidate.directMessages !== "boolean") {
      return defaultSections();
    }
    const personas = candidate.personas;
    return {
      channels: candidate.channels,
      directMessages: candidate.directMessages,
      archived: typeof candidate.archived === "boolean" ? candidate.archived : true,
      personas: personas && typeof personas === "object" && !Array.isArray(personas)
        ? Object.fromEntries(Object.entries(personas).filter(([, value]) => typeof value === "boolean"))
        : {},
    };
  } catch {
    return defaultSections();
  }
}
