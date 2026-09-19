// Anchored overlay placement under interface scale.
//
// `getBoundingClientRect()` and `window.innerWidth/innerHeight` report physical
// pixels, but an overlay inside the zoomed root reads `top`/`left` in the
// zoomed coordinate space. Writing a rect straight back out applies the scale a
// second time, which is how the channel notepad preview ended up far from the
// channel it belonged to. Divide the measurements down first, then lay out
// entirely in the overlay's own space so the gap scales with the UI.

export type Rect = { top: number; right: number; width: number; height: number };

export type PlacementInput = {
  /** Anchor rect in physical pixels, straight from getBoundingClientRect(). */
  anchor: Rect;
  /** Overlay rect in physical pixels. */
  overlay: Rect;
  /** Viewport size in physical pixels (window.innerWidth/innerHeight). */
  viewport: { width: number; height: number };
  /** Effective root zoom. */
  scale: number;
  /** Gap and viewport inset, in the overlay's own coordinate space. */
  gap?: number;
};

/** Place an overlay beside `anchor`, in the overlay's zoomed coordinate space. */
export function placeBesideAnchor({ anchor, overlay, viewport, scale, gap = 8 }: PlacementInput): {
  left: number;
  top: number;
} {
  const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const viewportWidth = viewport.width / zoom;
  const viewportHeight = viewport.height / zoom;
  const overlayWidth = overlay.width / zoom;
  const overlayHeight = overlay.height / zoom;
  return {
    left: Math.max(gap, Math.min(anchor.right / zoom + gap, viewportWidth - overlayWidth - gap)),
    top: Math.max(gap, Math.min(anchor.top / zoom, viewportHeight - overlayHeight - gap)),
  };
}
