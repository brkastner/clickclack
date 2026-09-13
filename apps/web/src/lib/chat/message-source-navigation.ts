import type { Message } from "../types";

export function sourceConversationID(source: {
  channel_id?: string;
  direct_conversation_id?: string;
}): string {
  return source.channel_id || source.direct_conversation_id || "";
}

export type SourceRevealPorts = {
  workspaceID: string;
  conversationID: string;
  isCurrent: () => boolean;
  fetchMessage: (id: string) => Promise<Message>;
  revealTimeline: (message: Message) => Promise<void>;
  revealThread: (message: Message) => Promise<boolean>;
};

// Callers retain their own pane/return-state ownership. This operation only
// reauthorizes and reveals the exact current message, including off-window replies.
export async function revealMessageSource(id: string, ports: SourceRevealPorts): Promise<boolean> {
  const message = await ports.fetchMessage(id);
  if (!ports.isCurrent()) return false;
  if (
    message.id !== id ||
    message.workspace_id !== ports.workspaceID ||
    sourceConversationID(message) !== ports.conversationID ||
    message.deleted_at
  ) {
    throw new Error("Source unavailable");
  }
  if (message.parent_message_id) {
    if (!(await ports.revealThread(message))) {
      if (!ports.isCurrent()) return false;
      throw new Error("Thread source unavailable");
    }
  } else await ports.revealTimeline(message);
  return ports.isCurrent();
}
