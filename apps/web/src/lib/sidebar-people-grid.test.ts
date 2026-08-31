import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebar = readFileSync(
  new URL("../components/navigation/Sidebar.svelte", import.meta.url),
  "utf8",
);
const sidebarStyles = readFileSync(new URL("../styles/sidebar.css", import.meta.url), "utf8");

test("keeps the recent-people shelf to one two-by-two page", () => {
  assert.match(sidebar, /displayedRecentPeople[\s\S]*?\.slice\(0, 4\)/u);
});

test("fills the two-by-two shelf with larger avatars and compact spacing", () => {
  const shelfStyles = sidebarStyles.match(/\.sidebar-people-row\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
  const personStyles = sidebarStyles.match(/\.sidebar-person\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
  const avatarStyles =
    sidebarStyles.match(/\.sidebar-person > \.avatar\s*\{([\s\S]*?)\}/u)?.[1] ?? "";

  assert.match(shelfStyles, /grid-template-columns:\s*repeat\(2, 92px\)/u);
  assert.match(shelfStyles, /grid-template-rows:\s*repeat\(2, 92px\)/u);
  assert.match(shelfStyles, /min-height:\s*214px/u);
  assert.match(shelfStyles, /margin:\s*0 0 8px/u);
  assert.match(personStyles, /width:\s*92px/u);
  assert.match(personStyles, /height:\s*92px/u);
  assert.match(avatarStyles, /width:\s*90px/u);
  assert.match(avatarStyles, /height:\s*90px/u);
});

test("sizes profile, channel, and direct-message navigation up", () => {
  const profileToggleStyles =
    sidebarStyles.match(
      /\.sidebar-profile-groups \.channel-subgroup-toggle\s*\{([\s\S]*?)\}/u,
    )?.[1] ?? "";
  const profileAvatarStyles =
    [...sidebarStyles.matchAll(/\.channel-profile-avatar\s*\{([\s\S]*?)\}/gu)].find((rule) =>
      /width:\s*26px/u.test(rule[1] ?? ""),
    )?.[1] ?? "";
  const navItemStyles = sidebarStyles.match(/(?:^|\n)\.nav-item\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
  const navLabelStyles = sidebarStyles.match(/(?:^|\n)\.nav-label\s*\{([\s\S]*?)\}/u)?.[1] ?? "";

  assert.match(profileToggleStyles, /min-height:\s*36px/u);
  assert.match(profileToggleStyles, /font-size:\s*14px/u);
  assert.match(profileAvatarStyles, /width:\s*26px/u);
  assert.match(profileAvatarStyles, /height:\s*26px/u);
  assert.match(navItemStyles, /min-height:\s*38px/u);
  assert.match(navItemStyles, /padding:\s*6px 8px/u);
  assert.match(navLabelStyles, /font-size:\s*15px/u);
});
