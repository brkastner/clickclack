export const SIDEBAR_WIDTH_STORAGE_KEY = "clickclack:sidebar-width:v1";
export const MIN_SIDEBAR_WIDTH = 222;
export const LARGE_AVATAR_MIN_SIDEBAR_WIDTH = 312;
export const LARGE_AVATAR_SIDEBAR_WIDTH_DELTA = 90;
export const MAX_SIDEBAR_WIDTH = 420;
export const DEFAULT_SIDEBAR_WIDTH = 280;
export const SIDEBAR_WIDTH_STEP = 16;

export function clampSidebarWidth(value: number, minWidth = MIN_SIDEBAR_WIDTH): number {
  if (!Number.isFinite(value)) return Math.max(DEFAULT_SIDEBAR_WIDTH, minWidth);
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(minWidth, Math.round(value)));
}

export function parseSidebarWidth(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_SIDEBAR_WIDTH;
  const value = Number(raw);
  return Number.isFinite(value) ? clampSidebarWidth(value) : DEFAULT_SIDEBAR_WIDTH;
}

export function renderedSidebarWidth(baseWidth: number, enlargedAvatars: boolean): number {
  if (!enlargedAvatars) return clampSidebarWidth(baseWidth);
  return clampSidebarWidth(
    baseWidth + LARGE_AVATAR_SIDEBAR_WIDTH_DELTA,
    LARGE_AVATAR_MIN_SIDEBAR_WIDTH,
  );
}

export function baseSidebarWidth(renderedWidth: number, enlargedAvatars: boolean): number {
  return clampSidebarWidth(
    renderedWidth - (enlargedAvatars ? LARGE_AVATAR_SIDEBAR_WIDTH_DELTA : 0),
  );
}

export function sidebarWidthFromKey(
  key: string,
  currentWidth: number,
  minWidth = MIN_SIDEBAR_WIDTH,
): number | null {
  switch (key) {
    case "ArrowLeft":
      return clampSidebarWidth(currentWidth - SIDEBAR_WIDTH_STEP, minWidth);
    case "ArrowRight":
      return clampSidebarWidth(currentWidth + SIDEBAR_WIDTH_STEP, minWidth);
    case "Home":
      return minWidth;
    case "End":
      return MAX_SIDEBAR_WIDTH;
    default:
      return null;
  }
}
