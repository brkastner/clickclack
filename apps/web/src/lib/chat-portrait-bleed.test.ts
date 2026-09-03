import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("selects a portrait for direct chats and single-persona channels", () => {
  const app = readSource("../ChatApp.svelte");

  assert.match(
    app,
    /activePortraitUser = selectedDirect\s*\? dmAvatarUser\(selectedDirect, user\?\.id\)/u,
  );
  assert.match(app, /selectedChannel\?\.bot_assignments\?\.length === 1/u);
  assert.match(
    app,
    /activePortraitSource = activePortraitUser\?\.avatar_url \|\| activePortraitUser\?\.avatar_url_light/u,
  );
  assert.match(app, /\{#if activePortraitUser && activePortraitSource\}/u);
  assert.match(app, /class="chat-portrait-bleed"/u);
  assert.match(app, /loading="eager"/u);
  assert.match(app, /fetchPriority="high"/u);
});

test("fades the portrait from the top-right without blocking chat interaction", () => {
  const styles = readSource("../styles/layout.css");

  assert.match(
    styles,
    /\.timeline\s*\{[\s\S]*?position:\s*relative;[\s\S]*?isolation:\s*isolate;/u,
  );
  assert.match(
    styles,
    /\.chat-portrait-bleed\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*-20px;[\s\S]*?right:\s*-30px;/u,
  );
  assert.match(styles, /\.chat-portrait-bleed\s*\{[\s\S]*?pointer-events:\s*none;/u);
  assert.match(styles, /mask-image:\s*linear-gradient/u);
  assert.match(styles, /mask-composite:\s*intersect/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation:\s*none;/u);
});

test("drifts only the image with a slow compositor transform", () => {
  const styles = readSource("../styles/layout.css");
  const imageRule = styles.match(/\.chat-portrait-bleed > img\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
  const driftFrames = styles.match(/@keyframes chat-portrait-drift\s*\{([\s\S]*?)\n\}/u)?.[1] ?? "";

  assert.match(imageRule, /will-change:\s*transform;/u);
  assert.match(imageRule, /animation:\s*chat-portrait-drift 42s/u);
  assert.match(driftFrames, /translate3d/u);
  assert.match(driftFrames, /scale\(/u);
  assert.doesNotMatch(driftFrames, /mask|filter|object-position/u);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.chat-portrait-bleed > img[\s\S]*?animation:\s*none;/u,
  );
});
