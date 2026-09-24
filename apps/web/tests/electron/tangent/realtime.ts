export class WorkspaceUnavailableError extends Error {}
export function connectRealtime(options: {
  onEvent: (event: unknown, isCurrent: () => boolean) => void;
}) {
  let active = true;
  const receive = (event: Event) => options.onEvent((event as CustomEvent).detail, () => active);
  window.addEventListener("tangent-test-event", receive);
  return {
    close() {
      active = false;
      window.removeEventListener("tangent-test-event", receive);
    },
  };
}
