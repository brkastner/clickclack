import assert from "node:assert/strict";
import test from "node:test";
import {
  installNativeShell,
  resetLaunchURLClaimForTests,
  haptic,
  invokeNative,
  isNativeMobile,
  listenNative,
  nativePlatform,
  resolveBackAction,
  resolveDarkMode,
  applyNativeStatusBar,
  type NativeBridge,
} from "./native.ts";

type Call = { method: string; options: unknown; plugin: string };

function fakeBridge(platform = "ios", plugins: Record<string, Record<string, unknown>> = {}) {
  const calls: Call[] = [];
  const record = (plugin: string, method: string) => (options: unknown) => {
    calls.push({ method, options, plugin });
  };
  const bridge: NativeBridge = {
    getPlatform: () => platform,
    isNativePlatform: () => platform !== "web",
    Plugins: {
      Haptics: { impact: record("Haptics", "impact") },
      StatusBar: {
        setStyle: record("StatusBar", "setStyle"),
        setBackgroundColor: record("StatusBar", "setBackgroundColor"),
      },
      ...plugins,
    },
  };
  return { bridge, calls };
}

test("only a real iOS or Android shell counts as native", () => {
  assert.equal(nativePlatform(fakeBridge("ios").bridge), "ios");
  assert.equal(nativePlatform(fakeBridge("android").bridge), "android");
  assert.equal(nativePlatform(fakeBridge("web").bridge), null);
  assert.equal(nativePlatform(undefined), null);
  assert.equal(isNativeMobile({ getPlatform: () => "ios" }), false);
  assert.equal(isNativeMobile(fakeBridge("ios").bridge), true);
});

test("plugin calls reach the shell with their options", () => {
  const { bridge, calls } = fakeBridge();
  invokeNative("Haptics", "impact", { style: "MEDIUM" }, bridge);
  assert.deepEqual(calls, [{ method: "impact", options: { style: "MEDIUM" }, plugin: "Haptics" }]);
});

test("missing plugins, missing methods, and throwing calls are absorbed", () => {
  const { bridge } = fakeBridge();
  assert.doesNotThrow(() => invokeNative("Nope", "impact", {}, bridge));
  assert.doesNotThrow(() => invokeNative("Haptics", "nope", {}, bridge));
  assert.doesNotThrow(() => invokeNative("Haptics", "impact", {}, undefined));
  const throwing: NativeBridge = {
    getPlatform: () => "ios",
    isNativePlatform: () => true,
    Plugins: {
      Haptics: {
        impact: () => {
          throw new Error("no taptic engine");
        },
      },
    },
  };
  assert.doesNotThrow(() => invokeNative("Haptics", "impact", {}, throwing));
});

test("a rejected plugin promise does not surface as an unhandled rejection", async () => {
  const bridge: NativeBridge = {
    getPlatform: () => "ios",
    isNativePlatform: () => true,
    Plugins: { Haptics: { impact: () => Promise.reject(new Error("denied")) } },
  };
  invokeNative("Haptics", "impact", {}, bridge);
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("haptics fire on a device and stay silent in a browser", () => {
  const native = fakeBridge("ios");
  haptic("medium", native.bridge);
  assert.deepEqual(native.calls, [
    { method: "impact", options: { style: "MEDIUM" }, plugin: "Haptics" },
  ]);
  const web = fakeBridge("web");
  haptic("light", web.bridge);
  assert.deepEqual(web.calls, []);
});

test("listeners unsubscribe whether the handle is sync or a promise", async () => {
  const removed: string[] = [];
  const events: Record<string, (payload: unknown) => void> = {};
  const bridge: NativeBridge = {
    getPlatform: () => "android",
    isNativePlatform: () => true,
    Plugins: {
      App: {
        addListener: (event: string, handler: (payload: unknown) => void) => {
          events[event] = handler;
          return Promise.resolve({ remove: () => removed.push(event) });
        },
      },
    },
  };
  const seen: unknown[] = [];
  const stop = listenNative("App", "appUrlOpen", (payload) => seen.push(payload), bridge);
  events.appUrlOpen?.({ url: "clickclack://app/W1/C1" });
  events.appUrlOpen?.(undefined);
  assert.deepEqual(seen, [{ url: "clickclack://app/W1/C1" }, {}]);
  await Promise.resolve();
  stop();
  assert.deepEqual(removed, ["appUrlOpen"]);
});

test("a listener removed before its handle resolves still unsubscribes", async () => {
  const removed: string[] = [];
  const bridge: NativeBridge = {
    getPlatform: () => "android",
    isNativePlatform: () => true,
    Plugins: {
      App: { addListener: () => Promise.resolve({ remove: () => removed.push("backButton") }) },
    },
  };
  listenNative("App", "backButton", () => {}, bridge)();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(removed, ["backButton"]);
});

test("listening without a shell hands back a usable no-op", () => {
  assert.doesNotThrow(() => listenNative("App", "backButton", () => {}, undefined)());
});

test("an explicit color mode beats the system preference", () => {
  assert.equal(resolveDarkMode("dark", false), true);
  assert.equal(resolveDarkMode("light", true), false);
  assert.equal(resolveDarkMode(null, true), true);
  assert.equal(resolveDarkMode(null, false), false);
});

test("the status bar takes light content on a dark board", () => {
  const { bridge, calls } = fakeBridge();
  applyNativeStatusBar(true, bridge);
  assert.deepEqual(calls, [
    { method: "setStyle", options: { style: "DARK" }, plugin: "StatusBar" },
    { method: "setBackgroundColor", options: { color: "#131419" }, plugin: "StatusBar" },
  ]);
  const light = fakeBridge();
  applyNativeStatusBar(false, light.bridge);
  assert.deepEqual(light.calls[0], {
    method: "setStyle",
    options: { style: "LIGHT" },
    plugin: "StatusBar",
  });
});

test("back closes the top layer first, then history, and only then leaves", () => {
  assert.equal(resolveBackAction(true, true), "dismissed");
  assert.equal(resolveBackAction(true, false), "dismissed");
  assert.equal(resolveBackAction(false, true), "back");
  assert.equal(resolveBackAction(false, false), "exit");
});

/** The narrow slice of DOM installNativeShell touches. */
function installFakeDOM(bridge: NativeBridge) {
  const attributes = new Map<string, string>();
  const root = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
  };
  Object.assign(globalThis, {
    document: { documentElement: root },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    window: {
      Capacitor: bridge,
      history: { back: () => {} },
      matchMedia: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    },
  });
  return { attributes };
}

function shellBridge(launchURL?: string) {
  const listeners: Record<string, (payload: unknown) => void> = {};
  let resolveLaunch: ((value: { url?: string }) => void) | undefined;
  const bridge: NativeBridge = {
    getPlatform: () => "android",
    isNativePlatform: () => true,
    Plugins: {
      App: {
        addListener: (event: string, handler: (payload: unknown) => void) => {
          listeners[event] = handler;
          return Promise.resolve({ remove: () => delete listeners[event] });
        },
        exitApp: () => {},
        getLaunchUrl: () =>
          new Promise<{ url?: string }>((resolve) => {
            resolveLaunch = resolve;
          }),
      },
      Keyboard: { setAccessoryBarVisible: () => {} },
      StatusBar: { setStyle: () => {}, setBackgroundColor: () => {} },
    },
  };
  return { bridge, listeners, settleLaunch: () => resolveLaunch?.({ url: launchURL }) };
}

test("a notification launch link is routed once, not again on every reinstall", async () => {
  resetLaunchURLClaimForTests();
  const link = "clickclack://app/W1/C1";
  const routed: string[] = [];
  const first = shellBridge(link);
  installFakeDOM(first.bridge);

  // Install, let the launch lookup settle, then tear down — the shell's owner
  // unmounting is what happens when the settings route replaces the chat page.
  const stopFirst = installNativeShell({
    dismissTopLayer: () => false,
    onDeepLink: (url) => routed.push(url),
  });
  first.settleLaunch();
  await new Promise((resolve) => setTimeout(resolve, 0));
  stopFirst();
  assert.deepEqual(routed, [link]);

  // Coming back to chat installs a fresh shell. getLaunchUrl would still report
  // the same link, so routing it again would yank the person back to channel A.
  const second = shellBridge(link);
  installFakeDOM(second.bridge);
  const stopSecond = installNativeShell({
    dismissTopLayer: () => false,
    onDeepLink: (url) => routed.push(url),
  });
  second.settleLaunch();
  await new Promise((resolve) => setTimeout(resolve, 0));
  stopSecond();
  assert.deepEqual(routed, [link]);
});

test("a launch lookup that settles after teardown does not navigate", async () => {
  resetLaunchURLClaimForTests();
  const routed: string[] = [];
  const shell = shellBridge("clickclack://app/W1/C1");
  installFakeDOM(shell.bridge);
  const stop = installNativeShell({
    dismissTopLayer: () => false,
    onDeepLink: (url) => routed.push(url),
  });
  // Tear down first, then let the pending lookup resolve.
  stop();
  shell.settleLaunch();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(routed, []);
});

test("deep links arriving after teardown do not navigate", async () => {
  resetLaunchURLClaimForTests();
  const routed: string[] = [];
  const shell = shellBridge();
  installFakeDOM(shell.bridge);
  const stop = installNativeShell({
    dismissTopLayer: () => false,
    onDeepLink: (url) => routed.push(url),
  });
  await Promise.resolve();
  const deliver = shell.listeners.appUrlOpen;
  shell.listeners.appUrlOpen?.({ url: "clickclack://app/W1/C1" });
  assert.deepEqual(routed, ["clickclack://app/W1/C1"]);
  stop();
  // A retained event delivered to a stale listener must be inert.
  deliver?.({ url: "clickclack://app/W2/C2" });
  assert.deepEqual(routed, ["clickclack://app/W1/C1"]);
});
