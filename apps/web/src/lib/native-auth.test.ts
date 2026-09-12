import assert from "node:assert/strict";
import test from "node:test";
import {
  createPKCEPair,
  NATIVE_OAUTH_CALLBACK_SCHEME,
  nativeOAuthGrantCode,
  nativeOAuthStartPath,
} from "./native-auth.ts";

test("the PKCE pair matches what the server accepts", async () => {
  const { challenge, verifier } = await createPKCEPair();
  // The server validates a 43-character challenge and a 43-128 character
  // verifier, both restricted to base64url characters.
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(challenge, verifier);
});

test("the challenge is the S256 digest of the verifier the server will recompute", async () => {
  const { challenge, verifier } = await createPKCEPair();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const expected = Buffer.from(digest).toString("base64url");
  assert.equal(challenge, expected);
});

test("each pair is fresh", async () => {
  const [first, second] = await Promise.all([createPKCEPair(), createPKCEPair()]);
  assert.notEqual(first.verifier, second.verifier);
});

test("the start path carries the challenge and a protocol the server still supports", () => {
  const path = nativeOAuthStartPath("a".repeat(43));
  assert.match(path, /^\/api\/auth\/github\/desktop\/start\?/);
  const query = new URLSearchParams(path.split("?")[1]);
  assert.equal(query.get("code_challenge"), "a".repeat(43));
  assert.equal(query.get("desktop_protocol"), "2");
});

test("a protocol-2 grant callback yields its code", () => {
  const code = "b".repeat(43);
  assert.equal(
    nativeOAuthGrantCode(`${NATIVE_OAUTH_CALLBACK_SCHEME}:/auth/callback?code=${code}`),
    code,
  );
});

test("the legacy callback shape still completes sign-in", () => {
  const code = "0123456789abcdef0123456789abcdef";
  assert.equal(nativeOAuthGrantCode(`clickclack://auth/callback?code=${code}`), code);
});

test("content deep links are not mistaken for auth callbacks", () => {
  assert.equal(nativeOAuthGrantCode("clickclack://app/W1/C1"), null);
  assert.equal(nativeOAuthGrantCode("clickclack://open?path=/app/W1/C1"), null);
});

test("malformed or foreign callbacks are refused", () => {
  const code = "b".repeat(43);
  assert.equal(nativeOAuthGrantCode(`${NATIVE_OAUTH_CALLBACK_SCHEME}:/auth/callback`), null);
  assert.equal(
    nativeOAuthGrantCode(`${NATIVE_OAUTH_CALLBACK_SCHEME}:/auth/callback?code=short`),
    null,
  );
  assert.equal(
    nativeOAuthGrantCode(`${NATIVE_OAUTH_CALLBACK_SCHEME}:/elsewhere?code=${code}`),
    null,
  );
  assert.equal(nativeOAuthGrantCode(`evil:/auth/callback?code=${code}`), null);
  assert.equal(nativeOAuthGrantCode(`https://evil.example.com/auth/callback?code=${code}`), null);
  assert.equal(nativeOAuthGrantCode("clickclack://auth/callback?code=%3Cscript%3E"), null);
  assert.equal(nativeOAuthGrantCode("not a url"), null);
});
