import type { Message } from "../types";

export const MESSAGE_DOUBLE_CLICK_INTERACTIVE_TARGETS =
  "a, button, input, textarea, select, [contenteditable='true'], [role='button'], .attachment-grid, .media-tile, .markdown img, .gif-player, .markdown-table-scroll";

export function canReplyOnMessageDoubleClick(
  message: Message,
  currentUserID?: string,
): boolean {
  if (!currentUserID) return false;
  const authorID = message.author?.id || message.author_id;
  return (
    authorID !== currentUserID &&
    !message.deleted_at &&
    message.status !== "pending" &&
    message.status !== "failed"
  );
}
