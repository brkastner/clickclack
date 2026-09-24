import type { BotRuntimeStatus, BotRuntimeStatusTarget, WorkspaceBotCommand } from "./types.ts";

export type PiModel = { label: string; id: string };
export const PI_MODELS_KEY = "clickclack.pi-models.v1";
export const DEFAULT_PI_MODELS: PiModel[] = [
  { label: "opus 5.5", id: "claude-opus-5-5" },
  { label: "gpt 6 astra", id: "openai-codex/gpt-6-astra" },
  { label: "gpt 6 sol", id: "openai-codex/gpt-6-sol" },
  { label: "gpt 6 luna", id: "openai-codex/gpt-6-luna" },
];
export const PI_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

export function validatePiModels(value: unknown): PiModel[] {
  if (!Array.isArray(value) || !value.length || value.length > 30)
    throw new Error("add between 1 and 30 models.");
  const seen = new Set<string>();
  return value.map((model) => {
    if (
      typeof model?.label !== "string" ||
      !model.label.trim() ||
      typeof model?.id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model.id.trim())
    ) {
      throw new Error("each model needs a label and a model id without spaces.");
    }
    const id = model.id.trim();
    if (seen.has(id)) throw new Error("model ids must be unique.");
    seen.add(id);
    return { label: model.label.trim(), id };
  });
}

export function loadPiModels(): PiModel[] {
  try {
    const saved = localStorage.getItem(PI_MODELS_KEY);
    if (saved) return validatePiModels(JSON.parse(saved));
  } catch {
    /* Unavailable storage or invalid saved data uses the defaults. */
  }
  return DEFAULT_PI_MODELS.map((model) => ({ ...model }));
}

export function isCurrentPiModel(status: BotRuntimeStatus, id: string): boolean {
  return id.includes("/")
    ? id === `${status.model_provider}/${status.model_id}`
    : id === status.model_id;
}

export function supportsPiFast(status: BotRuntimeStatus): boolean {
  return (
    status.runtime === "pi" &&
    !/claude/i.test(status.model_id) &&
    !/anthropic/i.test(status.model_provider)
  );
}

export function piControlCommand(
  status: BotRuntimeStatus,
  control: "model" | "thinking" | "fast",
  value = "",
): string | null {
  if (status.runtime !== "pi") return null;
  if (control === "model") {
    validatePiModels([{ label: value, id: value }]);
    return isCurrentPiModel(status, value) ? null : `/model ${value}`;
  }
  if (control === "thinking") {
    if (!(PI_EFFORTS as readonly string[]).includes(value))
      throw new Error("unknown effort level.");
    return status.reasoning === value ? null : `/thinking ${value}`;
  }
  return supportsPiFast(status) ? "/fast" : null;
}

export function piCommandPayload(
  target: BotRuntimeStatusTarget,
  commands: WorkspaceBotCommand[],
  body: string,
  nonce: string,
) {
  const command = body.split(" ")[0].slice(1);
  const owned = commands.find(
    (item) => item.bot.id === target.botUserID && item.command.replace(/^\//, "") === command,
  );
  // Never fall back to an unaddressed command in a shared channel.
  if (target.kind === "channels" && !owned)
    throw new Error(`this bot hasn't registered /${command}.`);
  return { body, nonce, ...(target.kind === "channels" ? { bot_command_id: owned!.id } : {}) };
}
