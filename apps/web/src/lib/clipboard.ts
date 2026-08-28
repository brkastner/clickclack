import { writeClipboardTextWith } from "./clipboard-core";
import { desktop } from "./desktop";

export function writeClipboardText(text: string): Promise<void> {
  return writeClipboardTextWith(text, {
    browser: globalThis.navigator?.clipboard?.writeText.bind(globalThis.navigator.clipboard),
    desktop: desktop?.writeClipboardText,
  });
}
