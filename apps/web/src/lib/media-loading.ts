import type { Message, Upload } from "./types";

function isAutoLoadMedia(upload: Upload): boolean {
  const contentType = upload.content_type.toLowerCase();
  return (
    contentType.startsWith("image/") ||
    contentType.startsWith("video/") ||
    contentType.startsWith("audio/")
  );
}

export function newestAutoLoadAttachmentID(messages: readonly Message[]): string | undefined {
  let newest: Upload | undefined;
  for (const message of messages) {
    if (message.deleted_at) continue;
    for (const attachment of message.attachments ?? []) {
      if (!isAutoLoadMedia(attachment)) continue;
      if (!newest || attachment.created_at >= newest.created_at) newest = attachment;
    }
  }
  return newest?.id;
}
