import { ClickClackClient } from "@clickclack/sdk-ts";
import {
  createAgentSession,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { BridgeConfig } from "./config.js";

export function createClickClackClient(config: BridgeConfig): ClickClackClient {
  return new ClickClackClient({
    baseUrl: config.clickclack.baseUrl,
    token: config.clickclack.botToken,
  });
}

export class PiSessionFactory {
  private constructor(
    private readonly config: BridgeConfig,
    private readonly modelRuntime: ModelRuntime,
  ) {}

  static async create(config: BridgeConfig): Promise<PiSessionFactory> {
    return new PiSessionFactory(config, await ModelRuntime.create());
  }

  async open(projectAlias: string, sessionFile?: string): Promise<AgentSession> {
    const cwd = this.config.projects[projectAlias];
    if (!cwd) throw new Error(`unknown project alias: ${projectAlias}`);
    const resolved = resolveCliModel({
      cliModel: this.config.model,
      modelRuntime: this.modelRuntime,
    });
    if (resolved.error || !resolved.model)
      throw new Error(resolved.error ?? `model not found: ${this.config.model}`);
    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile)
      : SessionManager.create(cwd);
    const { session } = await createAgentSession({
      cwd,
      model: resolved.model,
      thinkingLevel: this.config.thinkingLevel,
      modelRuntime: this.modelRuntime,
      sessionManager,
    });
    return session;
  }
}
