import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const status = readFileSync(
  new URL("../components/composer/BotRuntimeStatus.svelte", import.meta.url),
  "utf8",
);
const composer = readFileSync(new URL("../styles/composer.css", import.meta.url), "utf8");

test("model status uses available composer width and truncates the model from the start", () => {
  assert.doesNotMatch(status, /max-width:\s*min\(280px,\s*34vw\)/);
  assert.match(status, /max-width:\s*100%/);
  assert.match(status, /\.bot-runtime-status__value:first-child\s*\{[^}]*direction:\s*rtl/s);
  assert.match(status, /\.bot-runtime-status__value:not\(:first-child\)\s*\{[^}]*flex:\s*none/s);
  assert.match(composer, /\.composer-actions\s*\{[^}]*min-width:\s*0/s);
  assert.match(
    composer,
    /\.composer-actions\s*>\s*\.composer-voice-entry,[\s\S]*?\.composer-actions\s*>\s*\.send\s*\{[^}]*flex-shrink:\s*0/s,
  );
});
