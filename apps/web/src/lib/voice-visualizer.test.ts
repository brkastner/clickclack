import assert from "node:assert/strict";
import test from "node:test";

import { fillSpectrumBars, spectrumBarGeometry, spectrumBarLevel } from "./voice-visualizer.ts";

test("computes responsive bar geometry without overflowing narrow canvases", () => {
  const geometry = spectrumBarGeometry(100, 4, 2);
  assert.equal(geometry.gap, 2);
  assert.equal(geometry.barWidth, 23.5);
  assert.equal(geometry.barWidth * 4 + geometry.gap * 3, 100);

  const narrow = spectrumBarGeometry(4, 4, 2);
  assert.equal(narrow.gap, 0.5);
  assert.equal(narrow.barWidth, 0.625);
  assert.equal(narrow.barWidth * 4 + narrow.gap * 3, 4);
});

test("silence settles at a stable floor while reusing the caller's buffer", () => {
  const frequencyData = new Uint8Array(32);
  const bars = new Float32Array(8);
  const result = fillSpectrumBars(frequencyData, bars);

  assert.equal(result, bars);
  for (const level of bars) assert.ok(Math.abs(level - 0.04) < 0.000_001);

  fillSpectrumBars(frequencyData, bars);
  for (const level of bars) assert.ok(Math.abs(level - 0.04) < 0.000_001);
});

test("full-spectrum energy fills every bar and empty data uses the requested floor", () => {
  const frequencyData = new Uint8Array(32);
  frequencyData.fill(255);
  const bars = new Float32Array(8);
  fillSpectrumBars(frequencyData, bars, 0.06);

  assert.deepEqual(
    [...bars],
    Array.from({ length: 8 }, () => 1),
  );
  assert.equal(spectrumBarLevel(new Uint8Array(), 0, 1, 0.08), 0.08);
});
