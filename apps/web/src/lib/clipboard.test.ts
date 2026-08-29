import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { writeClipboardTextWith } from "./clipboard-core.ts";

const composer = readFileSync(
  new URL("../components/composer/ChatComposer.svelte", import.meta.url),
  "utf8",
);
const desktopMain = readFileSync(new URL("../../../desktop/src/main.ts", import.meta.url), "utf8");
const desktopPreload = readFileSync(
  new URL("../../../desktop/src/app-preload.ts", import.meta.url),
  "utf8",
);

test("routes trusted desktop paste gestures through Electron's native clipboard", () => {
  assert.match(desktopPreload, /event\.isTrusted/u);
  assert.match(desktopPreload, /"copy"/u);
  assert.match(desktopPreload, /selectedText\(event\.target\)/u);
  assert.match(desktopPreload, /desktop:write-clipboard-text/u);
  assert.match(desktopPreload, /desktop:read-clipboard/u);
  assert.match(desktopPreload, /desktop:paste-native/u);
  assert.match(desktopMain, /if \(!isMainSender\(event\)\) return null;/u);
  assert.match(desktopMain, /clipboard\.readText\(\)/u);
  assert.match(desktopMain, /clipboard\.readImage\(\)\.isEmpty\(\)/u);
  assert.match(composer, /desktop\?\.onPasteText/u);
  assert.match(composer, /insertPastedText\(text, true\)/u);
});

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
