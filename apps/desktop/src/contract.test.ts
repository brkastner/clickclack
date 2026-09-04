import assert from "node:assert/strict";
import test from "node:test";
import "./clipboard-uri.test";
import {
  appURL,
  clampUnreadCount,
  desktopAudioPermissionAllowed,
  desktopBridgeAllowed,
  desktopMainWindowNavigationAllowed,
  desktopPasteAction,
  desktopOAuthCallbackCode,
  desktopOAuthStartURL,
  desktopTitleBarOptions,
  deepLinkToRoute,
  hasIntegratedTitleBarCapability,
  isDesktopTerminalData,
  isDesktopTerminalStatus,
  isSafeClipboardPNG,
  MAX_CLIPBOARD_IMAGE_DIMENSION,
  MAX_TERMINAL_INPUT_BYTES,
  mergeSettings,
  normalizeServerURL,
  normalizeTerminalDimensions,
  normalizeTerminalDockHeight,
  normalizeTerminalSequence,
  safeAppRoute,
  sanitizeNotification,
  sanitizeTerminalInput,
} from "./contract";

function pngHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
}

test("bounds PNG dimensions before decoding clipboard images", () => {
  assert.equal(isSafeClipboardPNG(pngHeader(32, 32)), true);
  assert.equal(isSafeClipboardPNG(pngHeader(0, 32)), false);
  assert.equal(isSafeClipboardPNG(pngHeader(MAX_CLIPBOARD_IMAGE_DIMENSION + 1, 1)), false);
  assert.equal(isSafeClipboardPNG(pngHeader(4097, 4096)), false);

  const wrongSignature = pngHeader(32, 32);
  new Uint8Array(wrongSignature)[0] = 0;
  assert.equal(isSafeClipboardPNG(wrongSignature), false);
  assert.equal(isSafeClipboardPNG(new ArrayBuffer(23)), false);
});

test("normalizes hosted and loopback servers", () => {
  assert.equal(normalizeServerURL("https://chat.example.com/app/"), "https://chat.example.com");
  assert.equal(normalizeServerURL("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.throws(() => normalizeServerURL("http://chat.example.com"), /HTTPS/);
  assert.throws(() => normalizeServerURL("https://user:secret@chat.example.com"), /credentials/);
  assert.throws(() => normalizeServerURL("https://chat.example.com/tenant"), /extra path/);
});

test("allows only microphone access from the configured ClickClack origin", () => {
  const serverUrl = "http://127.0.0.1:5173";
  assert.equal(
    desktopAudioPermissionAllowed("media", "http://127.0.0.1:5173/app", serverUrl, ["audio"]),
    true,
  );
  assert.equal(
    desktopAudioPermissionAllowed("media", "http://localhost:5173/app", serverUrl, ["audio"]),
    false,
  );
  assert.equal(
    desktopAudioPermissionAllowed("media", "http://127.0.0.1:5173", serverUrl, ["video"]),
    false,
  );
  assert.equal(
    desktopAudioPermissionAllowed("media", "http://127.0.0.1:5173", serverUrl, ["audio", "video"]),
    false,
  );
  assert.equal(
    desktopAudioPermissionAllowed("notifications", "http://127.0.0.1:5173", serverUrl, ["audio"]),
    false,
  );
});

test("keeps navigation inside ClickClack app routes", () => {
  assert.equal(
    safeAppRoute("/app/team/general?from=notification"),
    "/app/team/general?from=notification",
  );
  assert.equal(
    appURL("https://chat.example.com", "/app/team"),
    "https://chat.example.com/app/team",
  );
  assert.equal(safeAppRoute("https://evil.example/app"), null);
  assert.equal(safeAppRoute("//evil.example/app"), null);
  assert.equal(safeAppRoute("/docs"), null);
});

test("maps explicit deep-link forms to app routes", () => {
  assert.equal(deepLinkToRoute("clickclack://app/team/general"), "/app/team/general");
  assert.equal(
    deepLinkToRoute("clickclack://app/T1234567890ABCDEF/M1234567890ABCDEF"),
    "/app/T1234567890ABCDEF/M1234567890ABCDEF",
  );
  assert.equal(
    deepLinkToRoute("clickclack://open?path=%2Fapp%2Fteam%2Fgeneral"),
    "/app/team/general",
  );
  assert.equal(deepLinkToRoute("clickclack://evil/app/team"), null);
  assert.equal(deepLinkToRoute("https://chat.example.com/app/team"), null);
});

test("builds and validates the desktop OAuth handoff", () => {
  const challenge = "a".repeat(43);
  assert.equal(
    desktopOAuthStartURL("https://chat.example.com", challenge),
    `https://chat.example.com/api/auth/github/desktop/start?code_challenge=${challenge}&desktop_protocol=2`,
  );
  assert.throws(() => desktopOAuthStartURL("https://chat.example.com", "short"), /challenge/);
  assert.equal(
    desktopOAuthCallbackCode(`clickclack://auth/callback?code=${"a1".repeat(16)}`),
    "a1".repeat(16),
  );
  assert.equal(
    desktopOAuthCallbackCode(`chat.clickclack.desktop:/auth/callback?code=${"a1".repeat(16)}`),
    "a1".repeat(16),
  );
  assert.equal(
    desktopOAuthCallbackCode(`chat.clickclack.desktop:/auth/callback?code=${"A".repeat(43)}`),
    "A".repeat(43),
  );
  assert.equal(desktopOAuthCallbackCode("clickclack://auth/callback?code=bad"), null);
  assert.equal(desktopOAuthCallbackCode(`clickclack://app/callback?code=${"a1".repeat(16)}`), null);
  assert.equal(
    desktopOAuthCallbackCode(`chat.clickclack.desktop:/wrong?code=${"a1".repeat(16)}`),
    null,
  );
});

test("exposes the desktop bridge only to the configured server origin", () => {
  assert.equal(
    desktopBridgeAllowed("https://app.clickclack.chat", "https://app.clickclack.chat"),
    true,
  );
  assert.equal(desktopBridgeAllowed("https://github.com", "https://app.clickclack.chat"), false);
  assert.equal(desktopBridgeAllowed("https://app.clickclack.chat", undefined), false);
});

test("prioritizes URI files while preserving bitmap and text paste fallbacks", () => {
  const file = { bytes: new Uint8Array([1]), name: "image.png", type: "image/png" };
  assert.deepEqual(desktopPasteAction({ files: [file], hasImage: true, text: "fallback" }), {
    files: [file],
    kind: "files",
  });
  assert.deepEqual(desktopPasteAction({ files: [], hasImage: true, text: "fallback" }), {
    kind: "image",
  });
  assert.deepEqual(desktopPasteAction({ files: [], hasImage: false, text: "plain text" }), {
    kind: "text",
    text: "plain text",
  });
  assert.equal(desktopPasteAction({ files: Array(11).fill(file) }), null);
  assert.equal(desktopPasteAction({ files: [], text: "" }), null);
});

test("keeps integrated desktop chrome on app routes", () => {
  assert.equal(
    desktopMainWindowNavigationAllowed(
      "https://chat.example.com/app/team/general",
      "https://chat.example.com",
      true,
    ),
    true,
  );
  assert.equal(
    desktopMainWindowNavigationAllowed(
      "https://chat.example.com/",
      "https://chat.example.com",
      true,
    ),
    false,
  );
  assert.equal(
    desktopMainWindowNavigationAllowed(
      "https://chat.example.com/",
      "https://chat.example.com",
      false,
    ),
    true,
  );
  assert.equal(
    desktopMainWindowNavigationAllowed(
      "https://other.example/app",
      "https://chat.example.com",
      false,
    ),
    false,
  );
});

test("uses integrated native title bars on each desktop platform", () => {
  assert.deepEqual(desktopTitleBarOptions("darwin", true), {
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
  });
  assert.deepEqual(desktopTitleBarOptions("win32", true), {
    titleBarOverlay: {
      color: "#17181e",
      height: 52,
      symbolColor: "#e7e9ee",
    },
    titleBarStyle: "hidden",
  });
  assert.deepEqual(desktopTitleBarOptions("linux", false), {
    titleBarOverlay: {
      color: "#fbf6ee",
      height: 52,
      symbolColor: "#22201d",
    },
    titleBarStyle: "hidden",
  });
});

test("detects renderer support before replacing native window chrome", () => {
  assert.equal(
    hasIntegratedTitleBarCapability(
      '<html><head><meta name="clickclack-desktop-titlebar" content="1" /></head></html>',
    ),
    true,
  );
  assert.equal(
    hasIntegratedTitleBarCapability(
      '<html><head><meta name="clickclack-desktop-titlebar" content="0" /></head></html>',
    ),
    false,
  );
  assert.equal(hasIntegratedTitleBarCapability("<html><head></head></html>"), false);
});

test("validates terminal input, dimensions, and status payloads", () => {
  assert.deepEqual(normalizeTerminalDimensions({ cols: 120, rows: 36 }), {
    cols: 120,
    rows: 36,
  });
  assert.deepEqual(normalizeTerminalDimensions({ cols: 2, rows: 1 }), { cols: 2, rows: 1 });
  assert.deepEqual(normalizeTerminalDimensions({ cols: 500, rows: 300 }), {
    cols: 500,
    rows: 300,
  });
  assert.equal(normalizeTerminalDimensions({ cols: 1, rows: 36 }), null);
  assert.equal(normalizeTerminalDimensions({ cols: 120, rows: 301 }), null);
  assert.equal(normalizeTerminalDimensions({ cols: 120.5, rows: 36 }), null);
  assert.equal(normalizeTerminalDimensions({ cols: "120", rows: 36 }), null);
  assert.equal(normalizeTerminalDockHeight(160), 160);
  assert.equal(normalizeTerminalDockHeight(420.4), 420);
  assert.equal(normalizeTerminalDockHeight(159), null);
  assert.equal(normalizeTerminalDockHeight(Number.POSITIVE_INFINITY), null);
  assert.equal(normalizeTerminalDockHeight("420"), null);

  assert.equal(sanitizeTerminalInput("echo ready\r"), "echo ready\r");
  assert.equal(sanitizeTerminalInput("x".repeat(MAX_TERMINAL_INPUT_BYTES + 1)), null);
  assert.equal(sanitizeTerminalInput("🙂".repeat(MAX_TERMINAL_INPUT_BYTES / 4 + 1)), null);
  assert.equal(sanitizeTerminalInput(new Uint8Array()), null);

  assert.equal(isDesktopTerminalData({ data: "ready", sequence: 1 }), true);
  assert.equal(isDesktopTerminalData({ data: "ready", sequence: 0 }), false);
  assert.equal(isDesktopTerminalData({ data: new Uint8Array(), sequence: 1 }), false);
  assert.equal(normalizeTerminalSequence(42), 42);
  assert.equal(normalizeTerminalSequence(1.5), null);
  assert.equal(normalizeTerminalSequence("42"), null);

  assert.equal(isDesktopTerminalStatus({ state: "idle" }), true);
  assert.equal(isDesktopTerminalStatus({ state: "running", pid: 42 }), true);
  assert.equal(isDesktopTerminalStatus({ state: "exited", exitCode: 0, signal: null }), true);
  assert.equal(isDesktopTerminalStatus({ state: "error", message: "failed" }), true);
  assert.equal(isDesktopTerminalStatus({ state: "error", message: "x".repeat(501) }), false);
  assert.equal(isDesktopTerminalStatus({ state: "running", pid: -1 }), false);
  assert.equal(isDesktopTerminalStatus({ state: "unknown" }), false);
});

test("bounds badge and notification data from the renderer", () => {
  assert.equal(clampUnreadCount(-4), 0);
  assert.equal(clampUnreadCount(20_000), 9999);
  assert.deepEqual(
    sanitizeNotification({
      title: " Agent reply ",
      body: " Finished the task ",
      route: "/app/team/agents",
      tag: "msg_1",
    }),
    {
      title: "Agent reply",
      body: "Finished the task",
      route: "/app/team/agents",
      tag: "msg_1",
    },
  );
  assert.equal(sanitizeNotification({ title: "", body: "nope" }), null);
});

test("recovers safely from malformed persisted settings", () => {
  const settings = mergeSettings({
    closeToTray: false,
    serverUrl: "javascript:alert(1)",
    startAtLogin: true,
    window: { width: 120, height: 900, x: 42, maximized: true },
  });
  assert.equal(settings.serverUrl, "https://app.clickclack.chat");
  assert.equal(settings.closeToTray, false);
  assert.equal(settings.startAtLogin, true);
  assert.deepEqual(settings.window, {
    width: undefined,
    height: 900,
    x: 42,
    y: undefined,
    maximized: true,
  });
});
