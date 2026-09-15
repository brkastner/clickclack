#!/usr/bin/env node
/**
 * Render the Android launcher icon and splash art from one source mark.
 *
 * The generated Android project is disposable — `apps/mobile/.gitignore` drops
 * it, and `cap add android` rewrites the stock Capacitor art every time it runs.
 * So the branded PNGs are rendered once into `native/android/res`, tracked
 * there, and copied over the template by scripts/configure-native.mjs. That
 * keeps `pnpm sync` free of an ImageMagick dependency: only regenerating the
 * art needs the tool, and only when the source mark changes.
 *
 * Usage: node scripts/generate-android-brand.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND_BACKGROUND } from "../src/contract.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "assets/brand/kasmos-k.png");
const RES = path.join(ROOT, "native/android/res");

/**
 * Adaptive icons are drawn on a 108dp canvas of which only the central 66dp is
 * guaranteed visible: the launcher masks the rest and may parallax what is
 * left. 0.58 keeps the mark inside that circle with room for the shift.
 */
const FOREGROUND_SAFE_FRACTION = 0.58;

/** Legacy icons are masked by the launcher far less, so the mark can be larger. */
const LEGACY_MARK_FRACTION = 0.68;

/** Splash art is a small mark on a large field; more than this reads as a banner. */
const SPLASH_MARK_FRACTION = 0.28;

/**
 * The source mark carries a fine grain that costs roughly three times the bytes
 * to store losslessly and is invisible once quantized: RMSE against the
 * lossless render is 0.13% for splash art and 0.52% for an icon foreground,
 * with no visible banding on the gradient and no chewing of the alpha edge.
 * These are tracked binaries, so the bytes are worth reclaiming.
 */
const QUANTIZE = ["-colors", "256"];

/** Foreground layers are 108dp; the launcher icon itself is 48dp. */
const DENSITIES = {
  mdpi: { foreground: 108, legacy: 48 },
  hdpi: { foreground: 162, legacy: 72 },
  xhdpi: { foreground: 216, legacy: 96 },
  xxhdpi: { foreground: 324, legacy: 144 },
  xxxhdpi: { foreground: 432, legacy: 192 },
};

/** Sizes Capacitor's Android template ships, matched exactly so nothing stretches. */
const SPLASHES = [
  ["drawable", 480, 320],
  ["drawable-port-mdpi", 320, 480],
  ["drawable-port-hdpi", 480, 800],
  ["drawable-port-xhdpi", 720, 1280],
  ["drawable-port-xxhdpi", 960, 1600],
  ["drawable-port-xxxhdpi", 1280, 1920],
  ["drawable-land-mdpi", 480, 320],
  ["drawable-land-hdpi", 800, 480],
  ["drawable-land-xhdpi", 1280, 720],
  ["drawable-land-xxhdpi", 1600, 960],
  ["drawable-land-xxxhdpi", 1920, 1280],
];

function magick(args) {
  execFileSync("magick", args, { stdio: ["ignore", "ignore", "inherit"] });
}

function write(file, args) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  magick(args);
  console.log(`  ${path.relative(ROOT, file)}`);
}

/**
 * The mark is trimmed before scaling. The source art carries transparent
 * margin, and scaling the padded square would leave the mark visibly smaller
 * than the safe-zone fraction asks for. The parentheses matter: ImageMagick
 * applies a bare operator to every image in the sequence, so an unguarded
 * `-trim` would also try to trim the canvas it is being composited onto.
 */
function markOn(canvas, fraction) {
  const box = Math.round(canvas * fraction);
  return ["(", SOURCE, "-trim", "+repage", "-resize", `${box}x${box}`, ")"];
}

/** A transparent square holding only the mark: the adaptive icon's top layer. */
function foreground(size, file) {
  write(file, [
    "-size",
    `${size}x${size}`,
    "canvas:none",
    ...markOn(size, FOREGROUND_SAFE_FRACTION),
    "-gravity",
    "center",
    "-composite",
    ...QUANTIZE,
    "-strip",
    "-define",
    "png:compression-level=9",
    file,
  ]);
}

/**
 * Pre-adaptive launchers draw this PNG unmasked, so it carries its own shape:
 * a rounded square, or a circle for the round variant.
 */
function legacy(size, file, { round }) {
  const radius = round ? size / 2 : Math.round(size * 0.22);
  const shape = round
    ? `circle ${size / 2},${size / 2} ${size / 2},0`
    : `roundrectangle 0,0 ${size - 1},${size - 1} ${radius},${radius}`;
  write(file, [
    "-size",
    `${size}x${size}`,
    "canvas:none",
    "-fill",
    BRAND_BACKGROUND,
    "-draw",
    shape,
    ...markOn(size, LEGACY_MARK_FRACTION),
    "-gravity",
    "center",
    "-composite",
    ...QUANTIZE,
    "-strip",
    "-define",
    "png:compression-level=9",
    file,
  ]);
}

/** Splash art is a smooth gradient mark centered on a flat field. */
function splash(width, height, file) {
  write(file, [
    "-size",
    `${width}x${height}`,
    `canvas:${BRAND_BACKGROUND}`,
    ...markOn(Math.min(width, height), SPLASH_MARK_FRACTION),
    "-gravity",
    "center",
    "-composite",
    ...QUANTIZE,
    "-strip",
    "-define",
    "png:compression-level=9",
    file,
  ]);
}

/** The adaptive icon's bottom layer is a flat color, declared as a resource. */
function backgroundColor(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<resources>",
    `    <color name="ic_launcher_background">${BRAND_BACKGROUND}</color>`,
    "</resources>",
    "",
  ].join("\n");
  fs.writeFileSync(file, xml);
  console.log(`  ${path.relative(ROOT, file)}`);
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`source mark not found: ${path.relative(ROOT, SOURCE)}`);
  }
  try {
    execFileSync("magick", ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error("ImageMagick (`magick`) is required to regenerate the Android brand art");
  }

  console.log("launcher icons");
  for (const [density, { foreground: fg, legacy: lg }] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `mipmap-${density}`);
    foreground(fg, path.join(dir, "ic_launcher_foreground.png"));
    legacy(lg, path.join(dir, "ic_launcher.png"), { round: false });
    legacy(lg, path.join(dir, "ic_launcher_round.png"), { round: true });
  }

  console.log("adaptive icon background");
  backgroundColor(path.join(RES, "values/ic_launcher_background.xml"));

  console.log("splash art");
  for (const [dir, width, height] of SPLASHES) {
    splash(width, height, path.join(RES, dir, "splash.png"));
  }

  console.log("Done. Run `pnpm --filter @clickclack/mobile sync` to install it.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
