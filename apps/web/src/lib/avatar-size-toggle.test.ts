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

test("message alignment restores the user's saved preference", () => {
  const app = readSource("../ChatApp.svelte");

  assert.match(
    app,
    /userAlign = window\.localStorage\.getItem\(USER_ALIGN_STORAGE_KEY\) === "right" \? "right" : "left"/u,
  );
  assert.doesNotMatch(app, /localStorage\.setItem\(USER_ALIGN_STORAGE_KEY, "right"\)/u);
});

test("double mode scales sidebar shelf and DM avatars to 150 percent", () => {
  const styles = readSource("../styles/sidebar.css");

  assert.match(
    styles,
    /:root\[data-avatar-size="double"\] \.sidebar-person > \.avatar\s*\{[\s\S]*?width:\s*135px;[\s\S]*?height:\s*135px;/u,
  );
  assert.match(
    styles,
    /:root\[data-avatar-size="double"\] \.dm-avatar\s*\{[\s\S]*?width:\s*39px;[\s\S]*?height:\s*39px;/u,
  );
  assert.match(
    styles,
    /:root\[data-avatar-size="double"\] \.sidebar-profile-groups \.channel-profile-avatar\s*\{[\s\S]*?width:\s*39px;[\s\S]*?height:\s*39px;/u,
  );
  assert.match(
    styles,
    /:root\[data-avatar-size="double"\] \.user-card \.dm-avatar\s*\{[\s\S]*?width:\s*48px;[\s\S]*?height:\s*48px;/u,
  );
});

test("double mode scales avatar-linked names with their avatars", () => {
  const sidebarStyles = readSource("../styles/sidebar.css");
  const messageStyles = readSource("../styles/messages.css");

  assert.match(sidebarStyles, /\.sidebar-person-name\s*\{[\s\S]*?font-size:\s*14px;/u);
  assert.match(
    sidebarStyles,
    /:root\[data-avatar-size="double"\] \.sidebar-person-name\s*\{[\s\S]*?font-size:\s*21px;/u,
  );
  assert.match(
    sidebarStyles,
    /:root\[data-avatar-size="double"\] \.sidebar-profile-groups \.channel-subgroup-toggle\s*\{[\s\S]*?font-size:\s*21px;/u,
  );
  assert.match(
    sidebarStyles,
    /:root\[data-avatar-size="double"\] \.nav-item\.dm \.nav-label\s*\{[\s\S]*?font-size:\s*22\.5px;/u,
  );
  assert.match(
    messageStyles,
    /:root\[data-avatar-size="double"\] \.message-group \.author-name\s*\{[\s\S]*?font-size:\s*31px;/u,
  );
});

test("sidebar grid cards surface unread direct messages on the avatar", () => {
  const sidebar = readSource("../components/navigation/Sidebar.svelte");
  const styles = readSource("../styles/sidebar.css");

  assert.match(
    sidebar,
    /class:has-unread=\{unread > 0 && conversation\?\.id !== selectedDirectID\}/u,
  );
  assert.match(sidebar, /class="sidebar-person-unread"/u);
  assert.match(
    styles,
    /\.sidebar-person\.has-unread > \.avatar\s*\{[\s\S]*?border:\s*2px solid var\(--rp-love\);[\s\S]*?box-shadow:/u,
  );
  assert.match(
    styles,
    /\.sidebar-person\.has-unread \.sidebar-person-name\s*\{[\s\S]*?color:\s*var\(--text-strong\);[\s\S]*?font-weight:\s*700;/u,
  );
});
