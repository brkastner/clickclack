const NOTIFICATION_MESSAGE_RETRY_DELAYS_MS = [0, 75, 150] as const;

export async function loadNotificationMessage<T>(
  load: () => Promise<T>,
  wait: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise((resolve) => window.setTimeout(resolve, delayMs)),
): Promise<T | null> {
  for (const delayMs of NOTIFICATION_MESSAGE_RETRY_DELAYS_MS) {
    if (delayMs > 0) await wait(delayMs);
    try {
      return await load();
    } catch {
      // Durable realtime events can arrive just before their message is readable.
    }
  }
  return null;
}
