import type { Message, Upload } from "./types";

function isAutoLoadMedia(upload: Upload): boolean {
  const contentType = upload.content_type.toLowerCase();
  return (
    contentType.startsWith("image/") ||
    contentType.startsWith("video/") ||
    contentType.startsWith("audio/")
  );
}

const AUTO_LOAD_ATTACHMENT_LIMIT = 10;

function fractionalNanoseconds(timestamp: string): number {
  const fraction = timestamp.match(/\.(\d{1,9})(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "";
  return Number(fraction.padEnd(9, "0"));
}

export function recentAutoLoadAttachmentIDs(messages: readonly Message[]): ReadonlySet<string> {
  const attachments: Array<{ upload: Upload; index: number }> = [];
  for (const message of messages) {
    if (message.deleted_at) continue;
    for (const attachment of message.attachments ?? []) {
      if (isAutoLoadMedia(attachment)) {
        attachments.push({ upload: attachment, index: attachments.length });
      }
    }
  }

  attachments.sort((left, right) => {
    const leftMilliseconds = Date.parse(left.upload.created_at);
    const rightMilliseconds = Date.parse(right.upload.created_at);
    if (Number.isFinite(leftMilliseconds) && Number.isFinite(rightMilliseconds)) {
      if (leftMilliseconds !== rightMilliseconds) return rightMilliseconds - leftMilliseconds;
      const fractionDifference =
        fractionalNanoseconds(right.upload.created_at) -
        fractionalNanoseconds(left.upload.created_at);
      if (fractionDifference !== 0) return fractionDifference;
    }
    return right.index - left.index;
  });

  return new Set(attachments.slice(0, AUTO_LOAD_ATTACHMENT_LIMIT).map(({ upload }) => upload.id));
}
