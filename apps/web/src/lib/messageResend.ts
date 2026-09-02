import type { Message, Upload } from "./types";

export type ResendMessageContent = {
  body: string;
  quotedMessageID?: string;
  uploads: Upload[];
  workspaceID: string;
  channelID?: string;
  directConversationID?: string;
  topicID?: string;
};

export function messageContentForResend(message: Message): ResendMessageContent | null {
  const body = message.body.trim();
  if (!body || message.status || message.deleted_at) return null;

  return {
    body,
    quotedMessageID: message.quoted_message_id,
    uploads: [...(message.attachments || [])],
    workspaceID: message.workspace_id,
    channelID: message.channel_id,
    directConversationID: message.direct_conversation_id,
    topicID: message.topic_id,
  };
}
