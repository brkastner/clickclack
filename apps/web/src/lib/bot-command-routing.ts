import type { WorkspaceBotCommand } from "./types.ts";

function normalizeCommandToken(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

// A plain-message bot command is directed only when exactly one bot owns the
// token. Duplicate declarations remain undirected rather than choosing an
// arbitrary bot.
export function findUniqueBotCommand(
  commands: WorkspaceBotCommand[],
  commandToken: string,
): WorkspaceBotCommand | undefined {
  const matches = commands.filter(
    (command) => normalizeCommandToken(command.command) === commandToken,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
