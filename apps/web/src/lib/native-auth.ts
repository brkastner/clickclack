/**
 * Sign-in handoff for the native mobile shell.
 *
 * The browser OAuth flow cannot complete inside the shell's web view. Hitting
 * `/api/auth/<provider>/start` sets the provider's browser-binding cookie in the
 * web view and then redirects to the identity provider, which the shell hands to
 * the system browser because it is not the configured server host. The callback
 * then arrives from the browser without that binding cookie and the server
 * rejects it — and even if it were accepted, the session would belong to the
 * browser rather than to the app.
 *
 * The desktop client already solved this, and the server endpoints it uses are
 * not desktop-specific: run the whole provider flow in one browser context with
 * a PKCE challenge, have the callback hand back a single-use grant over a custom
 * URL scheme, then redeem that grant from the web view so the session cookie is
 * installed where the app can use it. The shell registers the same callback
 * scheme the server already redirects to, so no server change is needed.
 */

/**
 * Protocol 2 keeps the flow usable on deployments with namespaced cookies,
 * which reject protocol 1 outright.
 */
export const NATIVE_OAUTH_PROTOCOL_VERSION = 2;

/** The scheme the server redirects protocol-2 grants to. */
export const NATIVE_OAUTH_CALLBACK_SCHEME = "chat.clickclack.desktop";

const PKCE_VERIFIER_BYTES = 32;

function base64URL(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export type PKCEPair = { challenge: string; verifier: string };

/**
 * A PKCE verifier and its S256 challenge. Both land at 43 characters, which is
 * what the server accepts for a challenge and the low end of what it accepts for
 * a verifier.
 */
export async function createPKCEPair(): Promise<PKCEPair> {
  const random = new Uint8Array(PKCE_VERIFIER_BYTES);
  crypto.getRandomValues(random);
  const verifier = base64URL(random);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { challenge: base64URL(new Uint8Array(digest)), verifier };
}

/**
 * Where to send the system browser to begin GitHub sign-in. This is the same
 * endpoint the desktop client uses; the server treats a challenge as the signal
 * to issue a grant instead of a browser session.
 */
export function nativeOAuthStartPath(codeChallenge: string): string {
  const query = new URLSearchParams({
    code_challenge: codeChallenge,
    desktop_protocol: String(NATIVE_OAUTH_PROTOCOL_VERSION),
  });
  return `/api/auth/github/desktop/start?${query.toString()}`;
}

/**
 * Extract the one-time grant from a callback link, or null when the link is not
 * one. Both the protocol-2 scheme and the legacy `clickclack://auth/callback`
 * shape are accepted so an older server still completes sign-in.
 */
export function nativeOAuthGrantCode(input: string): string | null {
  let value: URL;
  try {
    value = new URL(input);
  } catch {
    return null;
  }
  const current =
    value.protocol === `${NATIVE_OAUTH_CALLBACK_SCHEME}:` &&
    value.hostname === "" &&
    value.pathname === "/auth/callback";
  const legacy =
    value.protocol === "clickclack:" && value.hostname === "auth" && value.pathname === "/callback";
  if (!current && !legacy) return null;
  const code = value.searchParams.get("code") ?? "";
  // Protocol 1 issues 32 hex characters; protocol 2 issues 43 base64url ones.
  return /^[a-f0-9]{32}$/.test(code) || /^[A-Za-z0-9_-]{43}$/.test(code) ? code : null;
}
