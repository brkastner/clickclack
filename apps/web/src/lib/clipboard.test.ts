import assert from "node:assert/strict";
import test from "node:test";
import { writeClipboardTextWith } from "./clipboard-core.ts";

test("uses the Electron clipboard bridge when available", async () => {
  const calls: string[] = [];

  await writeClipboardTextWith("message body", {
    desktop: async (text) => {
      calls.push(`desktop:${text}`);
      return true;
    },
    browser: async (text) => calls.push(`browser:${text}`),
  });

  assert.deepEqual(calls, ["desktop:message body"]);
});

test("falls back to the browser clipboard outside Electron", async () => {
  const calls: string[] = [];

  await writeClipboardTextWith("message body", {
    browser: async (text) => calls.push(text),
  });

  assert.deepEqual(calls, ["message body"]);
});

test("falls back when the Electron bridge rejects the write", async () => {
  const calls: string[] = [];

  await writeClipboardTextWith("message body", {
    desktop: async () => false,
    browser: async (text) => calls.push(text),
  });

  assert.deepEqual(calls, ["message body"]);
});

test("fails when no clipboard writer is available", async () => {
  await assert.rejects(writeClipboardTextWith("message body", {}), /Clipboard unavailable/);
});
