import assert from "node:assert/strict";
import test from "node:test";
import { browserFilesFromDesktop, type DesktopClipboardFile } from "./desktop.ts";

function payload(name: string, type = "image/png"): DesktopClipboardFile {
  return { bytes: Uint8Array.from([1, 2, 3]), name, type };
}

test("converts desktop clipboard payloads without exposing local paths", async () => {
  const files = browserFilesFromDesktop([payload("one.png"), payload("two.jpg", "image/jpeg")]);
  assert.deepEqual(
    files.map(({ name, type, size }) => ({ name, type, size })),
    [
      { name: "one.png", type: "image/png", size: 3 },
      { name: "two.jpg", type: "image/jpeg", size: 3 },
    ],
  );
  assert.deepEqual([...new Uint8Array(await files[0].arrayBuffer())], [1, 2, 3]);
  assert.deepEqual(
    browserFilesFromDesktop([payload("/tmp/leak.png"), payload("notes.txt", "text/plain")]),
    [],
  );
});

test("bounds desktop clipboard file conversion", () => {
  const files = browserFilesFromDesktop([
    ...Array.from({ length: 10 }, (_, index) => payload(`${index}.png`)),
    payload("extra.png"),
  ]);
  assert.equal(files.length, 10);
});
