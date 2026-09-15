import assert from "node:assert/strict";
import test from "node:test";
import {
  composerTextFor,
  onSharedContent,
  parseSharedPayload,
  readSharedFile,
  releaseShare,
  resolveShare,
  type SharedItem,
} from "./native-share.ts";
import type { NativeBridge as Bridge } from "./native.ts";

type ShareFixture = {
  files?: Record<string, string>;
  pending?: unknown;
  chunkBytes?: number;
  failOn?: string;
};

/**
 * A shell that holds shared files and hands them over a chunk at a time, the
 * way ShareTargetPlugin does.
 */
function fakeShell(fixture: ShareFixture = {}) {
  const files = fixture.files ?? {};
  const chunkBytes = fixture.chunkBytes ?? 4;
  const calls: { method: string; options: Record<string, unknown> }[] = [];
  let listener: ((payload: unknown) => void) | undefined;
  let removed = false;

  const bridge: Bridge = {
    getPlatform: () => "android",
    isNativePlatform: () => true,
    Plugins: {
      ShareTarget: {
        getPendingShare: async () => {
          calls.push({ method: "getPendingShare", options: {} });
          return { share: fixture.pending ?? null };
        },
        readChunk: async (options: Record<string, unknown>) => {
          calls.push({ method: "readChunk", options });
          const item = String(options.itemId);
          if (fixture.failOn === item) throw new Error("unreadable");
          const body = files[item] ?? "";
          const offset = Number(options.offset ?? 0);
          const slice = body.slice(offset, offset + chunkBytes);
          return {
            data: Buffer.from(slice, "binary").toString("base64"),
            bytes: slice.length,
            done: offset + slice.length >= body.length,
          };
        },
        releaseShare: async (options: Record<string, unknown>) => {
          calls.push({ method: "releaseShare", options });
        },
        addListener: (event: string, handler: (payload: unknown) => void) => {
          if (event === "shareReceived") listener = handler;
          return { remove: () => void (removed = true) };
        },
      },
    },
  };

  return {
    bridge,
    calls,
    removed: () => removed,
    emit: (payload: unknown) => listener?.(payload),
  };
}

const ITEM: SharedItem = { id: "0", name: "photo.jpg", mimeType: "image/jpeg", size: 9 };

test("a share is read out of the bridge payload, whatever else it carries", () => {
  const share = parseSharedPayload({
    share: {
      id: "share-1",
      text: "https://example.com",
      subject: "Example",
      items: [{ id: "0", name: "a.jpg", mimeType: "IMAGE/JPEG", size: 12.7 }],
    },
  });
  assert.equal(share?.id, "share-1");
  assert.equal(share?.items.length, 1);
  // Sizes are bytes; a provider reporting a fraction must not reach arithmetic.
  assert.equal(share?.items[0].size, 12);
});

test("a payload from an older or broken shell is refused rather than half-read", () => {
  assert.equal(parseSharedPayload(null), null);
  assert.equal(parseSharedPayload({ share: null }), null);
  assert.equal(parseSharedPayload({ id: "" }), null);
  // An item with no id cannot be read back, so it is dropped, not carried.
  const share = parseSharedPayload({ id: "s", items: [{ name: "x" }, { id: "1" }] });
  assert.equal(share?.items.length, 1);
  assert.equal(share?.items[0].name, "shared");
  assert.equal(share?.items[0].mimeType, "application/octet-stream");
});

test("a share of more items than the composer accepts is truncated", () => {
  const items = Array.from({ length: 60 }, (_, index) => ({ id: String(index) }));
  assert.equal(parseSharedPayload({ id: "s", items })?.items.length, 50);
});

test("a shared link keeps its title without repeating it", () => {
  assert.equal(
    composerTextFor({ text: "https://example.com", subject: "Example" }),
    "Example\nhttps://example.com",
  );
  // A sender that puts the same string in both must not produce it twice.
  assert.equal(composerTextFor({ text: "same", subject: "same" }), "same");
  assert.equal(
    composerTextFor({ text: "read Example now", subject: "Example" }),
    "read Example now",
  );
  assert.equal(composerTextFor({ text: "", subject: "Example" }), "Example");
  assert.equal(composerTextFor({ text: "  spaced  ", subject: "" }), "spaced");
});

test("a shared file is pulled across the bridge in chunks and reassembled", async () => {
  const shell = fakeShell({ files: { "0": "ABCDEFGHI" }, chunkBytes: 4 });
  const file = await readSharedFile("share-1", ITEM, shell.bridge);
  assert.equal(file.name, "photo.jpg");
  assert.equal(file.type, "image/jpeg");
  assert.equal(await file.text(), "ABCDEFGHI");
  // 9 bytes in 4-byte windows: three reads, and the offsets must advance.
  const reads = shell.calls.filter((call) => call.method === "readChunk");
  assert.equal(reads.length, 3);
  assert.deepEqual(
    reads.map((call) => call.options.offset),
    [0, 4, 8],
  );
});

test("an empty shared file ends the read instead of looping", async () => {
  const shell = fakeShell({ files: { "0": "" } });
  const file = await readSharedFile("share-1", { ...ITEM, size: 0 }, shell.bridge);
  assert.equal(await file.text(), "");
  assert.equal(shell.calls.filter((call) => call.method === "readChunk").length, 1);
});

test("a shell that never reports completion still stops at the reported size", async () => {
  const calls: number[] = [];
  const bridge: Bridge = {
    getPlatform: () => "android",
    isNativePlatform: () => true,
    Plugins: {
      ShareTarget: {
        readChunk: async (options: Record<string, unknown>) => {
          calls.push(Number(options.offset));
          // Never sets `done`, and always reports bytes.
          return { data: Buffer.from("AB").toString("base64"), bytes: 2, done: false };
        },
      },
    },
  };
  const file = await readSharedFile("share-1", { ...ITEM, size: 6 }, bridge);
  assert.equal(await file.text(), "ABABAB");
  assert.deepEqual(calls, [0, 2, 4]);
});

test("one unreadable file does not sink the rest of the share", async () => {
  const shell = fakeShell({ files: { "0": "AAAA", "1": "BBBB", "2": "CCCC" }, failOn: "1" });
  const resolved = await resolveShare(
    {
      id: "share-1",
      text: "look",
      subject: "",
      items: [
        { ...ITEM, id: "0", name: "a.jpg", size: 4 },
        { ...ITEM, id: "1", name: "b.jpg", size: 4 },
        { ...ITEM, id: "2", name: "c.jpg", size: 4 },
      ],
    },
    shell.bridge,
  );
  assert.equal(resolved.text, "look");
  assert.deepEqual(
    resolved.files.map((file) => file.name),
    ["a.jpg", "c.jpg"],
  );
});

test("a share waiting at launch is claimed, and the same share is not delivered twice", async () => {
  const pending = { id: "share-1", text: "hi", subject: "", items: [] };
  const shell = fakeShell({ pending });
  const seen: string[] = [];
  const stop = onSharedContent((share) => seen.push(share.id), shell.bridge);
  await Promise.resolve();
  await Promise.resolve();
  // A cold start delivers the same share through both paths.
  shell.emit({ share: pending });
  assert.deepEqual(seen, ["share-1"]);
  shell.emit({ share: { id: "share-2", text: "", subject: "", items: [] } });
  assert.deepEqual(seen, ["share-1", "share-2"]);
  stop();
  assert.equal(shell.removed(), true);
  shell.emit({ share: { id: "share-3", text: "", subject: "", items: [] } });
  assert.deepEqual(seen, ["share-1", "share-2"]);
});

test("nothing is claimed off-device", () => {
  const shell = fakeShell({ pending: { id: "share-1", items: [] } });
  const web: Bridge = { ...shell.bridge, isNativePlatform: () => false };
  const stop = onSharedContent(() => assert.fail("a browser has no share sheet"), web);
  stop();
  assert.equal(shell.calls.length, 0);
});

test("releasing a share tells the shell to drop its copy, and survives a shell that cannot", async () => {
  const shell = fakeShell();
  await releaseShare("share-1", shell.bridge);
  assert.deepEqual(shell.calls.at(-1), {
    method: "releaseShare",
    options: { shareId: "share-1" },
  });
  // A shell without the plugin must not turn cleanup into an unhandled rejection.
  await releaseShare("share-1", { isNativePlatform: () => true, Plugins: {} });
});
