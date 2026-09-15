export type SectionState = {
  channels: boolean;
  directMessages: boolean;
  archived: boolean;
  personas: Record<string, boolean>;
};

export function defaultSections(): SectionState {
  return { channels: true, directMessages: true, archived: true, personas: {} };
}

/**
 * A collapsed channel section keeps only channels that need attention: the
 * selected channel, unread channels, and channels with an agent working. Put
 * that short list before the persona shelf so active work is the first thing a
 * person sees. An empty collapsed section does not displace the personas.
 */
export function collapsedAttentionLeadsPersonas(
  expanded: boolean,
  attentionChannelCount: number,
): boolean {
  return !expanded && attentionChannelCount > 0;
}

export function sectionStorageKey(workspaceID: string): string {
  return `clickclack:sidebar-sections:v1:${workspaceID}`;
}

export function sidebarScrollStorageKey(workspaceID: string): string {
  return `clickclack:sidebar-scroll:v1:${workspaceID}`;
}

/** Refuse malformed or absurd persisted offsets before assigning scrollTop. */
export function parseSidebarScrollTop(raw: string | null): number {
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) return 0;
  return Math.floor(value);
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
      personas:
        personas && typeof personas === "object" && !Array.isArray(personas)
          ? Object.fromEntries(
              Object.entries(personas).filter(([, value]) => typeof value === "boolean"),
            )
          : {},
    };
  } catch {
    return defaultSections();
  }
}
