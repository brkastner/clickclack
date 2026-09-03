import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SIDEBAR_WIDTH,
  LARGE_AVATAR_MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  baseSidebarWidth,
  renderedSidebarWidth,
  sidebarWidthFromKey,
  parseSidebarWidth,
} from "./sidebar-width.ts";

test("parses persisted sidebar widths within the supported range", () => {
  assert.equal(MIN_SIDEBAR_WIDTH, 222);
  assert.equal(parseSidebarWidth(null), DEFAULT_SIDEBAR_WIDTH);
  assert.equal(parseSidebarWidth("not-a-number"), DEFAULT_SIDEBAR_WIDTH);
  assert.equal(parseSidebarWidth("120"), MIN_SIDEBAR_WIDTH);
  assert.equal(parseSidebarWidth("900"), MAX_SIDEBAR_WIDTH);
  assert.equal(parseSidebarWidth("336"), 336);
});

test("grows the sidebar with enlarged avatars while preserving its base width", () => {
  assert.equal(LARGE_AVATAR_MIN_SIDEBAR_WIDTH, 312);
  assert.equal(renderedSidebarWidth(222, true), 312);
  assert.equal(renderedSidebarWidth(280, true), 370);
  assert.equal(renderedSidebarWidth(280, false), 280);
  assert.equal(baseSidebarWidth(370, true), 280);
  assert.equal(baseSidebarWidth(280, false), 280);
});

test("supports keyboard sidebar resizing", () => {
  assert.equal(sidebarWidthFromKey("ArrowLeft", 300), 284);
  assert.equal(sidebarWidthFromKey("ArrowRight", 300), 316);
  assert.equal(sidebarWidthFromKey("Home", 300), MIN_SIDEBAR_WIDTH);
  assert.equal(sidebarWidthFromKey("End", 300), MAX_SIDEBAR_WIDTH);
  assert.equal(sidebarWidthFromKey("Enter", 300), null);
  assert.equal(sidebarWidthFromKey("ArrowLeft", MIN_SIDEBAR_WIDTH), MIN_SIDEBAR_WIDTH);
  assert.equal(
    sidebarWidthFromKey("Home", 340, LARGE_AVATAR_MIN_SIDEBAR_WIDTH),
    LARGE_AVATAR_MIN_SIDEBAR_WIDTH,
  );
});
