/**
 * Receiving what Android's share sheet hands the app.
 *
 * The shell copies a shared payload into its own cache and describes it across
 * the bridge; the bytes follow separately, in chunks. That shape is forced: the
 * web app is served from a real server origin, so it can neither read the
 * `content://` URI the share sheet produced nor fetch Capacitor's
 * `_capacitor_file_` route, which sends no CORS header and is therefore
 * cross-origin. See apps/mobile/native/android/ShareTargetPlugin.java.
 *
 * Everything here degrades to nothing off-device, like the rest of the native
 * bridge, and the pure parts are separated from the plugin calls so they can be
 * tested without a shell.
 */
import { isNativeMobile, listenNative, nativeBridge, requireNative } from "./native.ts";
import type { NativeBridge } from "./native.ts";

const PLUGIN = "ShareTarget";

/** Matches the plugin's own ceiling, which matches the composer's. */
export const MAX_SHARED_ITEMS = 50;

/** One shared file, still sitting in the shell's cache. */
export type SharedItem = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
};

export type SharedPayload = {
  id: string;
  /** The shared text: a link, a quote, or a caption sent alongside images. */
  text: string;
  /** Some senders put the page title here and the URL in `text`. */
  subject: string;
  items: SharedItem[];
};

/** What the composer should end up holding. */
export type ResolvedShare = {
  text: string;
  files: File[];
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asItem(value: unknown): SharedItem | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id);
  if (!id) return null;
  const size = typeof raw.size === "number" && Number.isFinite(raw.size) ? raw.size : 0;
  return {
    id,
    name: asString(raw.name) || "shared",
    mimeType: asString(raw.mimeType) || "application/octet-stream",
    size: Math.max(0, Math.trunc(size)),
  };
}

/**
 * Read a share out of whatever the bridge produced. The shell is a separate
 * artifact that can be older than the web app it loads, so nothing here trusts
 * the payload's shape.
 */
export function parseSharedPayload(value: unknown): SharedPayload | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const share =
    raw.share && typeof raw.share === "object" ? (raw.share as Record<string, unknown>) : raw;
  const id = asString(share.id);
  if (!id) return null;
  const items = Array.isArray(share.items)
    ? share.items
        .map(asItem)
        .filter((item): item is SharedItem => item !== null)
        .slice(0, MAX_SHARED_ITEMS)
    : [];
  return { id, text: asString(share.text), subject: asString(share.subject), items };
}

/**
 * The text to seed the composer with. A link shared from a browser arrives as a
 * URL in `text` and the page title in `subject`; keeping both, in that order,
 * matches what a person pasting a link would write. When the two are the same,
 * or the subject is already inside the text, the subject is dropped rather than
 * repeated.
 */
export function composerTextFor(share: Pick<SharedPayload, "text" | "subject">): string {
  const text = share.text.trim();
  const subject = share.subject.trim();
  if (!subject || subject === text || text.includes(subject)) return text;
  if (!text) return subject;
  return `${subject}\n${text}`;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

type Chunk = { data: string; bytes: number; done: boolean };

function asChunk(value: unknown): Chunk {
  const raw = (value ?? {}) as Record<string, unknown>;
  const bytes = typeof raw.bytes === "number" && Number.isFinite(raw.bytes) ? raw.bytes : 0;
  return {
    data: asString(raw.data),
    bytes: Math.max(0, Math.trunc(bytes)),
    done: raw.done === true,
  };
}

/**
 * Pull one shared file across the bridge. Reading stops at the size the shell
 * reported, and a chunk that returns nothing ends the loop, so a shell that
 * never sets `done` cannot spin this forever.
 */
export async function readSharedFile(
  shareID: string,
  item: SharedItem,
  bridge: NativeBridge | undefined = nativeBridge(),
): Promise<File> {
  const parts: BlobPart[] = [];
  let offset = 0;
  for (;;) {
    const chunk = asChunk(
      await requireNative(
        PLUGIN,
        "readChunk",
        { shareId: shareID, itemId: item.id, offset },
        bridge,
      ),
    );
    if (chunk.bytes > 0) {
      parts.push(decodeBase64(chunk.data) as unknown as BlobPart);
      offset += chunk.bytes;
    }
    if (chunk.done || chunk.bytes === 0) break;
    if (item.size > 0 && offset >= item.size) break;
  }
  return new File(parts, item.name, { type: item.mimeType });
}

/**
 * Turn a described share into composer input. One unreadable file does not sink
 * the rest: the shell copies each item independently, and a share of ten photos
 * where one provider misbehaved is still nine photos someone wanted to send.
 */
export async function resolveShare(
  share: SharedPayload,
  bridge: NativeBridge | undefined = nativeBridge(),
): Promise<ResolvedShare> {
  const files: File[] = [];
  for (const item of share.items) {
    try {
      files.push(await readSharedFile(share.id, item, bridge));
    } catch {
      // Skip it; the composer still receives everything that did arrive.
    }
  }
  return { text: composerTextFor(share), files };
}

/** Tell the shell the bytes are held elsewhere now, so it can drop its copy. */
export async function releaseShare(
  shareID: string,
  bridge: NativeBridge | undefined = nativeBridge(),
): Promise<void> {
  try {
    await requireNative(PLUGIN, "releaseShare", { shareId: shareID }, bridge);
  } catch {
    // The shell clears stale shares on its next launch regardless.
  }
}

/**
 * Deliver shares to the app for as long as the subscription is held.
 *
 * Both arrival paths are covered. A share that starts the app is waiting before
 * any listener exists, so it is claimed once on subscribe; a share that arrives
 * while the app is open comes through the event. The share id guards the
 * overlap, because a cold start delivers the same share both ways.
 */
export function onSharedContent(
  handle: (share: SharedPayload) => void,
  bridge: NativeBridge | undefined = nativeBridge(),
): () => void {
  if (!isNativeMobile(bridge)) return () => {};
  const seen = new Set<string>();
  let active = true;
  const deliver = (value: unknown) => {
    const share = parseSharedPayload(value);
    if (!active || !share || seen.has(share.id)) return;
    seen.add(share.id);
    handle(share);
  };
  const stop = listenNative(PLUGIN, "shareReceived", deliver, bridge);
  void requireNative(PLUGIN, "getPendingShare", undefined, bridge)
    .then(deliver)
    .catch(() => {
      // An older shell without the plugin simply never shares anything.
    });
  return () => {
    active = false;
    stop();
  };
}
