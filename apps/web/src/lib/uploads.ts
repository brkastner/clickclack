import type { Upload } from "./types";
import { api, apiURL } from "./api.ts";
import { probeMediaDimensions } from "./media.ts";

export function uploadResourcePath(upload: Upload): string {
  return `/api/uploads/${encodeURIComponent(upload.id)}`;
}

export function uploadURL(upload: Upload): string {
  return apiURL(uploadResourcePath(upload));
}

export function newUploadNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }
  throw new Error("Secure random values are unavailable");
}

function hexDigest(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The upload nonce is the server's idempotency key: POST /api/uploads returns the
// upload it already holds for this owner and nonce instead of storing the bytes a
// second time. Deriving the nonce from the file's content means the same file
// enqueued twice resolves to the one upload, so a composer entry that is re-added
// rather than retried no longer strands a row that nothing ever attaches.
//
// The digest is scoped to the workspace because the server rejects a nonce whose
// upload lives in a different workspace. Without the scope, posting one file in
// two workspaces would fail the second time with an upload nonce conflict.
export async function fileUploadNonce(workspaceID: string, file: File): Promise<string> {
  const subtle = typeof crypto === "undefined" ? undefined : crypto.subtle;
  if (!subtle) return newUploadNonce();
  try {
    const content = hexDigest(await subtle.digest("SHA-256", await file.arrayBuffer()));
    const scoped = new TextEncoder().encode(
      JSON.stringify([workspaceID, file.name, file.type, content]),
    );
    return hexDigest(await subtle.digest("SHA-256", scoped));
  } catch {
    // SubtleCrypto is unavailable outside a secure context. A random nonce keeps
    // uploads working with the old semantics, where only a retry deduplicates.
    return newUploadNonce();
  }
}

export async function uploadWorkspaceFile(
  workspaceID: string,
  file: File,
  nonce = newUploadNonce(),
  signal = new AbortController().signal,
): Promise<Upload> {
  const probe = await probeMediaDimensions(file, signal);
  signal.throwIfAborted();
  const form = new FormData();
  form.set("workspace_id", workspaceID);
  form.set("file", file);
  if (probe.width > 0) form.set("width", String(probe.width));
  if (probe.height > 0) form.set("height", String(probe.height));
  if (probe.durationMS > 0) form.set("duration_ms", String(probe.durationMS));
  const path = `/api/uploads?workspace_id=${encodeURIComponent(workspaceID)}&nonce=${encodeURIComponent(nonce)}`;
  const data = await api<{ upload: Upload }>(path, { method: "POST", body: form, signal });
  return data.upload;
}

export function isImageUpload(upload: Upload): boolean {
  return upload.content_type.startsWith("image/");
}

export function isVideoUpload(upload: Upload): boolean {
  return upload.content_type.startsWith("video/");
}

export type ImageViewerItem = {
  url: string;
  title: string;
};

export function imageViewerItems(uploads: Upload[]): ImageViewerItem[] {
  return uploads.filter(isImageUpload).map((upload) => ({
    url: uploadURL(upload),
    title: upload.filename,
  }));
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
