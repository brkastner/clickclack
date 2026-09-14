import type { Upload } from "./types";

const STORAGE_KEY = "clickclack.gallery-attachment-queue.v1";

export type GalleryAttachmentQueue = {
  userID: string;
  workspaceID: string;
  uploads: Upload[];
  destinationID?: string;
};

function load(): GalleryAttachmentQueue | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const queue = JSON.parse(raw) as GalleryAttachmentQueue;
    if (
      !queue ||
      typeof queue.userID !== "string" ||
      typeof queue.workspaceID !== "string" ||
      !Array.isArray(queue.uploads)
    )
      return null;
    return queue;
  } catch {
    return null;
  }
}
function save(queue: GalleryAttachmentQueue | null) {
  try {
    if (queue) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Queue is optional when session storage is unavailable. */
  }
}

export function galleryAttachmentQueue(
  userID: string,
  workspaceID: string,
): GalleryAttachmentQueue {
  const queue = load();
  if (queue?.userID === userID && queue.workspaceID === workspaceID) return queue;
  return { userID, workspaceID, uploads: [] };
}

export function enqueueGalleryAttachment(
  userID: string,
  workspaceID: string,
  upload: Upload,
  maximum: number,
): GalleryAttachmentQueue {
  const queue = galleryAttachmentQueue(userID, workspaceID);
  if (!queue.uploads.some((item) => item.id === upload.id) && queue.uploads.length < maximum)
    queue.uploads = [...queue.uploads, upload];
  save(queue);
  return queue;
}

export function removeGalleryAttachment(
  userID: string,
  workspaceID: string,
  uploadID: string,
): GalleryAttachmentQueue {
  const queue = galleryAttachmentQueue(userID, workspaceID);
  queue.uploads = queue.uploads.filter((upload) => upload.id !== uploadID);
  save(queue);
  return queue;
}

export function clearGalleryAttachments(userID: string, workspaceID: string) {
  const queue = galleryAttachmentQueue(userID, workspaceID);
  queue.uploads = [];
  queue.destinationID = undefined;
  save(queue);
}

export function setGalleryAttachmentDestination(
  userID: string,
  workspaceID: string,
  destinationID: string,
) {
  const queue = galleryAttachmentQueue(userID, workspaceID);
  if (!queue.uploads.length) return false;
  queue.destinationID = destinationID;
  save(queue);
  return true;
}

export function consumeGalleryAttachments(
  userID: string,
  workspaceID: string,
  destinationID: string,
): Upload[] {
  const queue = load();
  if (
    !queue ||
    queue.userID !== userID ||
    queue.workspaceID !== workspaceID ||
    queue.destinationID !== destinationID
  )
    return [];
  const uploads = queue.uploads;
  save({ ...queue, uploads: [], destinationID: undefined });
  return uploads;
}

export function retainGalleryAttachments(userID: string, workspaceID: string, uploads: Upload[]) {
  const queue = galleryAttachmentQueue(userID, workspaceID);
  queue.uploads = uploads;
  queue.destinationID = undefined;
  save(queue);
}
