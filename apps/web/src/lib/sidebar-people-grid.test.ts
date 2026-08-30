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

test("spaces the two-by-two avatar grid evenly from itself and its edges", () => {
  const shelfStyles = sidebarStyles.match(/\.sidebar-people-row\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
  assert.match(shelfStyles, /display:\s*grid/u);
  assert.match(shelfStyles, /grid-template-columns:\s*repeat\(2, 50px\)/u);
  assert.match(shelfStyles, /grid-template-rows:\s*repeat\(2, 50px\)/u);
  assert.match(shelfStyles, /place-content:\s*space-evenly/u);
  assert.match(shelfStyles, /min-height:\s*160px/u);
});
