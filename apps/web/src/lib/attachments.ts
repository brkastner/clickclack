import type { Upload } from "./types";

export const MAX_MESSAGE_ATTACHMENTS = 10;

export type PendingAttachmentState = "uploading" | "ready" | "failed";

export type PendingAttachment = {
  key: string;
  file: File;
  workspaceID: string;
  state: PendingAttachmentState;
  upload?: Upload;
  error?: string;
};

type ClipboardItem = Pick<DataTransferItem, "kind" | "type" | "getAsFile">;

export function clipboardImageFiles(items: ArrayLike<ClipboardItem>): File[] {
  const images: File[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== "file" || !item.type.toLowerCase().startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) images.push(file);
  }
  return images;
}

export function appendPendingAttachments(
  existing: PendingAttachment[],
  files: Iterable<File>,
  workspaceID: string,
  createKey: () => string,
): { attachments: PendingAttachment[]; rejectedCount: number } {
  const selected = [...files];
  const available = Math.max(0, MAX_MESSAGE_ATTACHMENTS - existing.length);
  const accepted = selected.slice(0, available).map((file) => ({
    key: createKey(),
    file,
    workspaceID,
    state: "uploading" as const,
  }));
  return {
    attachments: [...existing, ...accepted],
    rejectedCount: selected.length - accepted.length,
  };
}

export function readyUploads(attachments: PendingAttachment[]): Upload[] {
  return attachments.flatMap((attachment) =>
    attachment.state === "ready" && attachment.upload ? [attachment.upload] : [],
  );
}

export function pendingAttachmentsForUploads(
  uploads: Upload[],
  createKey: () => string,
): PendingAttachment[] {
  return uploads.map((upload) => ({
    key: createKey(),
    file: new File([], upload.filename, { type: upload.content_type }),
    workspaceID: upload.workspace_id,
    state: "ready",
    upload,
  }));
}

export function uploadsMissingAttachments(
  uploads: Upload[],
  attachedUploadIDs: Iterable<string>,
): Upload[] {
  const attached = new Set(attachedUploadIDs);
  return uploads.filter((upload) => !attached.has(upload.id));
}

export function mergeUploads(existing: Upload[] = [], additions: Upload[] = []): Upload[] {
  const merged: Upload[] = [];
  const seen = new Set<string>();
  for (const upload of [...existing, ...additions]) {
    if (seen.has(upload.id)) continue;
    seen.add(upload.id);
    merged.push(upload);
  }
  return merged;
}
