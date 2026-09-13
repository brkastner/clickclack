export async function goto(path: string) {
  window.dispatchEvent(new CustomEvent("gallery-test-navigation", { detail: path }));
}
