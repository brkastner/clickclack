export type ClipboardWriters = {
  browser?: (text: string) => Promise<void>;
  desktop?: (text: string) => Promise<boolean>;
};

export async function writeClipboardTextWith(
  text: string,
  writers: ClipboardWriters,
): Promise<void> {
  if (writers.desktop && (await writers.desktop(text))) return;
  if (!writers.browser) throw new Error("Clipboard unavailable");
  await writers.browser(text);
}
