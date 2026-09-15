/**
 * Platform-neutral configuration for the ClickClack mobile shell.
 *
 * The shell is deliberately thin: it loads the ClickClack web app from a real
 * server origin so sessions, cookies, uploads, and the realtime socket behave
 * exactly as they do in a browser or in the desktop client. Everything in this
 * file is pure so `capacitor.config.ts` and `scripts/configure-native.mjs` can
 * share one source of truth and be unit tested without a device.
 */

export const APP_ID = "chat.clickclack.mobile";

/**
 * The launcher label. Only the label is branded: the app id and both URL
 * schemes stay as they are, because the server, the desktop client, and every
 * already-issued deep link address this app by those and not by its name.
 */
export const APP_NAME = "касии";

/**
 * The shell's chrome color, shared by the native background, the splash field,
 * and the adaptive icon's background layer so the app never flashes a color the
 * web app does not use.
 */
export const BRAND_BACKGROUND = "#131419";

/**
 * Deep-link scheme. This intentionally matches the desktop client's legacy
 * protocol so one `clickclack://` link works on every ClickClack surface, which
 * is what server-issued links (for example Pushover notifications) rely on.
 */
export const APP_URL_SCHEME = "clickclack";

/**
 * The scheme the server redirects sign-in grants to. It reads as a desktop
 * identifier because the mobile shell reuses the desktop client's native OAuth
 * endpoints rather than duplicating them; registering it is what lets sign-in
 * finish in the app. See apps/web/src/lib/native-auth.ts.
 */
export const AUTH_URL_SCHEME = "chat.clickclack.desktop";

/** Every scheme the native projects must claim. */
export const APP_URL_SCHEMES = [APP_URL_SCHEME, AUTH_URL_SCHEME] as const;

export const DEFAULT_SERVER_URL = "https://app.clickclack.chat";
export const DEFAULT_APP_ROUTE = "/app";
export const SERVER_URL_ENV = "CLICKCLACK_SERVER_URL";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Validate a server origin using the same rules as the desktop client, so a URL
 * that works in one shell works in the other. Remote servers must use HTTPS;
 * plain HTTP is accepted only for loopback development servers.
 */
export function normalizeServerURL(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("Enter a ClickClack server URL");
  let value: URL;
  try {
    value = new URL(raw);
  } catch {
    throw new Error("Enter a complete http:// or https:// URL");
  }
  if (value.protocol !== "https:" && value.protocol !== "http:") {
    throw new Error("ClickClack servers must use http:// or https://");
  }
  if (value.username || value.password) {
    throw new Error("Server URLs cannot contain credentials");
  }
  if (value.protocol === "http:" && !LOOPBACK_HOSTS.has(value.hostname.toLowerCase())) {
    throw new Error("Remote ClickClack servers must use HTTPS");
  }
  if (value.pathname !== "/" && value.pathname !== "/app" && value.pathname !== "/app/") {
    throw new Error("Use the server origin, without an extra path");
  }
  if (value.search || value.hash) {
    throw new Error("Server URLs cannot contain a query or fragment");
  }
  return value.origin;
}

export type MobileServerConfig = {
  cleartext?: boolean;
  url: string;
};

/**
 * Resolve the origin the shell loads. No `allowNavigation` entry is added: it
 * would only widen what stays inside the web view, and Capacitor already keeps
 * the server's own host in-app. Note that the platform check is host-based, not
 * origin-based, so a second service on the same hostname at another port would
 * also stay in the web view; docs/mobile.md states that boundary honestly
 * rather than promising origin isolation.
 */
export function mobileServerConfig(serverURL: string): MobileServerConfig {
  const origin = normalizeServerURL(serverURL);
  const parsed = new URL(origin);
  const config: MobileServerConfig = { url: `${origin}${DEFAULT_APP_ROUTE}` };
  if (parsed.protocol === "http:") config.cleartext = true;
  return config;
}

export function serverURLFromEnv(env: Record<string, string | undefined> = {}): string {
  return (env[SERVER_URL_ENV] ?? "").trim() || DEFAULT_SERVER_URL;
}
