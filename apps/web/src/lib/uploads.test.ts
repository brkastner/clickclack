import assert from "node:assert/strict";
import test from "node:test";
import { fileUploadNonce, uploadWorkspaceFile } from "./uploads.ts";

test("uploadWorkspaceFile does not post an upload after its owner is cancelled", async (t) => {
  const controller = new AbortController();
  controller.abort();
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("cancelled upload reached fetch");
  });
  await assert.rejects(
    uploadWorkspaceFile(
      "workspace",
      new File(["draft"], "draft.txt", { type: "text/plain" }),
      "nonce",
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test("uploadWorkspaceFile passes cancellation through while keeping its retry nonce", async (t) => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  let requestedURL = "";
  let requestBody: FormData | undefined;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requestedURL = url;
    requestSignal = init.signal;
    requestBody = init.body as FormData;
    entered();
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
  });
  const pending = uploadWorkspaceFile(
    "workspace/one",
    new File(["draft"], "draft.txt", { type: "text/plain" }),
    "stable/nonce",
    controller.signal,
  );
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await started;
  assert.equal(requestSignal, controller.signal);
  assert.equal(requestedURL, "/api/uploads?workspace_id=workspace%2Fone&nonce=stable%2Fnonce");
  assert.equal(requestBody?.get("workspace_id"), "workspace/one");
  const file = requestBody?.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.name, "draft.txt");
  controller.abort();
  await rejected;
});

test("fileUploadNonce is stable across separate composer entries for one file", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const first = new File([bytes], "shot.png", { type: "image/png" });
  const second = new File([bytes], "shot.png", { type: "image/png" });
  assert.equal(
    await fileUploadNonce("workspace", first),
    await fileUploadNonce("workspace", second),
  );
});

test("fileUploadNonce separates equal content with different file identities", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.notEqual(
    await fileUploadNonce("workspace", new File([bytes], "first.png", { type: "image/png" })),
    await fileUploadNonce("workspace", new File([bytes], "second.png", { type: "image/png" })),
  );
});

test("fileUploadNonce separates types and delimiter-bearing identities", async () => {
  for (const [first, second] of [
    [
      new File(["same"], "a.txt", { type: "text/plain" }),
      new File(["same"], "a.txt", { type: "text/html" }),
    ],
    [new File(["same"], "a:b", { type: "c" }), new File(["same"], "a", { type: "b:c" })],
  ]) {
    assert.notEqual(
      await fileUploadNonce("workspace", first),
      await fileUploadNonce("workspace", second),
    );
  }
});

test("fileUploadNonce separates different content", async () => {
  const first = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
  const second = new File([new Uint8Array([1, 2, 4])], "a.png", { type: "image/png" });
  assert.notEqual(
    await fileUploadNonce("workspace", first),
    await fileUploadNonce("workspace", second),
  );
});

// The server answers a nonce whose upload belongs to another workspace with an
// upload nonce conflict, so one file posted in two workspaces needs two nonces.
test("fileUploadNonce separates workspaces for identical content", async () => {
  const bytes = new Uint8Array([9, 8, 7]);
  assert.notEqual(
    await fileUploadNonce("workspace-one", new File([bytes], "x.png", { type: "image/png" })),
    await fileUploadNonce("workspace-two", new File([bytes], "x.png", { type: "image/png" })),
  );
});

test("fileUploadNonce fits the server nonce length limit", async () => {
  const nonce = await fileUploadNonce("workspace", new File(["x"], "x.png", { type: "image/png" }));
  assert.match(nonce, /^[0-9a-f]{64}$/);
});
