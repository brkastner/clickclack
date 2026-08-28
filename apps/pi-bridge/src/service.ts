import type { ClickClackClient } from "@clickclack/sdk-ts";
import type { BridgeConfig } from "./config.js";
import type { PiSessionFactory } from "./clients.js";
import type { Logger } from "./logger.js";
import type { BridgeStore } from "./store.js";

export class BridgeService {
  private stopped = false;

  constructor(
    private readonly config: BridgeConfig,
    private readonly store: BridgeStore,
    private readonly clickclack: ClickClackClient,
    private readonly piSessions: PiSessionFactory,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    const bot = await this.clickclack.me();
    if (bot.kind !== "bot")
      throw new Error(`configured ClickClack credential belongs to ${bot.kind}, not a bot`);
    this.logger.info("bridge ready", {
      workspace_id: this.config.clickclack.workspaceId,
      bot_user_id: bot.id,
      invocation_mode: this.config.invocationMode,
      projects: Object.keys(this.config.projects),
      cursor: this.store.getCursor(this.config.clickclack.workspaceId),
    });
    void this.piSessions;
  }

  async stop(signal: string): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.logger.info("bridge stopping", { signal });
    this.store.close();
    this.logger.info("bridge stopped");
  }
}
