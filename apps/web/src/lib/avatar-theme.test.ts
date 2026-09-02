import assert from "node:assert/strict";
import test from "node:test";

import { avatarURLForColorMode } from "./chat/avatars.ts";

test("uses the light avatar only in light mode", () => {
  assert.equal(
    avatarURLForColorMode("https://example.com/dark.png", "https://example.com/light.png", "light"),
    "https://example.com/light.png",
  );
  assert.equal(
    avatarURLForColorMode("https://example.com/dark.png", "https://example.com/light.png", "dark"),
    "https://example.com/dark.png",
  );
});

test("falls back to the primary avatar when no light avatar exists", () => {
  assert.equal(
    avatarURLForColorMode("https://example.com/default.png", "", "light"),
    "https://example.com/default.png",
  );
});

test("never exposes a light avatar without a primary avatar", () => {
  assert.equal(avatarURLForColorMode("", "https://example.com/light.png", "light"), "");
});
