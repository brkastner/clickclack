/**
 * Drives the native shell's sign-in handoff. The link parsing and PKCE details
 * live in native-auth.ts; this module owns the parts that touch the network,
 * the shell, and the UI.
 */

import { api, readableAPIError } from "./api";
import { invokeNative, isNativeMobile } from "./native";
import { createPKCEPair, nativeOAuthGrantCode, nativeOAuthStartPath } from "./native-auth";

export type NativeSignInStatus =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "waiting" }
  | { kind: "completing" }
  | { kind: "failed"; message: string };

export type NativeSignInOutcome = "ignored" | "signed-in" | "failed";

/**
 * The verifier for the flow in progress. It is deliberately kept in memory
 * only: it is the secret that redeems the grant, and it is useless once the
 * process ends, at which point the grant expires unredeemed.
 */
let pendingVerifier: string | null = null;

const listeners = new Set<(status: NativeSignInStatus) => void>();
let status: NativeSignInStatus = { kind: "idle" };

export function onNativeSignInStatus(listener: (status: NativeSignInStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

function publish(next: NativeSignInStatus) {
  status = next;
  for (const listener of listeners) listener(next);
}

/**
 * Begin GitHub sign-in in the system browser. The start URL has to leave the
 * web view: the provider flow must run start-to-callback in one browser context
 * so the binding cookie the server sets is still there at the callback.
 */
export async function beginNativeGitHubSignIn(): Promise<void> {
  if (!isNativeMobile()) return;
  publish({ kind: "opening" });
  try {
    const { challenge, verifier } = await createPKCEPair();
    pendingVerifier = verifier;
    const url = new URL(nativeOAuthStartPath(challenge), window.location.origin).toString();
    invokeNative("Browser", "open", { presentationStyle: "popover", url });
    publish({ kind: "waiting" });
  } catch (error) {
    pendingVerifier = null;
    publish({ kind: "failed", message: readableAPIError(error, "Could not start sign-in.") });
  }
}

/**
 * Redeem a sign-in callback link, installing the session in the web view. Links
 * that are not callbacks are reported as ignored so ordinary deep links fall
 * through to routing.
 */
export async function completeNativeSignIn(url: string): Promise<NativeSignInOutcome> {
  const code = nativeOAuthGrantCode(url);
  if (!code) return "ignored";
  const verifier = pendingVerifier;
  pendingVerifier = null;
  invokeNative("Browser", "close");
  if (!verifier) {
    // A callback with no flow in progress: the shell restarted, so the grant
    // cannot be redeemed. Say so rather than failing silently.
    publish({ kind: "failed", message: "Sign-in expired. Try again." });
    return "failed";
  }
  publish({ kind: "completing" });
  try {
    await api("/api/auth/github/desktop/consume", {
      method: "POST",
      body: JSON.stringify({ code, code_verifier: verifier }),
    });
    publish({ kind: "idle" });
    return "signed-in";
  } catch (error) {
    publish({ kind: "failed", message: readableAPIError(error, "Could not finish sign-in.") });
    return "failed";
  }
}

/** Test seam: drop any flow in progress. */
export function resetNativeSignInForTests(): void {
  pendingVerifier = null;
  status = { kind: "idle" };
  listeners.clear();
}
