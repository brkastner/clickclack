// The command palette's pure core: what a command is, how a query ranks
// commands, and how recently run commands are remembered. The open/close state
// and the provider registry live in command-palette-state.svelte.ts so this file
// stays importable from plain node tests.

export type PaletteGroup =
  | "recent"
  | "navigation"
  | "actions"
  | "channels"
  | "directs"
  | "settings";

export type PaletteCommand = {
  // Stable across renders and sessions; recents are keyed by it.
  id: string;
  label: string;
  group: Exclude<PaletteGroup, "recent">;
  // Extra words that should match, such as "dm" for a direct message.
  keywords?: string[];
  // Short secondary text shown on the right of the row.
  hint?: string;
  // Glyph drawn before the label: "#" for channels, "@" for direct messages.
  glyph?: string;
  // Inline SVG path data for a 24×24 stroke icon, used when there's no glyph.
  icon?: string[];
  // The conversation or view the person is already on. Shown last and labelled.
  current?: boolean;
  run: () => void | Promise<void>;
};

export type RankedCommand = {
  command: PaletteCommand;
  // Indices into command.label that matched the query, for highlighting.
  matches: number[];
  // Set when the command is shown because it was run recently.
  recent: boolean;
};

export type PaletteSection = {
  group: PaletteGroup;
  label: string;
  items: RankedCommand[];
};

export const PALETTE_GROUP_LABELS: Record<PaletteGroup, string> = {
  recent: "Recent",
  navigation: "Go to",
  actions: "Actions",
  channels: "Channels",
  directs: "Direct messages",
  settings: "Settings",
};

const GROUP_ORDER: PaletteGroup[] = [
  "recent",
  "navigation",
  "actions",
  "channels",
  "directs",
  "settings",
];

export const MAX_RECENT_COMMANDS = 5;
// A blank query would otherwise list every channel and DM in a big workspace.
const MAX_BLANK_GROUP_ITEMS = 6;
export const MAX_QUERY_RESULTS = 50;

type Match = { score: number; indices: number[] };

function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1];
  return (
    previous === " " ||
    previous === "-" ||
    previous === "_" ||
    previous === "/" ||
    previous === "." ||
    previous === "#" ||
    previous === "@"
  );
}

/**
 * Score text against a query as an in-order subsequence, or null when some
 * query character is missing. Contiguous runs and word starts score higher, so
 * "gen" prefers "general" over "agent-engine" and "nc" finds "new channel".
 */
export function fuzzyMatch(query: string, text: string): Match | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return { score: 0, indices: [] };
  const haystack = text.toLowerCase();

  const direct = haystack.indexOf(needle);
  if (direct !== -1) {
    // A plain substring beats any scattered match. Earlier and word-aligned is
    // better, and an exact label is best of all.
    let score = 1000 - direct;
    if (isWordBoundary(haystack, direct)) score += 200;
    if (direct === 0) score += 200;
    if (needle.length === haystack.length) score += 400;
    return {
      score,
      indices: Array.from({ length: needle.length }, (_, offset) => direct + offset),
    };
  }

  const indices: number[] = [];
  let score = 0;
  let cursor = 0;
  for (const char of needle) {
    if (char === " ") continue;
    // Prefer the next word start that has this character, otherwise the next
    // occurrence at all.
    let found = -1;
    for (let index = cursor; index < haystack.length; index += 1) {
      if (haystack[index] === char && isWordBoundary(haystack, index)) {
        found = index;
        break;
      }
    }
    const nearest = haystack.indexOf(char, cursor);
    if (nearest === -1) return null;
    // Only jump ahead to a word start when it isn't continuing a run.
    const previous = indices[indices.length - 1];
    if (found === -1 || (previous !== undefined && nearest === previous + 1)) found = nearest;
    if (previous !== undefined && found === previous + 1) score += 15;
    if (isWordBoundary(haystack, found)) score += 30;
    score -= Math.min(found - cursor, 10);
    indices.push(found);
    cursor = found + 1;
  }
  return { score, indices };
}

function matchCommand(query: string, command: PaletteCommand): Match | null {
  const label = fuzzyMatch(query, command.label);
  let best = label;
  for (const keyword of command.keywords ?? []) {
    const match = fuzzyMatch(query, keyword);
    // Keyword hits rank a little under label hits and highlight nothing.
    if (match && (!best || match.score - 50 > best.score))
      best = { score: match.score - 50, indices: [] };
  }
  return best;
}

/**
 * Drop later duplicates by id. Two providers can offer the same command, such
 * as a settings section registered by both chat and the settings pages.
 */
export function uniqueCommands(commands: PaletteCommand[]): PaletteCommand[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    if (seen.has(command.id)) return false;
    seen.add(command.id);
    return true;
  });
}

/**
 * Arrange commands for display. A blank query lists recents and then a few of
 * each group. A query returns one ranked list, grouped only by relevance.
 */
export function rankCommands(
  query: string,
  commands: PaletteCommand[],
  recentIDs: string[] = [],
): PaletteSection[] {
  const unique = uniqueCommands(commands);
  const byID = new Map(unique.map((command) => [command.id, command]));
  const recentRank = new Map(recentIDs.map((id, index) => [id, index]));

  if (!query.trim()) {
    const recent: RankedCommand[] = recentIDs
      .map((id) => byID.get(id))
      .filter((command): command is PaletteCommand => Boolean(command) && !command?.current)
      .slice(0, MAX_RECENT_COMMANDS)
      .map((command) => ({ command, matches: [], recent: true }));
    const shown = new Set(recent.map((item) => item.command.id));
    const sections: PaletteSection[] = [];
    if (recent.length > 0)
      sections.push({ group: "recent", label: PALETTE_GROUP_LABELS.recent, items: recent });
    for (const group of GROUP_ORDER) {
      if (group === "recent") continue;
      const items = unique
        .filter((command) => command.group === group && !shown.has(command.id))
        .sort((a, b) => Number(Boolean(a.current)) - Number(Boolean(b.current)))
        .slice(0, MAX_BLANK_GROUP_ITEMS)
        .map((command) => ({ command, matches: [], recent: false }));
      if (items.length > 0) sections.push({ group, label: PALETTE_GROUP_LABELS[group], items });
    }
    return sections;
  }

  const ranked = unique
    .map((command, order) => {
      const match = matchCommand(query, command);
      if (!match) return null;
      let score = match.score;
      const recency = recentRank.get(command.id);
      if (recency !== undefined) score += 40 - recency * 5;
      if (command.current) score -= 500;
      return { command, matches: match.indices, score, order };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_QUERY_RESULTS)
    .map(({ command, matches }) => ({ command, matches, recent: recentRank.has(command.id) }));

  return ranked.length > 0 ? [{ group: "navigation", label: "Results", items: ranked }] : [];
}

/** Flatten sections into the order the arrow keys walk. */
export function flattenSections(sections: PaletteSection[]): RankedCommand[] {
  return sections.flatMap((section) => section.items);
}

/** Split a label into plain and highlighted runs for rendering. */
export function highlightRuns(
  label: string,
  matches: number[],
): { text: string; match: boolean }[] {
  if (matches.length === 0) return [{ text: label, match: false }];
  const marked = new Set(matches);
  const runs: { text: string; match: boolean }[] = [];
  for (let index = 0; index < label.length; index += 1) {
    const match = marked.has(index);
    const last = runs[runs.length - 1];
    if (last && last.match === match) last.text += label[index];
    else runs.push({ text: label[index] ?? "", match });
  }
  return runs;
}

// ---------- recents ----------

export const RECENT_COMMANDS_STORAGE_PREFIX = "clickclack:command-palette-recent:v1:";

export function recentCommandsStorageKey(workspaceID: string): string {
  return `${RECENT_COMMANDS_STORAGE_PREFIX}${workspaceID}`;
}

export function parseRecentCommands(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === "string")
      .slice(0, MAX_RECENT_COMMANDS * 2);
  } catch {
    return [];
  }
}

/** Move a command to the front of the recent list. */
export function rememberRecentCommand(recentIDs: string[], id: string): string[] {
  return [id, ...recentIDs.filter((existing) => existing !== id)].slice(0, MAX_RECENT_COMMANDS * 2);
}

// ---------- shortcut ----------

export type ShortcutEvent = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
};

/**
 * Ctrl+K everywhere, and Cmd+K on macOS. Chords with Shift or Alt are left for
 * other shortcuts.
 */
export function isPaletteShortcut(event: ShortcutEvent, mac: boolean): boolean {
  if (event.isComposing || event.altKey || event.shiftKey) return false;
  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!primary) return false;
  return event.key.toLowerCase() === "k" || event.code === "KeyK";
}
