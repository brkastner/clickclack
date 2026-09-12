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
export const APP_NAME = "ClickClack";

/**
 * Deep-link scheme. This intentionally matches the desktop client's legacy
 * protocol so one `clickclack://` link works on every ClickClack surface, which
 * is what server-issued links (for example Pushover notifications) rely on.
 */
export const APP_URL_SCHEME = "clickclack";

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
  allowNavigation: string[];
  cleartext?: boolean;
  url: string;
};

/**
 * Resolve the origin the shell should load and the hosts it may navigate to
 * in-app. Anything outside `allowNavigation` is handed to the system browser,
 * which is both the native-feeling behavior and the safe one.
 */
export function mobileServerConfig(serverURL: string): MobileServerConfig {
  const origin = normalizeServerURL(serverURL);
  const parsed = new URL(origin);
  const config: MobileServerConfig = {
    allowNavigation: [parsed.hostname],
    url: `${origin}${DEFAULT_APP_ROUTE}`,
  };
  if (parsed.protocol === "http:") config.cleartext = true;
  return config;
}

export function serverURLFromEnv(env: Record<string, string | undefined> = {}): string {
  return (env[SERVER_URL_ENV] ?? "").trim() || DEFAULT_SERVER_URL;
}
