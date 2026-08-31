import assert from "node:assert/strict";
import test from "node:test";
import { apiResourceURL } from "./api.ts";

type ClickClackConfig = NonNullable<typeof globalThis.window.__CLICKCLACK_CONFIG__>;

function withConfig<T>(config: ClickClackConfig | undefined, run: () => T): T {
  const hadWindow = "window" in globalThis;
  const originalWindow = globalThis.window;
  // The module reads window at call time, so a bare stub is enough here.
  (globalThis as { window?: unknown }).window = { __CLICKCLACK_CONFIG__: config };
  try {
    return run();
  } finally {
    if (hadWindow) globalThis.window = originalWindow;
    else delete (globalThis as { window?: unknown }).window;
  }
}

test("relative API paths resolve against the configured base", () => {
  withConfig({ apiBaseUrl: "https://api.example.com" }, () => {
    assert.equal(apiResourceURL("/api/uploads/upl_1"), "https://api.example.com/api/uploads/upl_1");
  });
  withConfig(undefined, () => {
    assert.equal(apiResourceURL("/api/uploads/upl_1"), "/api/uploads/upl_1");
  });
});

test("absolute API resource URLs are re-pointed at the active origin", () => {
  // An avatar minted by a tailnet host must not be fetched cross-origin from
  // another origin, where the session cookie does not apply and the API 401s.
  withConfig(undefined, () => {
    assert.equal(
      apiResourceURL("https://athena.zorilla-puffin.ts.net:8080/api/uploads/upl_1"),
      "/api/uploads/upl_1",
    );
  });
  withConfig({ apiBaseUrl: "https://api.example.com" }, () => {
    assert.equal(
      apiResourceURL("http://127.0.0.1:8080/api/uploads/upl_1"),
      "https://api.example.com/api/uploads/upl_1",
    );
  });
});

test("query strings on API resource URLs survive the rewrite", () => {
  withConfig(undefined, () => {
    assert.equal(
      apiResourceURL("https://athena.example.net:8080/api/uploads/upl_1?download=1"),
      "/api/uploads/upl_1?download=1",
    );
  });
});

test("external and malformed URLs are left alone", () => {
  withConfig({ apiBaseUrl: "https://api.example.com" }, () => {
    // Gravatar and other third-party images are not API resources.
    assert.equal(
      apiResourceURL("https://gravatar.com/avatar/abc"),
      "https://gravatar.com/avatar/abc",
    );
    assert.equal(
      apiResourceURL("https://cdn.example.com/images/api/photo.png"),
      "https://cdn.example.com/images/api/photo.png",
    );
    assert.equal(apiResourceURL("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
    assert.equal(apiResourceURL("not a url"), "not a url");
  });
});

test("blank values stay blank so the avatar falls back to initials", () => {
  withConfig(undefined, () => {
    assert.equal(apiResourceURL(""), "");
    assert.equal(apiResourceURL("   "), "");
  });
});
