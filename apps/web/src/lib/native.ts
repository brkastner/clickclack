/**
 * Native mobile shell bridge.
 *
 * The mobile app is the ClickClack web app loaded by a Capacitor shell from a
 * real server origin, so sessions, uploads, and the realtime socket behave
 * exactly as they do in a browser. This module is the only place that talks to
 * the shell, and it talks to it through the globals Capacitor injects rather
 * than through the `@capacitor/*` packages: the web bundle is served to every
 * browser user and embedded in the server binary, so it must not grow a native
 * dependency, and every call here has to degrade to nothing off-device.
 */

export type NativePlatform = "android" | "ios";

type PluginMethods = Record<string, unknown>;

export type NativeBridge = {
  Plugins?: Record<string, PluginMethods | undefined>;
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
};

type ListenerHandle = { remove?: () => unknown };

/** Status bar and splash colors; these track --bg in styles/base.css. */
const STATUS_BAR_BACKGROUND = { dark: "#131419", light: "#f7f3ed" };

/**
 * Whether the launch URL has been claimed. Capacitor's getLaunchUrl() is a
 * getter, not a queue: it keeps returning the URL the app was opened with for
 * the whole process lifetime. Routing it more than once would drag a person
 * back to the notification's conversation every time the shell is reinstalled,
 * so it is claimed exactly once per web view.
 */
let launchURLClaimed = false;

/** Test seam: forget that the launch URL was claimed. */
export function resetLaunchURLClaimForTests(): void {
  launchURLClaimed = false;
}

export function nativeBridge(): NativeBridge | undefined {
  return typeof window === "undefined" ? undefined : window.Capacitor;
}

export function nativePlatform(bridge = nativeBridge()): NativePlatform | null {
  if (!bridge || bridge.isNativePlatform?.() !== true) return null;
  const platform = bridge.getPlatform?.();
  return platform === "ios" || platform === "android" ? platform : null;
}

export function isNativeMobile(bridge = nativeBridge()): boolean {
  return nativePlatform(bridge) !== null;
}

function pluginMethod(bridge: NativeBridge | undefined, plugin: string, method: string) {
  const target = bridge?.Plugins?.[plugin];
  const fn = target?.[method];
  return typeof fn === "function"
    ? (fn as (...args: unknown[]) => unknown).bind(target)
    : undefined;
}

/**
 * Call a plugin method, ignoring anything that goes wrong. A shell without the
 * plugin, an older shell, or a rejected call must never break the chat UI.
 */
export function invokeNative(
  plugin: string,
  method: string,
  options?: Record<string, unknown>,
  bridge = nativeBridge(),
): void {
  const fn = pluginMethod(bridge, plugin, method);
  if (!fn) return;
  try {
    const result = fn(options);
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      void (result as Promise<unknown>).catch(() => {});
    }
  } catch {
    // Native calls are best-effort decoration around a working web app.
  }
}

/**
 * Call a plugin method and surface whatever goes wrong. Use this for native
 * operations the app genuinely depends on: sign-in cannot quietly degrade to
 * "best effort" and still tell someone to finish in a browser that never
 * opened. `invokeNative` stays the right call for decoration.
 */
export async function requireNative(
  plugin: string,
  method: string,
  options?: Record<string, unknown>,
  bridge = nativeBridge(),
): Promise<unknown> {
  const fn = pluginMethod(bridge, plugin, method);
  if (!fn) throw new Error(`${plugin}.${method} is not available in this app`);
  return await fn(options);
}

/** Subscribe to a plugin event and return an unsubscribe that is always safe to call. */
export function listenNative(
  plugin: string,
  event: string,
  handler: (payload: Record<string, unknown>) => void,
  bridge = nativeBridge(),
): () => void {
  const add = pluginMethod(bridge, plugin, "addListener");
  if (!add) return () => {};
  let handle: ListenerHandle | undefined;
  let removed = false;
  try {
    const result = add(event, (payload: unknown) =>
      handler((payload ?? {}) as Record<string, unknown>),
    );
    if (result && typeof (result as Promise<ListenerHandle>).then === "function") {
      void (result as Promise<ListenerHandle>)
        .then((resolved) => {
          handle = resolved;
          if (removed) handle?.remove?.();
        })
        .catch(() => {});
    } else {
      handle = result as ListenerHandle;
    }
  } catch {
    return () => {};
  }
  return () => {
    removed = true;
    try {
      handle?.remove?.();
    } catch {
      // Nothing to do if the shell already tore the listener down.
    }
  };
}

export type HapticKind = "selection" | "light" | "medium" | "heavy";

const HAPTIC_STYLES: Record<HapticKind, string> = {
  selection: "LIGHT",
  light: "LIGHT",
  medium: "MEDIUM",
  heavy: "HEAVY",
};

/**
 * A short tick for gestures that have no visible "it worked yet" moment —
 * chiefly the long press that opens a message's action sheet.
 */
export function haptic(kind: HapticKind = "light", bridge = nativeBridge()): void {
  if (!isNativeMobile(bridge)) return;
  invokeNative("Haptics", "impact", { style: HAPTIC_STYLES[kind] }, bridge);
}

/** The color mode actually in effect: `data-color-mode` wins, else the system. */
export function resolveDarkMode(attribute: string | null, prefersDark: boolean): boolean {
  if (attribute === "dark") return true;
  if (attribute === "light") return false;
  return prefersDark;
}

export function applyNativeStatusBar(dark: boolean, bridge = nativeBridge()): void {
  if (!isNativeMobile(bridge)) return;
  // Capacitor's "Dark" style means light content for a dark background.
  invokeNative("StatusBar", "setStyle", { style: dark ? "DARK" : "LIGHT" }, bridge);
  invokeNative(
    "StatusBar",
    "setBackgroundColor",
    { color: dark ? STATUS_BAR_BACKGROUND.dark : STATUS_BAR_BACKGROUND.light },
    bridge,
  );
}

export type BackAction = "dismissed" | "back" | "exit";

/**
 * Android's back button walks the same hierarchy as Escape: close whatever is
 * on top, then go back through history, and only leave the app when there is
 * nothing left to close.
 */
export function resolveBackAction(dismissed: boolean, canGoBack: boolean): BackAction {
  if (dismissed) return "dismissed";
  return canGoBack ? "back" : "exit";
}

export type NativeShellOptions = {
  /** Close the topmost dismissible layer; true when something was closed. */
  dismissTopLayer: () => boolean;
  /**
   * Handle a link the operating system handed the shell. Resolving it to a
   * route is the caller's job (see applinks.ts), so this module stays free of
   * app routing and of any relative import.
   */
  onDeepLink: (url: string) => void;
};

/**
 * Wire the shell up to the app. Returns a teardown; on the web it is a no-op
 * because nothing was installed.
 */
export function installNativeShell(options: NativeShellOptions): () => void {
  const bridge = nativeBridge();
  const platform = nativePlatform(bridge);
  if (!platform || typeof document === "undefined") return () => {};

  const root = document.documentElement;
  root.setAttribute("data-native-platform", platform);

  let disposed = false;
  const route = (link: unknown) => {
    if (disposed) return;
    if (typeof link === "string" && link) options.onDeepLink(link);
  };

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const syncStatusBar = () => {
    applyNativeStatusBar(
      resolveDarkMode(root.getAttribute("data-color-mode"), media.matches),
      bridge,
    );
  };
  syncStatusBar();
  media.addEventListener("change", syncStatusBar);
  const colorModeObserver = new MutationObserver(syncStatusBar);
  colorModeObserver.observe(root, { attributeFilter: ["data-color-mode"] });

  // The iOS keyboard accessory bar has no use in a chat composer and reads as
  // a browser control rather than an app one.
  if (platform === "ios") {
    invokeNative("Keyboard", "setAccessoryBarVisible", { isVisible: false }, bridge);
  }

  const stopDeepLinks = listenNative("App", "appUrlOpen", (payload) => route(payload.url), bridge);
  const stopBackButton = listenNative(
    "App",
    "backButton",
    (payload) => {
      const action = resolveBackAction(options.dismissTopLayer(), payload.canGoBack === true);
      if (action === "back") window.history.back();
      else if (action === "exit") invokeNative("App", "exitApp", undefined, bridge);
    },
    bridge,
  );

  // A cold start from a notification has already spent its appUrlOpen event, so
  // the launch URL is the only way to reach that conversation — but only the
  // first time, and only while this shell is still the owner.
  const launchURL = launchURLClaimed ? undefined : pluginMethod(bridge, "App", "getLaunchUrl");
  if (launchURL) {
    launchURLClaimed = true;
    try {
      void Promise.resolve(launchURL() as Promise<{ url?: unknown } | undefined>)
        .then((result) => route(result?.url))
        .catch(() => {});
    } catch {
      // No launch URL is the normal case.
    }
  }

  return () => {
    disposed = true;
    media.removeEventListener("change", syncStatusBar);
    colorModeObserver.disconnect();
    stopDeepLinks();
    stopBackButton();
    root.removeAttribute("data-native-platform");
  };
}
