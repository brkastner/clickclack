import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MAX_CLIPBOARD_IMAGE_BYTES,
  MAX_CLIPBOARD_IMAGE_FILES,
  MAX_UPLOAD_BYTES,
  MAX_URI_LIST_LINES,
  parseURIList,
  readClipboardImageFiles,
  type ClipboardFileSystem,
} from "./clipboard-uri";

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const JPEG = Uint8Array.from([255, 216, 255, 224, 0]);

async function fixtureDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "clickclack-uri-paste-"));
}

test("parses local URI lists in order with comments, CR/LF, percent encoding, and duplicates", () => {
  const encoded = pathToFileURL(path.join(os.tmpdir(), "one image.png")).toString();
  const second = pathToFileURL(path.join(os.tmpdir(), "two.jpg")).toString();
  const localhost = second.replace("file:///", "file://localhost/");
  assert.deepEqual(parseURIList(`# copied by yazi\r\n\r\n${encoded}\n${localhost}\r${encoded}\n`), [
    fileURLToPath(encoded),
    fileURLToPath(localhost),
  ]);
});

test("rejects malformed, non-file, and remote URI-list entries", () => {
  assert.deepEqual(
    parseURIList(
      [
        "not a URI",
        "https://example.com/image.png",
        "file://remote-host/tmp/image.png",
        "file:///tmp/bad%2Fname.png",
        "# file:///tmp/comment.png",
      ].join("\n"),
    ),
    [],
  );
});

test("bounds the total URI-list lines processed", () => {
  const input = Array.from({ length: MAX_URI_LIST_LINES + 20 }, (_, index) =>
    pathToFileURL(path.join(os.tmpdir(), `${index}.png`)).toString(),
  ).join("\n");
  assert.equal(parseURIList(input).length, MAX_URI_LIST_LINES);
  assert.match(parseURIList(input).at(-1) ?? "", new RegExp(`${MAX_URI_LIST_LINES - 1}\\.png$`));

  const commentsBeforeFile = [
    ...Array.from({ length: MAX_URI_LIST_LINES }, () => "# ignored"),
    pathToFileURL(path.join(os.tmpdir(), "too-late.png")).toString(),
  ].join("\n");
  assert.deepEqual(parseURIList(commentsBeforeFile), []);
});

test("reads one through ten supported images in memory without staging files", async (t) => {
  const directory = await fixtureDirectory();
  t.after(() => rm(directory, { force: true, recursive: true }));
  const paths: string[] = [];
  for (let index = 0; index < MAX_CLIPBOARD_IMAGE_FILES; index += 1) {
    const filePath = path.join(directory, `image ${index}.png`);
    await writeFile(filePath, PNG);
    paths.push(filePath);
  }
  const before = await readdir(directory);
  for (let count = 1; count <= MAX_CLIPBOARD_IMAGE_FILES; count += 1) {
    const files = await readClipboardImageFiles(
      paths
        .slice(0, count)
        .map((item) => pathToFileURL(item))
        .join("\n"),
    );
    assert.equal(files.length, count);
    assert.deepEqual(
      files.map((file) => file.name),
      paths.slice(0, count).map((item) => path.basename(item)),
    );
    assert.ok(files.every((file) => file.type === "image/png"));
    assert.deepEqual([...files[0].bytes], [...PNG]);
  }
  assert.deepEqual(await readdir(directory), before);
});

test("does not let unsupported entries consume the validated image limit", async (t) => {
  const directory = await fixtureDirectory();
  t.after(() => rm(directory, { force: true, recursive: true }));
  const unsupported = Array.from({ length: MAX_CLIPBOARD_IMAGE_FILES + 2 }, (_, index) =>
    pathToFileURL(path.join(directory, `ignored-${index}.txt`)).toString(),
  );
  const images: string[] = [];
  for (let index = 0; index < MAX_CLIPBOARD_IMAGE_FILES; index += 1) {
    const filePath = path.join(directory, `valid-${index}.png`);
    await writeFile(filePath, PNG);
    images.push(pathToFileURL(filePath).toString());
  }

  const files = await readClipboardImageFiles([...unsupported, ...images].join("\n"));
  assert.equal(files.length, MAX_CLIPBOARD_IMAGE_FILES);
  assert.deepEqual(
    files.map((file) => file.name),
    Array.from({ length: MAX_CLIPBOARD_IMAGE_FILES }, (_, index) => `valid-${index}.png`),
  );
});

test("enforces the aggregate byte cap before opening files that cannot fit", async () => {
  assert.equal(MAX_CLIPBOARD_IMAGE_BYTES, 128 << 20);
  const opened: string[] = [];
  const read: string[] = [];
  const sizes = new Map([
    ["a.png", 8],
    ["too-large-for-remainder.png", 12],
    ["c.png", 8],
  ]);
  const fileSystem = fakeFileSystem({
    opened,
    read,
    statFor: (filePath) => metadata(sizes.get(path.basename(filePath)) ?? 0),
  });
  const uris = [...sizes.keys()]
    .map((name) => pathToFileURL(path.join(os.tmpdir(), name)).toString())
    .join("\n");

  const files = await readClipboardImageFiles(uris, { fileSystem, maxAggregateBytes: 16 });
  assert.deepEqual(
    files.map((file) => file.name),
    ["a.png", "c.png"],
  );
  assert.deepEqual(opened, ["a.png", "c.png"]);
  assert.deepEqual(read, ["a.png", "c.png"]);
  assert.equal(
    files.reduce((total, file) => total + file.bytes.byteLength, 0),
    16,
  );
});

test("rejects a same-size file when its opened identity changed", async () => {
  let read = false;
  let closed = false;
  const filePath = path.join(os.tmpdir(), "replaced.png");
  const fileSystem: ClipboardFileSystem = {
    lstat: async () => metadata(8, 10, 20),
    realpath: async () => path.resolve(filePath),
    open: async () => ({
      stat: async () => metadata(8, 10, 21),
      read: async () => {
        read = true;
        return { bytesRead: 8 };
      },
      close: async () => {
        closed = true;
      },
    }),
  };

  assert.deepEqual(
    await readClipboardImageFiles(pathToFileURL(filePath).toString(), { fileSystem }),
    [],
  );
  assert.equal(read, false);
  assert.equal(closed, true);
});

test("validates supported extensions, signatures, regular files, symlinks, and size", async (t) => {
  const directory = await fixtureDirectory();
  t.after(() => rm(directory, { force: true, recursive: true }));
  const valid = path.join(directory, "valid.jpg");
  const wrongSignature = path.join(directory, "fake.png");
  const nonImage = path.join(directory, "notes.txt");
  const imageDirectory = path.join(directory, "folder.png");
  const oversized = path.join(directory, "large.png");
  const link = path.join(directory, "link.jpg");
  const linkedDirectory = path.join(directory, "linked");
  await writeFile(valid, JPEG);
  await writeFile(wrongSignature, "not an image");
  await writeFile(nonImage, PNG);
  await mkdir(imageDirectory);
  await writeFile(oversized, PNG);
  await truncate(oversized, MAX_UPLOAD_BYTES + 1);
  const candidates = [valid, wrongSignature, nonImage, imageDirectory, oversized];
  try {
    await symlink(valid, link, "file");
    await symlink(directory, linkedDirectory, "dir");
    candidates.push(link, path.join(linkedDirectory, "valid.jpg"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
  }

  const files = await readClipboardImageFiles(
    candidates.map((item) => pathToFileURL(item)).join("\n"),
  );
  assert.deepEqual(
    files.map((file) => file.name),
    ["valid.jpg"],
  );
});

function metadata(size: number, dev = 1, ino = 1) {
  return {
    dev,
    ino,
    size,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
}

function fakeFileSystem(input: {
  opened: string[];
  read: string[];
  statFor(filePath: string): ReturnType<typeof metadata>;
}): ClipboardFileSystem {
  return {
    lstat: async (filePath) => input.statFor(filePath),
    realpath: async (filePath) => path.resolve(filePath),
    open: async (filePath) => {
      const name = path.basename(filePath);
      input.opened.push(name);
      return {
        stat: async () => input.statFor(filePath),
        read: async (buffer, offset, length, position) => {
          input.read.push(name);
          buffer.set(PNG.subarray(position, position + length), offset);
          return { bytesRead: length };
        },
        close: async () => {},
      };
    },
  };
}
