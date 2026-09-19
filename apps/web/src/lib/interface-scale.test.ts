import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_INTERFACE_SCALE,
  MAX_INTERFACE_SCALE,
  MIN_INTERFACE_SCALE,
  normalizeInterfaceScale,
} from "./interface-scale.ts";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("clamps and snaps stored scales", () => {
  assert.equal(normalizeInterfaceScale("1.25"), 1.25);
  assert.equal(normalizeInterfaceScale(1.23), 1.25);
  assert.equal(normalizeInterfaceScale(9), MAX_INTERFACE_SCALE);
  assert.equal(normalizeInterfaceScale(0.1), MIN_INTERFACE_SCALE);
  assert.equal(normalizeInterfaceScale("nonsense"), DEFAULT_INTERFACE_SCALE);
  assert.equal(normalizeInterfaceScale(null), DEFAULT_INTERFACE_SCALE);
});

test("persists the scale and applies it before paint", () => {
  const preference = readSource("./interface-scale.ts");
  const appTemplate = readSource("../app.html");

  assert.match(preference, /clickclack:interface-scale:v1/u);
  assert.match(preference, /setProperty\("--ui-scale", String\(normalized\)\)/u);
  assert.match(appTemplate, /clickclack:interface-scale:v1/u);
  assert.match(appTemplate, /setProperty\("--ui-scale"/u);
});

test("scales the document and keeps full-height boxes one screen tall", () => {
  const base = readSource("../styles/base.css");
  const layout = readSource("../styles/layout.css");

  assert.match(base, /zoom: var\(--ui-scale\);/u);
  assert.match(base, /--app-vh: calc\(100dvh \/ var\(--ui-scale\)\);/u);
  assert.match(layout, /\.shell \{[\s\S]*?height: var\(--app-vh\);/u);
});

test("leads the toolbars with the scale control and trails desktop with the terminal", () => {
  const topbar = readSource("../components/topbar/Topbar.svelte");
  const titlebar = readSource("../components/topbar/DesktopTitlebar.svelte");

  for (const source of [topbar, titlebar]) {
    assert.match(source, /<InterfaceScaleControl \/>\s*<ThemeToggle \/>\s*<AvatarSizeToggle \/>/u);
  }

  // Desktop order: … pinned, notifications, channel settings, terminal.
  const order = [
    "Pinned items",
    "aria-busy={channelNotifSaving}",
    "Channel settings",
    "Toggle terminal",
  ].map((marker) => titlebar.indexOf(marker));
  assert.ok(order.every((index) => index > 0));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
});

test("collapses the slider until the button opens it", () => {
  const styles = readSource("../styles/layout.css");

  assert.match(styles, /\.ui-scale-panel \{[\s\S]*?max-width: 0;/u);
  assert.match(styles, /\.ui-scale\.open \.ui-scale-panel \{[\s\S]*?max-width: 210px;/u);
  assert.match(styles, /\.ui-scale-panel \{[\s\S]*?transition:[\s\S]*?max-width 260ms/u);
});
