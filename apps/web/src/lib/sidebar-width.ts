export const SIDEBAR_WIDTH_STORAGE_KEY = "clickclack:sidebar-width:v1";
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 420;
export const DEFAULT_SIDEBAR_WIDTH = 280;
export const SIDEBAR_WIDTH_STEP = 16;

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)));
}

export function parseSidebarWidth(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_SIDEBAR_WIDTH;
  const value = Number(raw);
  return Number.isFinite(value) ? clampSidebarWidth(value) : DEFAULT_SIDEBAR_WIDTH;
}

export function sidebarWidthFromKey(key: string, currentWidth: number): number | null {
  switch (key) {
    case "ArrowLeft":
      return clampSidebarWidth(currentWidth - SIDEBAR_WIDTH_STEP);
    case "ArrowRight":
      return clampSidebarWidth(currentWidth + SIDEBAR_WIDTH_STEP);
    case "Home":
      return MIN_SIDEBAR_WIDTH;
    case "End":
      return MAX_SIDEBAR_WIDTH;
    default:
      return null;
  }
}
