import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("desktop titlebar exposes the active workflow run control", () => {
  const titlebar = readSource("../components/topbar/DesktopTitlebar.svelte");

  assert.match(titlebar, /runAvailable\?: boolean/u);
  assert.match(titlebar, /runOpen\?: boolean/u);
  assert.match(titlebar, /runWaiting\?: boolean/u);
  assert.match(titlebar, /onToggleRun: \(\) => void/u);
  assert.match(
    titlebar,
    /\{#if runAvailable\}[\s\S]*aria-label=\{runOpen \? "Close workflow run" : "Workflow run"\}[\s\S]*onToggleRun/u,
  );
});

test("chat app wires workflow run state into the desktop titlebar", () => {
  const chatApp = readSource("../ChatApp.svelte");
  const titlebar = chatApp.match(/<DesktopTitlebar[\s\S]*?\/>/u)?.[0] ?? "";

  assert.match(titlebar, /runAvailable=\{runPanelAvailable\}/u);
  assert.match(titlebar, /runOpen=\{runPanelOpen\}/u);
  assert.match(titlebar, /\{runWaiting\}/u);
  assert.match(titlebar, /onToggleRun=\{toggleRunPanel\}/u);
});
