import assert from "node:assert/strict";
import test from "node:test";
import {
  beginNativeGitHubSignIn,
  completeNativeSignIn,
  onNativeSignInStatus,
  resetNativeSignInForTests,
  type NativeSignInStatus,
} from "./native-signin.ts";

type BrowserStub = {
  close?: () => void;
  open?: (options: Record<string, unknown>) => unknown;
};

/**
 * Stand up the shell, the runtime config, and fetch. Only the environment is a
 * double: the sign-in coordinator, bridge, and PKCE modules are the real ones.
 */
function installEnvironment(
  options: {
    apiBaseUrl?: string;
    browser?: BrowserStub | null;
    consume?: () => Response | Promise<Response>;
    origin?: string;
  } = {},
) {
  const opened: Record<string, unknown>[] = [];
  const requests: { body: unknown; url: string }[] = [];
  const browser: BrowserStub | null =
    options.browser === undefined
      ? {
          close: () => {},
          open: (config: Record<string, unknown>) => {
            opened.push(config);
          },
        }
      : options.browser;
  const origin = options.origin ?? "https://chat.example.com";
  Object.assign(globalThis, {
    window: {
      Capacitor: {
        getPlatform: () => "ios",
        isNativePlatform: () => true,
        Plugins: browser ? { Browser: browser } : {},
      },
      __CLICKCLACK_CONFIG__: options.apiBaseUrl ? { apiBaseUrl: options.apiBaseUrl } : undefined,
      location: { origin },
    },
    fetch: async (url: string, init?: RequestInit) => {
      requests.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined, url });
      return options.consume ? await options.consume() : new Response(null, { status: 204 });
    },
  });
  const seen: NativeSignInStatus[] = [];
  resetNativeSignInForTests();
  onNativeSignInStatus((status) => seen.push(status));
  return { opened, requests, seen };
}

const CHALLENGE_START =
  /\/api\/auth\/github\/desktop\/start\?code_challenge=[A-Za-z0-9_-]{43}&desktop_protocol=2$/;

test("sign-in starts at the frontend origin when the API is same-origin", async () => {
  const env = installEnvironment();
  await beginNativeGitHubSignIn();
  assert.equal(env.opened.length, 1);
  const url = String(env.opened[0]?.url);
  assert.match(url, /^https:\/\/chat\.example\.com\/api\/auth\/github\/desktop\/start\?/);
  assert.match(url, CHALLENGE_START);
  assert.equal(env.seen.at(-1)?.kind, "waiting");
});

test("sign-in starts at the configured API origin on a split deployment", async () => {
  const env = installEnvironment({ apiBaseUrl: "https://api.example.com/services/clickclack" });
  await beginNativeGitHubSignIn();
  const url = String(env.opened[0]?.url);
  // The frontend origin must not be where OAuth begins on a split deployment.
  assert.match(
    url,
    /^https:\/\/api\.example\.com\/services\/clickclack\/api\/auth\/github\/desktop\/start\?/,
  );
  assert.ok(!url.startsWith("https://chat.example.com"));
});

test("sign-in honours a path-mounted API on the same origin", async () => {
  const env = installEnvironment({ apiBaseUrl: "https://chat.example.com/services/clickclack" });
  await beginNativeGitHubSignIn();
  assert.match(
    String(env.opened[0]?.url),
    /^https:\/\/chat\.example\.com\/services\/clickclack\/api\/auth\/github\/desktop\/start\?/,
  );
});

test("a browser that fails to open is reported, not described as waiting", async () => {
  const env = installEnvironment({
    browser: { close: () => {}, open: () => Promise.reject(new Error("no browser")) },
  });
  await beginNativeGitHubSignIn();
  const last = env.seen.at(-1);
  assert.equal(last?.kind, "failed");
  assert.ok(!env.seen.some((status) => status.kind === "waiting"));
});

test("an unavailable Browser plugin is reported rather than silently swallowed", async () => {
  const env = installEnvironment({ browser: null });
  await beginNativeGitHubSignIn();
  assert.equal(env.seen.at(-1)?.kind, "failed");
  assert.ok(!env.seen.some((status) => status.kind === "waiting"));
});

test("a browser that throws synchronously is reported too", async () => {
  const env = installEnvironment({
    browser: {
      close: () => {},
      open: () => {
        throw new Error("activity not found");
      },
    },
  });
  await beginNativeGitHubSignIn();
  assert.equal(env.seen.at(-1)?.kind, "failed");
});

test("the callback redeems the grant against the configured API with its verifier", async () => {
  const env = installEnvironment({ apiBaseUrl: "https://api.example.com/services/clickclack" });
  await beginNativeGitHubSignIn();
  const started = new URL(String(env.opened[0]?.url));
  const challenge = started.searchParams.get("code_challenge") ?? "";
  const code = "c".repeat(43);
  const outcome = await completeNativeSignIn(`chat.clickclack.desktop:/auth/callback?code=${code}`);
  assert.equal(outcome, "signed-in");
  const consume = env.requests.at(-1);
  assert.match(
    String(consume?.url),
    /^https:\/\/api\.example\.com\/services\/clickclack\/api\/auth\/github\/desktop\/consume$/,
  );
  const body = consume?.body as { code: string; code_verifier: string };
  assert.equal(body.code, code);
  assert.match(body.code_verifier, /^[A-Za-z0-9_-]{43}$/);
  // The verifier redeems the challenge the browser flow was started with.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body.code_verifier),
  );
  assert.equal(Buffer.from(digest).toString("base64url"), challenge);
});

test("a rejected consume surfaces as a failure", async () => {
  const env = installEnvironment({
    consume: () => new Response('{"error":"invalid desktop oauth grant"}', { status: 400 }),
  });
  await beginNativeGitHubSignIn();
  const outcome = await completeNativeSignIn(
    `chat.clickclack.desktop:/auth/callback?code=${"d".repeat(43)}`,
  );
  assert.equal(outcome, "failed");
  assert.equal(env.seen.at(-1)?.kind, "failed");
});

test("a callback with no flow in progress is refused instead of hanging", async () => {
  const env = installEnvironment();
  const outcome = await completeNativeSignIn(
    `chat.clickclack.desktop:/auth/callback?code=${"e".repeat(43)}`,
  );
  assert.equal(outcome, "failed");
  assert.equal(env.requests.length, 0);
});

test("ordinary deep links are ignored so routing still sees them", async () => {
  const env = installEnvironment();
  assert.equal(await completeNativeSignIn("clickclack://app/W1/C1"), "ignored");
  assert.equal(env.requests.length, 0);
});
