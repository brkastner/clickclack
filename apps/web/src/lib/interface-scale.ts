// Interface scale: a single multiplier applied to the whole document through
// CSS `zoom` on :root. The app's type ramp is px-based, so a root font-size
// tweak would not move most of the UI; zoom scales every layout box uniformly.
//
// The preference is device-local (like avatar size), not account-roaming: the
// right scale depends on the screen you are sitting in front of. The inline
// app.html script reads the same storage key before hydration so the chosen
// scale never flashes; keep the two in sync.

import { writable } from "svelte/store";

export const INTERFACE_SCALE_STORAGE_KEY = "clickclack:interface-scale:v1";
export const DEFAULT_INTERFACE_SCALE = 1;
export const MIN_INTERFACE_SCALE = 0.7;
export const MAX_INTERFACE_SCALE = 1.6;
export const INTERFACE_SCALE_STEP = 0.05;

/** Snap to the slider's step and clamp, so stored junk can never wedge the UI. */
export function normalizeInterfaceScale(value: unknown): number {
  if (value === null || value === undefined || value === "") return DEFAULT_INTERFACE_SCALE;
  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERFACE_SCALE;
  const stepped = Math.round(parsed / INTERFACE_SCALE_STEP) * INTERFACE_SCALE_STEP;
  const clamped = Math.min(MAX_INTERFACE_SCALE, Math.max(MIN_INTERFACE_SCALE, stepped));
  return Math.round(clamped * 100) / 100;
}

function initialInterfaceScale(): number {
  if (typeof document === "undefined") return DEFAULT_INTERFACE_SCALE;
  const applied = document.documentElement.style.getPropertyValue("--ui-scale");
  if (applied) return normalizeInterfaceScale(applied);
  return loadInterfaceScale();
}

export function loadInterfaceScale(): number {
  try {
    const stored = window.localStorage.getItem(INTERFACE_SCALE_STORAGE_KEY);
    if (stored === null) return DEFAULT_INTERFACE_SCALE;
    return normalizeInterfaceScale(stored);
  } catch {
    return DEFAULT_INTERFACE_SCALE;
  }
}

export function applyInterfaceScale(scale: number) {
  const normalized = normalizeInterfaceScale(scale);
  try {
    if (normalized === DEFAULT_INTERFACE_SCALE) {
      document.documentElement.style.removeProperty("--ui-scale");
    } else {
      document.documentElement.style.setProperty("--ui-scale", String(normalized));
    }
  } catch {
    // Non-DOM context (SSR/tests); the stored pref still applies on mount.
  }
}

export const interfaceScale = writable<number>(initialInterfaceScale());

export function setInterfaceScale(scale: number) {
  const normalized = normalizeInterfaceScale(scale);
  interfaceScale.set(normalized);
  applyInterfaceScale(normalized);
  try {
    if (normalized === DEFAULT_INTERFACE_SCALE) {
      window.localStorage.removeItem(INTERFACE_SCALE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(INTERFACE_SCALE_STORAGE_KEY, String(normalized));
    }
  } catch {
    // Storage can be blocked; the in-memory scale still applies this session.
  }
}

/** Mount-time belt to the app.html suspenders, and the recovery path when the
    boot script could not run. */
export function initInterfaceScale() {
  const stored = loadInterfaceScale();
  interfaceScale.set(stored);
  applyInterfaceScale(stored);
}
