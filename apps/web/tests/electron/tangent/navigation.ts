export async function goto(path: string) {
  window.dispatchEvent(new CustomEvent("tangent-test-navigation", { detail: path }));
}
export function afterNavigate(_callback: () => void) {
  return () => {};
}
