import assert from "node:assert/strict";
import test from "node:test";
import {
  absoluteAttachmentURL,
  copyAttachmentLink,
  copyViewerImage,
} from "./image-viewer-clipboard.ts";

function clipboardRecorder() {
  const imageWrites: ClipboardItem[][] = [];
  const textWrites: string[] = [];
  return {
    clipboard: {
      async write(items: ClipboardItem[]) {
        imageWrites.push(items);
      },
    },
    async writeText(text: string) {
      textWrites.push(text);
    },
    imageWrites,
    textWrites,
  };
}

test("resolves attachment links against the current ClickClack page", () => {
  assert.equal(
    absoluteAttachmentURL("/api/uploads/upl_1", "https://clickclack.example/app/workspace/channel"),
    "https://clickclack.example/api/uploads/upl_1",
  );
});

test("copies an absolute attachment link", async () => {
  const recorder = clipboardRecorder();

  await copyAttachmentLink(
    "/api/uploads/upl_1",
    recorder.writeText,
    "https://clickclack.example/app/workspace/channel",
  );

  assert.deepEqual(recorder.textWrites, ["https://clickclack.example/api/uploads/upl_1"]);
});

test("uses the Electron image clipboard bridge before the browser clipboard", async () => {
  const recorder = clipboardRecorder();
  let desktopPayload: ArrayBuffer | undefined;
  let clipboardPayload: Record<string, Blob> | undefined;
  class FakeClipboardItem {
    constructor(items: Record<string, Blob>) {
      clipboardPayload = items;
    }
  }

  await copyViewerImage("/api/uploads/upl_1", {
    clipboard: recorder.clipboard,
    clipboardItem: FakeClipboardItem as unknown as typeof ClipboardItem,
    desktop: async (png) => {
      desktopPayload = png;
      return true;
    },
    fetcher: async () =>
      new Response("PNGDATA", {
        headers: { "Content-Type": "image/png" },
      }),
  });

  assert.equal(new TextDecoder().decode(desktopPayload), "PNGDATA");
  assert.equal(recorder.imageWrites.length, 0);
  assert.equal(clipboardPayload, undefined);
});

test("falls back to the browser image clipboard when the Electron bridge rejects", async () => {
  const recorder = clipboardRecorder();
  class FakeClipboardItem {
    constructor(_items: Record<string, Blob>) {}
  }

  await copyViewerImage("/api/uploads/upl_1", {
    clipboard: recorder.clipboard,
    clipboardItem: FakeClipboardItem as unknown as typeof ClipboardItem,
    desktop: async () => false,
    fetcher: async () =>
      new Response("PNGDATA", {
        headers: { "Content-Type": "image/png" },
      }),
  });

  assert.equal(recorder.imageWrites.length, 1);
});

test("downloads an authenticated image with a bounded request and copies it as PNG", async () => {
  const recorder = clipboardRecorder();
  let requestInit: RequestInit | undefined;
  let clipboardPayload: Record<string, Blob> | undefined;
  class FakeClipboardItem {
    constructor(items: Record<string, Blob>) {
      clipboardPayload = items;
    }
  }

  await copyViewerImage("/api/uploads/upl_1", {
    clipboard: recorder.clipboard,
    clipboardItem: FakeClipboardItem as unknown as typeof ClipboardItem,
    fetcher: async (_input, init) => {
      requestInit = init;
      return new Response("PNGDATA", {
        headers: { "Content-Type": "image/png" },
      });
    },
  });

  assert.equal(requestInit?.credentials, "include");
  assert.ok(requestInit?.signal instanceof AbortSignal);
  assert.equal(recorder.imageWrites.length, 1);
  assert.deepEqual(Object.keys(clipboardPayload ?? {}), ["image/png"]);
  assert.equal(await clipboardPayload?.["image/png"]?.text(), "PNGDATA");
});

test("converts JPEG and WebP images to PNG before writing them", async (context) => {
  for (const contentType of ["image/jpeg", "image/webp"]) {
    await context.test(contentType, async () => {
      const recorder = clipboardRecorder();
      let clipboardPayload: Record<string, Blob> | undefined;
      class FakeClipboardItem {
        constructor(items: Record<string, Blob>) {
          clipboardPayload = items;
        }
      }

      await copyViewerImage("/api/uploads/upl_1", {
        clipboard: recorder.clipboard,
        clipboardItem: FakeClipboardItem as unknown as typeof ClipboardItem,
        fetcher: async () =>
          new Response("SOURCE", {
            headers: { "Content-Type": contentType },
          }),
        toPNG: async (image) => {
          assert.equal(image.type, contentType);
          return new Blob(["PNGDATA"], { type: "image/png" });
        },
      });

      assert.deepEqual(Object.keys(clipboardPayload ?? {}), ["image/png"]);
      assert.equal(await clipboardPayload?.["image/png"]?.text(), "PNGDATA");
    });
  }
});

test("does not write non-image responses to the clipboard", async () => {
  const recorder = clipboardRecorder();

  await assert.rejects(
    copyViewerImage("/api/uploads/upl_1", {
      clipboard: recorder.clipboard,
      clipboardItem: class {} as unknown as typeof ClipboardItem,
      fetcher: async () =>
        new Response("nope", {
          headers: { "Content-Type": "text/plain" },
        }),
    }),
    /Expected an image/u,
  );
  assert.equal(recorder.imageWrites.length, 0);
});
