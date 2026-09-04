import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_CLIPBOARD_IMAGE_FILES = 10;
export const MAX_URI_LIST_LINES = 256;
export const MAX_UPLOAD_BYTES = 64 << 20;
// A paste may contain several valid uploads, but it should not retain hundreds
// of MiB in both Electron's main and renderer processes at once.
export const MAX_CLIPBOARD_IMAGE_BYTES = 128 << 20;

const IMAGE_TYPES = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

export type DesktopClipboardFile = {
  bytes: Uint8Array;
  name: string;
  type: string;
};

type FileMetadata = {
  dev: number | bigint;
  ino: number | bigint;
  size: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
};

type ClipboardFileHandle = {
  close(): Promise<void>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  stat(): Promise<FileMetadata>;
};

export type ClipboardFileSystem = {
  lstat(filePath: string): Promise<FileMetadata>;
  open(filePath: string, flags: number): Promise<ClipboardFileHandle>;
  realpath(filePath: string): Promise<string>;
};

type ReadClipboardImageOptions = {
  fileSystem?: ClipboardFileSystem;
  maxAggregateBytes?: number;
};

const nodeFileSystem: ClipboardFileSystem = { lstat, open, realpath };

export function parseURIList(input: string, maxLines = MAX_URI_LIST_LINES): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of input.split(/\r\n|\n|\r/, Math.max(0, maxLines))) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    try {
      const url = new URL(line);
      if (
        url.protocol !== "file:" ||
        (url.hostname && url.hostname.toLowerCase() !== "localhost")
      ) {
        continue;
      }
      const filePath = fileURLToPath(url);
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      paths.push(filePath);
    } catch {
      // A malformed or non-local URI is not a clipboard-selected file.
    }
  }
  return paths;
}

export async function readClipboardImageFiles(
  uriList: string,
  options: ReadClipboardImageOptions = {},
): Promise<DesktopClipboardFile[]> {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const maxAggregateBytes = options.maxAggregateBytes ?? MAX_CLIPBOARD_IMAGE_BYTES;
  const files: DesktopClipboardFile[] = [];
  let totalBytes = 0;
  for (const filePath of parseURIList(uriList)) {
    if (files.length >= MAX_CLIPBOARD_IMAGE_FILES) break;
    const file = await readClipboardImageFile(
      filePath,
      Math.max(0, maxAggregateBytes - totalBytes),
      fileSystem,
    );
    if (!file) continue;
    files.push(file);
    totalBytes += file.bytes.byteLength;
  }
  return files;
}

async function readClipboardImageFile(
  filePath: string,
  remainingBytes: number,
  fileSystem: ClipboardFileSystem,
): Promise<DesktopClipboardFile | null> {
  const type = IMAGE_TYPES.get(path.extname(filePath).toLowerCase());
  if (!type) return null;

  try {
    const metadata = await fileSystem.lstat(filePath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > MAX_UPLOAD_BYTES ||
      metadata.size > remainingBytes
    ) {
      return null;
    }
    if ((await fileSystem.realpath(filePath)) !== path.resolve(filePath)) return null;

    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    const handle = await fileSystem.open(filePath, flags);
    try {
      const openedMetadata = await handle.stat();
      if (
        !openedMetadata.isFile() ||
        openedMetadata.dev !== metadata.dev ||
        openedMetadata.ino !== metadata.ino ||
        openedMetadata.size !== metadata.size ||
        openedMetadata.size > MAX_UPLOAD_BYTES ||
        openedMetadata.size > remainingBytes
      ) {
        return null;
      }
      const bytes = new Uint8Array(openedMetadata.size);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
        if (bytesRead === 0) return null;
        offset += bytesRead;
      }
      const finalMetadata = await handle.stat();
      if (
        finalMetadata.dev !== openedMetadata.dev ||
        finalMetadata.ino !== openedMetadata.ino ||
        finalMetadata.size !== openedMetadata.size ||
        !hasImageSignature(bytes, type)
      ) {
        return null;
      }
      return { bytes, name: path.basename(filePath), type };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export function hasImageSignature(bytes: Uint8Array, type: string): boolean {
  switch (type) {
    case "image/png":
      return startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
    case "image/jpeg":
      return startsWith(bytes, [255, 216, 255]);
    case "image/gif": {
      const header = new TextDecoder().decode(bytes.subarray(0, 6));
      return header === "GIF87a" || header === "GIF89a";
    }
    case "image/webp":
      return (
        startsWith(bytes, [82, 73, 70, 70]) &&
        new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
      );
    default:
      return false;
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}
