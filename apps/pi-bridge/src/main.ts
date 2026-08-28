import { createClickClackClient, PiSessionFactory } from "./clients.js";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { BridgeService } from "./service.js";
import { BridgeStore } from "./store.js";

const logger = new Logger();

try {
  const config = loadConfig();
  const store = new BridgeStore(config.databasePath);
  const service = new BridgeService(
    config,
    store,
    createClickClackClient(config),
    await PiSessionFactory.create(config),
    logger,
  );

  let shutdown: Promise<void> | undefined;
  let finish!: () => void;
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stop = (signal: string) => {
    shutdown ??= service
      .stop(signal)
      .catch((error: unknown) => {
        logger.error("bridge shutdown failed", { error: errorMessage(error) });
        process.exitCode = 1;
      })
      .finally(finish);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  await service.start();
  await stopped;
} catch (error) {
  logger.error("bridge failed", { error: errorMessage(error) });
  process.exitCode = 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
