import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("places the avatar size toggle beside the theme toggle", () => {
  for (const component of [
    "../components/topbar/Topbar.svelte",
    "../components/topbar/DesktopTitlebar.svelte",
  ]) {
    const source = readSource(component);
    assert.match(source, /import AvatarSizeToggle from "\.\/AvatarSizeToggle\.svelte"/u);
    assert.match(source, /<ThemeToggle \/>\s*<AvatarSizeToggle \/>/u);
  }
});

test("persists double avatars and applies them before paint", () => {
  const preference = readSource("./avatar-size.ts");
  const appTemplate = readSource("../app.html");

  assert.match(preference, /clickclack:avatar-size:v1/u);
  assert.match(preference, /setAttribute\("data-avatar-size", size\)/u);
  assert.match(appTemplate, /data-avatar-size/u);
});

test("double mode doubles timeline avatar dimensions", () => {
  const styles = readSource("../styles/messages.css");
  const desktopRule =
    styles.match(
      /:root\[data-avatar-size="double"\] \.message-group > \.avatar\s*\{([\s\S]*?)\}/u,
    )?.[1] ?? "";
  const avatarRules = [
    ...styles.matchAll(
      /:root\[data-avatar-size="double"\] \.message-group > \.avatar\s*\{([\s\S]*?)\}/gu,
    ),
  ];
  const mobileRule = avatarRules.find((rule) => /width:\s*92px/u.test(rule[1] ?? ""))?.[1] ?? "";

  assert.match(desktopRule, /width:\s*156px/u);
  assert.match(desktopRule, /height:\s*156px/u);
  assert.match(mobileRule, /width:\s*92px/u);
  assert.match(mobileRule, /height:\s*92px/u);
});
