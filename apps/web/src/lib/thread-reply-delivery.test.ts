import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileModule } from "svelte/compiler";
import ts from "typescript";
import { latestThreadState, mergeMessageUpdate } from "./chat/messageUpdates.ts";
import type { Message } from "./types.ts";
import type { ThreadController, ThreadReplyDelivery } from "./thread.svelte.ts";

// Compile the actual controller without a DOM; these tests exercise send ownership,
// not the renderer's reactivity or layout.
const source = readFileSync(new URL("./thread.svelte.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const compiled = compileModule(js, { generate: "server", filename: "thread.svelte.js" })
  .js.code.replace(/^import .*;$/gm, "")
  .replace("export class ThreadController", "class ThreadController");
const createController = new Function(
  "api",
  "readableAPIError",
  "newNonce",
  "latestThreadState",
  "mergeMessageUpdate",
  `${compiled}\nreturn ThreadController;`,
);
const root = { id: "root-a", thread_root_id: "root-a", body: "root" } as Message;

function setup(request: (path: string, options: { body: string }) => Promise<unknown>) {
  const Controller = createController(
    request,
    (error: Error) => error.message,
    () => "stable-reply-nonce",
    latestThreadState,
    mergeMessageUpdate,
  ) as typeof ThreadController;
  let context = "workspace:channel-a";
  const controller = new Controller(
    () => context,
    () => {},
  );
  controller.select(root.id, root);
  controller.updateDraft("reply a");
  return {
    controller,
    navigate: () => {
      context = "workspace:channel-b";
      controller.select("root-b", { ...root, id: "root-b" });
      controller.updateDraft("reply b");
    },
  };
}

test("thread send reports delivery to its original conversation after navigation", async () => {
  let resolve!: (data: unknown) => void;
  const { controller, navigate } = setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const events: ThreadReplyDelivery[] = [];
  const sending = controller.send(undefined, (event) => events.push(event));
  assert.deepEqual(events, [{ type: "sending", nonce: "stable-reply-nonce" }]);
  navigate();
  const message = { ...root, id: "reply-a", parent_message_id: root.id };
  resolve({ message, thread_state: { reply_count: 1 } });
  await sending;
  assert.equal(events[1]?.type, "sent");
  assert.equal(events[1]?.nonce, "stable-reply-nonce");
  assert.equal(controller.root?.id, "root-b");
  assert.equal(controller.draft?.body, "reply b");
  assert.deepEqual(controller.replies, []);
});

test("thread failure reports the original nonce and retry reuses it", async () => {
  const payloads: string[] = [];
  const { controller } = setup(async (_path, options) => {
    payloads.push(options.body);
    throw new Error("rejected");
  });
  const events: ThreadReplyDelivery[] = [];
  await controller.send(undefined, (event) => events.push(event));
  assert.equal(controller.draft?.body, "reply a");
  assert.equal(controller.draft?.sending, false);
  assert.equal(controller.draft?.error, "rejected");
  assert.deepEqual(
    events.map((event) => event.type),
    ["sending", "failed"],
  );
  await controller.send(undefined, (event) => events.push(event));
  assert.equal(payloads[0], payloads[1]);
  assert.ok(events.every((event) => event.nonce === "stable-reply-nonce"));
});
