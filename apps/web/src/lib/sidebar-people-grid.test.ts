import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebar = readFileSync(
  new URL("../components/navigation/Sidebar.svelte", import.meta.url),
  "utf8",
);
const sidebarStyles = readFileSync(new URL("../styles/sidebar.css", import.meta.url), "utf8");
const channelList = readFileSync(
  new URL("../components/navigation/ChannelList.svelte", import.meta.url),
  "utf8",
);

test("keeps the profile shelf to one curated two-by-three page", () => {
  assert.match(sidebar, /collectSidebarPeopleShelf\(\s*recentPeople,\s*profileShortcuts/u);
  assert.match(sidebar, /personName:\s*"клешня"/u);
  assert.match(sidebar, /profileName:\s*"лиза"/u);
  assert.match(sidebar, /personName:\s*"пи"[\s\S]*?profileName:\s*"пи"/u);
  // The shelf is read left to right, top row first.
  assert.match(
    sidebar,
    /PEOPLE_SHELF_ORDER = \["кай", "лиза", "рекрутер", "нудз", "училка", "пи"\]/u,
  );
});

test("backs the curated shelf with stable profile people", () => {
  assert.match(
    sidebar,
    /collectSidebarPeopleShelf\([\s\S]*?PEOPLE_SHELF_ORDER,\s*6,\s*profilePeople,/u,
  );
});

test("fills the two-by-three shelf with labeled avatars and compact spacing", () => {
  const shelfStyles = sidebarStyles.match(/\.sidebar-people-row\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
  const personStyles = sidebarStyles.match(/\.sidebar-person\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
  const avatarStyles =
    sidebarStyles.match(/\.sidebar-person > \.avatar\s*\{([\s\S]*?)\}/u)?.[1] ?? "";

  const labelStyles =
    sidebarStyles.match(/\.sidebar-person-name\s*\{([\s\S]*?)\}/u)?.[1] ?? "";

  assert.match(shelfStyles, /grid-template-columns:\s*repeat\(2, 92px\)/u);
  assert.match(shelfStyles, /grid-template-rows:\s*repeat\(3, 112px\)/u);
  assert.match(shelfStyles, /min-height:\s*360px/u);
  assert.match(shelfStyles, /align-content:\s*space-evenly/u);
  assert.match(shelfStyles, /justify-content:\s*space-around/u);
  assert.match(shelfStyles, /margin:\s*0 0 8px/u);
  assert.match(personStyles, /width:\s*92px/u);
  assert.match(personStyles, /height:\s*112px/u);
  assert.match(personStyles, /grid-template-rows:\s*90px 16px/u);
  assert.match(avatarStyles, /width:\s*90px/u);
  assert.match(avatarStyles, /height:\s*90px/u);
  assert.match(labelStyles, /text-overflow:\s*ellipsis/u);
  assert.match(labelStyles, /text-align:\s*center/u);
});

test("labels shelf tiles with their presented names", () => {
  assert.match(
    sidebar,
    /name=\{entry\.profile\.display_name\}[\s\S]*?<span class="sidebar-person-name">\{entry\.profile\.display_name\}<\/span>/u,
  );
  assert.match(
    sidebar,
    /name=\{person\.display_name\}[\s\S]*?<span class="sidebar-person-name">\{person\.display_name\}<\/span>/u,
  );
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

test("right-aligns profile working and unread indicators", () => {
  assert.match(
    channelList,
    /class="channel-subgroup-status"[\s\S]*?class="sidebar-working-indicator"[\s\S]*?class="unread-badge"/u,
  );

  const statusStyles =
    sidebarStyles.match(/\.channel-subgroup-status\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
  assert.match(statusStyles, /margin-left:\s*auto/u);
  assert.match(statusStyles, /display:\s*inline-flex/u);
});
