import assert from "node:assert/strict";
import test from "node:test";

import { placeBesideAnchor, type PlacementInput } from "./anchored-placement.ts";

// A channel row 36px tall sitting partway down a 1280x700 viewport, with a
// preview card beside it. Everything here is physical pixels, as the DOM
// reports them.
const scenario = (scale: number, overlayHeight = 200): PlacementInput => ({
  anchor: { top: 174 * scale, right: 220 * scale, width: 200 * scale, height: 36 * scale },
  overlay: { top: 0, right: 0, width: 432 * scale, height: overlayHeight * scale },
  viewport: { width: 1280, height: 700 },
  scale,
});

test("puts the overlay against its anchor whatever the scale", () => {
  for (const scale of [0.7, 1, 1.2, 1.6]) {
    const placed = placeBesideAnchor(scenario(scale));
    // Both values are in the overlay's own space, so they match the anchor's
    // unscaled position rather than its physical one.
    assert.equal(placed.top, 174, `top at ${scale}x`);
    assert.equal(placed.left, 228, `left at ${scale}x`);
  }
});

test("keeps a tall overlay inside the viewport instead of running off the bottom", () => {
  // 900 unscaled is already taller than the 700px viewport.
  const placed = placeBesideAnchor(scenario(1.2, 900));
  assert.equal(placed.top, 8);

  // The viewport is 700 physical, so at 1.2x it is 583.3 in overlay space; the
  // overlay may not be laid out past that regardless of how tall it is.
  const tall = placeBesideAnchor(scenario(1.2, 400));
  assert.ok(tall.top + 400 <= 700 / 1.2, "overlay bottom stays on screen");
});

test("pins a wide overlay to the right edge rather than off it", () => {
  // 1200 physical is 1000 in overlay space; the viewport is 1066.7 there, so
  // only 58.7 is left once the 8px inset is taken off the far edge.
  const placed = placeBesideAnchor({
    ...scenario(1.2),
    overlay: { top: 0, right: 0, width: 1200, height: 240 },
  });
  const expected = 1280 / 1.2 - 1200 / 1.2 - 8;
  assert.ok(Math.abs(placed.left - expected) < 0.001, `${placed.left} vs ${expected}`);
  assert.ok(placed.left >= 8, "never crosses the near edge");
});

test("falls back to unscaled placement when the scale is nonsense", () => {
  const sane = placeBesideAnchor({ ...scenario(1), scale: 1 });
  for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(placeBesideAnchor({ ...scenario(1), scale }), sane, `scale ${scale}`);
  }
});
