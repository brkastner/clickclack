import assert from "node:assert/strict";
import test from "node:test";
import { uploadWorkspaceFile } from "./uploads.ts";

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
