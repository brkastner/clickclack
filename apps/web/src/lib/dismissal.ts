/**
 * The stack of dismissible layers, for platforms with a global "back" gesture.
 *
 * Android's back button has to close whatever is visually on top, but no single
 * component knows what that is: panes and modals belong to ChatApp, while a
 * message's action sheet belongs to the row or thread reply that opened it.
 * Each owner registers while its layer is open and the stack is walked
 * innermost-first, so back closes the sheet over a thread over the drawer in the
 * order a person sees them — the same order Escape unwinds.
 */

/** Close this layer. Returns false when it turns out there was nothing to close. */
export type DismissLayer = () => boolean;

const layers: DismissLayer[] = [];

/**
 * Register a layer as open. Later registrations are treated as being on top, so
 * register when a layer opens rather than when its component mounts.
 */
export function registerDismissLayer(dismiss: DismissLayer): () => void {
  layers.push(dismiss);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = layers.lastIndexOf(dismiss);
    if (index !== -1) layers.splice(index, 1);
  };
}

/**
 * Close the topmost layer that has something to close, reporting whether one
 * did. A layer that declines is passed over rather than swallowing the gesture.
 */
export function dismissTopLayer(): boolean {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    if (layers[index]?.()) return true;
  }
  return false;
}

/** Test seam: the registered layer count. */
export function dismissLayerCount(): number {
  return layers.length;
}
