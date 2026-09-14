import assert from "node:assert/strict";
import test from "node:test";
import type { Upload } from "./types.ts";

const storage = new Map<string, string>();
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
const queue = await import("./gallery-attachment-queue.ts");
const upload = (id: string) =>
  ({ id, workspace_id: "w", filename: `${id}.png`, content_type: "image/png" }) as Upload;

test("gallery queue is user/workspace scoped, deduplicated and consumes only for its chosen destination", () => {
  storage.clear();
  queue.enqueueGalleryAttachment("u", "w", upload("one"), 2);
  queue.enqueueGalleryAttachment("u", "w", upload("one"), 2);
  queue.enqueueGalleryAttachment("u", "w", upload("two"), 2);
  assert.deepEqual(
    queue.galleryAttachmentQueue("u", "w").uploads.map((item) => item.id),
    ["one", "two"],
  );
  assert.equal(queue.setGalleryAttachmentDestination("u", "w", "channel-a"), true);
  assert.deepEqual(queue.consumeGalleryAttachments("u", "w", "channel-b"), []);
  assert.deepEqual(
    queue.consumeGalleryAttachments("u", "w", "channel-a").map((item) => item.id),
    ["one", "two"],
  );
  assert.deepEqual(queue.galleryAttachmentQueue("u", "w").uploads, []);
  assert.deepEqual(queue.galleryAttachmentQueue("other", "w").uploads, []);
});
