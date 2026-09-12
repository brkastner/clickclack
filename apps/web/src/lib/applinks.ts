/**
 * ClickClack deep links.
 *
 * The desktop client registers `clickclack://` and the mobile shell registers
 * the same scheme, so one link opens the conversation on whichever ClickClack
 * the operating system hands it to. The server issues these links too — push
 * notifications carry one so tapping the notification lands on the message.
 *
 * Two shapes are accepted, matching the desktop client:
 *   clickclack://app/<workspace>/<target>
 *   clickclack://open?path=/app/<workspace>/<target>
 *
 * https links to the ClickClack app itself are accepted as well, so universal
 * links (iOS) and app links (Android) route through the same code path once a
 * deployment configures them.
 */

export const APP_URL_SCHEME = "clickclack";
export const DEFAULT_APP_ROUTE = "/app";

/**
 * Reduce untrusted input to an in-app route, or reject it. Only `/app` routes
 * are navigable: a deep link must never be able to steer the shell at an
 * arbitrary path, a different origin, or a `javascript:` URL.
 */
export function safeAppRoute(input: string | undefined | null): string | null {
  if (!input || input.includes("\\") || input.includes("\0")) return null;
  let value: URL;
  try {
    value = new URL(input, "https://clickclack.invalid");
  } catch {
    return null;
  }
  if (value.origin !== "https://clickclack.invalid") return null;
  if (value.pathname !== DEFAULT_APP_ROUTE && !value.pathname.startsWith(`${DEFAULT_APP_ROUTE}/`)) {
    return null;
  }
  return `${value.pathname}${value.search}${value.hash}`;
}

/**
 * Translate a deep link into a route this app can navigate to. `appOrigins`
 * lists the https origins that serve this ClickClack, so universal links are
 * honored while links to some other server are not.
 */
export function deepLinkToRoute(input: string, appOrigins: readonly string[] = []): string | null {
  let value: URL;
  try {
    value = new URL(input);
  } catch {
    return null;
  }
  if (value.protocol === "https:" || value.protocol === "http:") {
    return appOrigins.includes(value.origin)
      ? safeAppRoute(`${value.pathname}${value.search}${value.hash}`)
      : null;
  }
  if (value.protocol !== `${APP_URL_SCHEME}:`) return null;
  if (value.hostname === "app") {
    return safeAppRoute(`${DEFAULT_APP_ROUTE}${value.pathname}${value.search}${value.hash}`);
  }
  if (value.hostname === "open") {
    return safeAppRoute(value.searchParams.get("path") ?? value.pathname);
  }
  return null;
}

/** Build the deep link for an in-app route. Returns null for routes we refuse to link. */
export function appDeepLink(route: string): string | null {
  const safe = safeAppRoute(route);
  if (!safe) return null;
  return `${APP_URL_SCHEME}://open?path=${encodeURIComponent(safe)}`;
}
