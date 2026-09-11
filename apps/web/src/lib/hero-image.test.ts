import assert from "node:assert/strict";
import test from "node:test";
import { heroImageGeometry } from "./hero-image.ts";

const base = {
  viewportWidth: 320,
  viewportHeight: 68,
  naturalWidth: 400,
  naturalHeight: 800,
  positionX: 0.5,
  positionY: 0.2,
  originX: 0.5,
  originY: 0.5,
  offsetX: 0,
  scale: 1,
};

test("zoom out reveals source outside the former object-fit crop", () => {
  const visibleHeight = (scale: number) => {
    const box = heroImageGeometry({ ...base, scale })!;
    return Math.min(box.height + box.top, 68) - Math.max(box.top, 0);
  };
  const sourceHeight = (scale: number) => visibleHeight(scale) / (0.8 * scale);
  assert.ok(sourceHeight(0.5) > sourceHeight(1));
  assert.ok(sourceHeight(0.25) > sourceHeight(0.5));
  assert.equal(heroImageGeometry({ ...base, scale: 0.5 })!.height, 320);
});

test("aspect ratio and viewport-relative crop, pan and origin survive every zoom", () => {
  for (const [naturalWidth, naturalHeight] of [
    [400, 800],
    [800, 400],
    [400, 400],
  ]) {
    for (const viewportHeight of [46, 68]) {
      for (const viewportWidth of [240, 320, 440]) {
        for (const scale of [0.25, 0.5, 1, 1.18, 2.5]) {
          for (const positionY of [0, 0.2, 1]) {
            for (const offsetX of [-150, 0, 150]) {
              const input = {
                ...base,
                naturalWidth,
                naturalHeight,
                viewportWidth,
                viewportHeight,
                scale,
                positionY,
                offsetX,
              };
              const box = heroImageGeometry(input)!;
              const cover = Math.max(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
              assert.ok(Math.abs(box.width / box.height - naturalWidth / naturalHeight) < 1e-10);
              assert.equal(
                box.left,
                (viewportWidth - naturalWidth * cover) * 0.5 * scale +
                  viewportWidth * 0.5 * (1 - scale) +
                  (viewportWidth * offsetX) / 100,
              );
              assert.equal(
                box.top,
                (viewportHeight - naturalHeight * cover) * positionY * scale +
                  viewportHeight * 0.5 * (1 - scale),
              );
            }
          }
        }
      }
    }
  }
});

test("fully visible sources leave uncovered space instead of stretching", () => {
  const box = heroImageGeometry({
    ...base,
    viewportHeight: 320,
    naturalHeight: 400,
    positionY: 0.5,
    scale: 0.25,
  })!;
  assert.deepEqual(box, { width: 80, height: 80, left: 120, top: 120 });
});

test("unloaded or hidden images have no geometry", () => {
  for (const key of ["viewportWidth", "viewportHeight", "naturalWidth", "naturalHeight", "scale"]) {
    for (const value of [0, -1, NaN, Infinity])
      assert.equal(heroImageGeometry({ ...base, [key]: value }), null);
  }
});
