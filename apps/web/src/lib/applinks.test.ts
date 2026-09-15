import assert from "node:assert/strict";
import test from "node:test";
import { appDeepLink, deepLinkToRoute, safeAppRoute } from "./applinks.ts";

test("app routes survive with their query and fragment", () => {
  assert.equal(safeAppRoute("/app"), "/app");
  assert.equal(safeAppRoute("/app/W1/C1"), "/app/W1/C1");
  assert.equal(safeAppRoute("/app/W1/C1?q=hi#m2"), "/app/W1/C1?q=hi#m2");
});

test("anything that is not an in-app route is refused", () => {
  assert.equal(safeAppRoute(undefined), null);
  assert.equal(safeAppRoute(""), null);
  assert.equal(safeAppRoute("/"), null);
  assert.equal(safeAppRoute("/application"), null);
  assert.equal(safeAppRoute("/settings"), null);
  assert.equal(safeAppRoute("https://evil.example.com/app/W1"), null);
  assert.equal(safeAppRoute("//evil.example.com/app/W1"), null);
  assert.equal(safeAppRoute("javascript:alert(1)"), null);
  assert.equal(safeAppRoute("/app\\..\\W1"), null);
  assert.equal(safeAppRoute("/app/\0"), null);
});

test("both desktop deep-link shapes resolve to the same route", () => {
  assert.equal(deepLinkToRoute("clickclack://app/W1/C1"), "/app/W1/C1");
  assert.equal(deepLinkToRoute("clickclack://app"), "/app");
  assert.equal(deepLinkToRoute("clickclack://open?path=/app/W1/C1"), "/app/W1/C1");
  assert.equal(
    deepLinkToRoute("clickclack://open?path=%2Fapp%2FW1%2FC1%3Fq%3Dhi"),
    "/app/W1/C1?q=hi",
  );
});

test("deep links cannot steer the shell off the app", () => {
  assert.equal(deepLinkToRoute("clickclack://open?path=/settings"), null);
  assert.equal(deepLinkToRoute("clickclack://open?path=https://evil.example.com/app"), null);
  assert.equal(deepLinkToRoute("clickclack://elsewhere/app/W1"), null);
  assert.equal(deepLinkToRoute("other://app/W1/C1"), null);
  assert.equal(deepLinkToRoute("not a url"), null);
});

test("https links route only when they belong to this ClickClack", () => {
  const origins = ["https://chat.example.com"];
  assert.equal(deepLinkToRoute("https://chat.example.com/app/W1/C1", origins), "/app/W1/C1");
  assert.equal(deepLinkToRoute("https://chat.example.com/pricing", origins), null);
  assert.equal(deepLinkToRoute("https://evil.example.com/app/W1/C1", origins), null);
  assert.equal(deepLinkToRoute("https://chat.example.com/app/W1/C1"), null);
});

test("routes round-trip through a deep link", () => {
  const link = appDeepLink("/app/W1/C1?q=hi#m2");
  assert.equal(link, "clickclack://open?path=%2Fapp%2FW1%2FC1%3Fq%3Dhi%23m2");
  assert.equal(deepLinkToRoute(link ?? ""), "/app/W1/C1?q=hi#m2");
  assert.equal(appDeepLink("/settings"), null);
});
