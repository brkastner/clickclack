const MIDDLE_SCROLL_DEAD_ZONE_PX = 18;
const MIDDLE_SCROLL_MAX_DISTANCE_PX = 220;
const MIDDLE_SCROLL_MIN_SPEED_PX_PER_SEC = 120;
const MIDDLE_SCROLL_MAX_SPEED_PX_PER_SEC = 9_600;

export type PageScrollDirection = -1 | 1;

export function pageScrollDelta(viewportHeight: number, direction: PageScrollDirection): number {
  return direction * Math.max(120, viewportHeight * 0.85);
}

export function middleAutoscrollVelocity(offsetY: number): number {
  const distance = Math.abs(offsetY);
  if (distance <= MIDDLE_SCROLL_DEAD_ZONE_PX) return 0;
  const progress = Math.min(
    1,
    (distance - MIDDLE_SCROLL_DEAD_ZONE_PX) /
      (MIDDLE_SCROLL_MAX_DISTANCE_PX - MIDDLE_SCROLL_DEAD_ZONE_PX),
  );
  const speed =
    MIDDLE_SCROLL_MIN_SPEED_PX_PER_SEC +
    (MIDDLE_SCROLL_MAX_SPEED_PX_PER_SEC - MIDDLE_SCROLL_MIN_SPEED_PX_PER_SEC) * progress ** 1.6;
  return Math.sign(offsetY) * speed;
}
