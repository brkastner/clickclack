import type { DirectConversation, RealtimeEvent } from "./types";

export function directConversationIDForRecencyEvent(event: RealtimeEvent): string {
  if (event.type !== "message.created" && event.type !== "thread.reply_created") return "";
  const conversationID = event.payload.direct_conversation_id;
  return typeof conversationID === "string" ? conversationID : "";
}

export function promoteDirectConversation(
  conversations: DirectConversation[],
  conversationID: string,
): DirectConversation[] {
  const index = conversations.findIndex((conversation) => conversation.id === conversationID);
  if (index <= 0) return conversations;
  return [
    conversations[index],
    ...conversations.slice(0, index),
    ...conversations.slice(index + 1),
  ];
}
