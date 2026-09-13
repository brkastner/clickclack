import assert from "node:assert/strict";
import test from "node:test";
import {
  OutputGallerySession,
  boundOutputBot,
  outputSourceKey,
  type OutputPage,
} from "./output-gallery.ts";
import type { Message, User } from "./types.ts";
const message = (id: string) =>
  ({ id, workspace_id: "w", author_id: "b", created_at: "2026-01-01T00:00:00Z" }) as Message;
const page = (ids: string[], cursor: string | null = null): OutputPage => ({
  outputs: ids.map(message),
  next_cursor: cursor,
});

test("source binding uses immutable ID despite duplicate names, renames and deletion", () => {
  const bots = [
    { id: "a", kind: "bot", display_name: "VAI" },
    { id: "b", kind: "bot", display_name: "VAI" },
  ] as User[];
  assert.equal(boundOutputBot(bots, "")?.id, undefined);
  assert.equal(boundOutputBot(bots, "b")?.id, "b");
  bots[1].display_name = "Renamed";
  assert.equal(boundOutputBot(bots, "b")?.id, "b");
  bots[1].deleted_at = "now";
  assert.equal(boundOutputBot(bots, "b"), undefined);
  assert.notEqual(outputSourceKey("a", "w"), outputSourceKey("b", "w"));
  assert.notEqual(outputSourceKey("a", "w"), outputSourceKey("a", "x"));
});
test("cancelled page cannot populate a switched source", async () => {
  let resolve!: (page: OutputPage) => void;
  const session = new OutputGallerySession(() => new Promise((done) => (resolve = done)));
  const pending = session.load();
  session.cancel();
  resolve(page(["old"]));
  await pending;
  assert.deepEqual(session.outputs, []);
  assert.equal(session.busy, false);
});
test("load-more failure retains pages and retry deduplicates", async () => {
  let fail = true;
  const session = new OutputGallerySession(async (cursor) => {
    if (!cursor) return page(["a", "b"], "older");
    if (fail) throw new Error("offline");
    return page(["b", "c"]);
  });
  await session.load();
  await session.load(true);
  assert.deepEqual(
    session.outputs.map((m) => m.id),
    ["a", "b"],
  );
  assert.ok(session.error);
  fail = false;
  await session.load(true);
  assert.deepEqual(
    session.outputs.map((m) => m.id),
    ["a", "b", "c"],
  );
  assert.equal(session.error, "");
});
test("revalidation removes revoked/deleted cards without inserting new cards or reordering", async () => {
  let fresh = false;
  const session = new OutputGallerySession(async () =>
    fresh ? page(["new", "a"]) : page(["a", "deleted"]),
  );
  await session.load();
  fresh = true;
  await session.revalidate();
  assert.deepEqual(
    session.outputs.map((m) => m.id),
    ["a"],
  );
  const latest = await session.latest();
  assert.equal(latest?.id, "new");
});
test("failed revalidation clears inaccessible cached content", async () => {
  let fail = false;
  const session = new OutputGallerySession(async () => {
    if (fail) throw new Error("revoked");
    return page(["a"]);
  });
  await session.load();
  fail = true;
  await session.revalidate();
  assert.deepEqual(session.outputs, []);
});
test("return token preserves selected card and scroll while latest always requests limit one", async () => {
  const limits: number[] = [];
  const session = new OutputGallerySession(async (_, limit) => {
    limits.push(limit);
    return page(["a"]);
  });
  await session.load();
  session.selectedID = "a";
  session.scrollTop = 840;
  session.anchorID = "a";
  session.anchorOffset = 20;
  await session.revalidate();
  await session.latest();
  assert.equal(session.selectedID, "a");
  assert.equal(session.scrollTop, 840);
  assert.equal(session.anchorID, "a");
  assert.equal(session.anchorOffset, 20);
  assert.deepEqual(limits, [30, 30, 1]);
});
