export type LocalFileResult = "success" | "cancelled" | "unavailable" | "denied";

function hasUnsafeCharacters(value: string): boolean {
  return Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "\\",
  );
}

// Root-relative application routes are not filesystem grants. Recover only
// home-directory references; native confirmation still authorizes each target.
export function localFilePath(input: unknown, origin: string): string | null {
  if (
    typeof input !== "string" ||
    input.length > 8192 ||
    input !== input.trim() ||
    hasUnsafeCharacters(input)
  )
    return null;
  let encoded: string;
  try {
    if (input.startsWith("/") && !input.startsWith("//")) {
      encoded = input;
    } else {
      const url = new URL(input);
      if (
        url.origin !== new URL(origin).origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return null;
      // Inspect the original path, before URL dot-segment normalization.
      const match = input.match(/^https?:\/\/[^/]+(\/.*)$/u);
      if (!match) return null;
      encoded = match[1];
    }
    if (/[?#]/u.test(encoded) || /%(?:2f|5c|25)/iu.test(encoded)) return null;
    const decoded = decodeURIComponent(encoded);
    if (hasUnsafeCharacters(decoded)) return null;
    if (!/^\/(?:home|Users)\/[^/]+\/.+/u.test(decoded)) return null;
    if (
      decoded
        .slice(1)
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      return null;
    return decoded;
  } catch {
    return null;
  }
}
