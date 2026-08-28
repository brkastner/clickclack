import { isAbsolute, resolve } from "node:path";

export type InvocationMode = "mention" | "always";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type BridgeConfig = {
  clickclack: {
    baseUrl: string;
    botToken: string;
    workspaceId: string;
    ownerIds: readonly string[];
  };
  databasePath: string;
  invocationMode: InvocationMode;
  model: string;
  thinkingLevel: ThinkingLevel;
  projects: Readonly<Record<string, string>>;
};

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`invalid bridge configuration:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const issues: string[] = [];
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) issues.push(`${name} is required`);
    return value ?? "";
  };

  const baseUrl = required("CLICKCLACK_URL");
  const botToken = required("CLICKCLACK_BOT_TOKEN");
  const workspaceId = required("CLICKCLACK_WORKSPACE_ID");
  const ownerIds = csv(required("CLICKCLACK_OWNER_IDS"));
  if (ownerIds.length === 0) issues.push("CLICKCLACK_OWNER_IDS must contain at least one user ID");

  const invocationMode = env.CLICKCLACK_INVOCATION_MODE?.trim() || "mention";
  if (invocationMode !== "mention" && invocationMode !== "always") {
    issues.push("CLICKCLACK_INVOCATION_MODE must be mention or always");
  }

  const thinkingLevel = env.PI_THINKING_LEVEL?.trim() || "medium";
  const thinkingLevels: ThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ];
  if (!thinkingLevels.includes(thinkingLevel as ThinkingLevel)) {
    issues.push(`PI_THINKING_LEVEL must be one of ${thinkingLevels.join(", ")}`);
  }

  const projects = parseProjects(required("CLICKCLACK_PROJECTS"), issues);
  const databasePath = resolve(env.CLICKCLACK_BRIDGE_DB?.trim() || "data/pi-bridge.db");
  const model = required("PI_MODEL");

  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    issues.push("CLICKCLACK_URL must be an http or https URL");
  }

  if (issues.length > 0) throw new ConfigError(issues);
  return {
    clickclack: { baseUrl, botToken, workspaceId, ownerIds },
    databasePath,
    invocationMode: invocationMode as InvocationMode,
    model,
    thinkingLevel: thinkingLevel as ThinkingLevel,
    projects,
  };
}

function csv(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function parseProjects(raw: string, issues: string[]): Readonly<Record<string, string>> {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    issues.push('CLICKCLACK_PROJECTS must be JSON such as {"clickclack":"/absolute/path"}');
    return {};
  }
  if (!input || Array.isArray(input) || typeof input !== "object") {
    issues.push("CLICKCLACK_PROJECTS must be a JSON object");
    return {};
  }
  const projects: Record<string, string> = {};
  for (const [alias, value] of Object.entries(input)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(alias)) {
      issues.push(`project alias ${JSON.stringify(alias)} is invalid`);
      continue;
    }
    if (typeof value !== "string" || !isAbsolute(value)) {
      issues.push(`project ${alias} must point to an absolute path`);
      continue;
    }
    projects[alias] = resolve(value);
  }
  if (Object.keys(projects).length === 0)
    issues.push("CLICKCLACK_PROJECTS must define at least one project");
  return projects;
}
