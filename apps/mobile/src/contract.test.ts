import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_URL_SCHEMES,
  AUTH_URL_SCHEME,
  DEFAULT_SERVER_URL,
  mobileServerConfig,
  normalizeServerURL,
  serverURLFromEnv,
} from "./contract.ts";

test("server URLs are reduced to a bare origin", () => {
  assert.equal(normalizeServerURL(" https://chat.example.com/app "), "https://chat.example.com");
  assert.equal(
    normalizeServerURL("https://chat.example.com:8443/"),
    "https://chat.example.com:8443",
  );
  assert.equal(normalizeServerURL("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
});

test("remote servers must use HTTPS, and credentials or extra paths are refused", () => {
  assert.throws(() => normalizeServerURL("http://chat.example.com"), /HTTPS/);
  assert.throws(() => normalizeServerURL("https://user:pw@chat.example.com"), /credentials/);
  assert.throws(() => normalizeServerURL("https://chat.example.com/team"), /without an extra path/);
  assert.throws(() => normalizeServerURL("https://chat.example.com/?a=1"), /query or fragment/);
  assert.throws(() => normalizeServerURL("ftp://chat.example.com"), /http:\/\/ or https:\/\//);
  assert.throws(() => normalizeServerURL("chat.example.com"), /complete http/);
  assert.throws(() => normalizeServerURL("   "), /Enter a ClickClack server URL/);
});

test("the shell opens the chat app and widens nothing beyond it", () => {
  const config = mobileServerConfig("https://chat.example.com");
  assert.equal(config.url, "https://chat.example.com/app");
  assert.equal(config.cleartext, undefined);
  // An allowNavigation entry would only add hosts that stay inside the web view.
  assert.ok(!("allowNavigation" in config));
});

test("both URL schemes are claimed: content deep links and the sign-in callback", () => {
  assert.deepEqual([...APP_URL_SCHEMES], ["clickclack", "chat.clickclack.desktop"]);
  assert.equal(AUTH_URL_SCHEME, "chat.clickclack.desktop");
});

test("loopback development servers opt into cleartext", () => {
  const config = mobileServerConfig("http://localhost:8080");
  assert.equal(config.url, "http://localhost:8080/app");
  assert.equal(config.cleartext, true);
});

test("the server URL comes from the environment, falling back to the hosted service", () => {
  assert.equal(serverURLFromEnv({}), DEFAULT_SERVER_URL);
  assert.equal(serverURLFromEnv({ CLICKCLACK_SERVER_URL: "  " }), DEFAULT_SERVER_URL);
  assert.equal(
    serverURLFromEnv({ CLICKCLACK_SERVER_URL: "https://chat.example.com" }),
    "https://chat.example.com",
  );
});
