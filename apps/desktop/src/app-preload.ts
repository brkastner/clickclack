import { contextBridge, ipcRenderer } from "electron";
import {
  DESKTOP_SERVER_ORIGIN_ARG,
  DESKTOP_TITLEBAR_ARG,
  desktopBridgeAllowed,
  desktopPasteAction,
  type DesktopNotification,
} from "./contract";

export type DesktopClipboardFile = {
  bytes: Uint8Array;
  name: string;
  type: string;
};

export type DesktopPasteTarget = "composer";

export type ClickClackDesktopBridge = {
  integratedTitleBar: boolean;
  notify(notification: DesktopNotification): Promise<boolean>;
  onNavigate(callback: (route: string) => void): () => void;
  onPasteFiles(
    target: DesktopPasteTarget,
    callback: (files: DesktopClipboardFile[]) => void,
  ): () => void;
  onPasteText(callback: (text: string) => void): () => void;
  onQuickCompose(callback: () => void): () => void;
  openSettings(): void;
  platform: NodeJS.Platform;
  setActiveRoute(route: string): void;
  setUnreadCount(count: number): void;
  signInWithGitHub(): Promise<boolean>;
  toggleTerminal(): void;
  writeClipboardImage(png: ArrayBuffer): Promise<boolean>;
  writeClipboardText(text: string): Promise<boolean>;
};

const pasteFileCallbacks = new Map<
  DesktopPasteTarget,
  Set<(files: DesktopClipboardFile[]) => void>
>();
const pasteTextCallbacks = new Set<(text: string) => void>();
let allowNextNativePaste = false;

function requestNativePaste() {
  allowNextNativePaste = true;
  ipcRenderer.send("desktop:paste-native");
}

async function deliverDesktopPaste(target: DesktopPasteTarget) {
  let payload: unknown;
  try {
    payload = await ipcRenderer.invoke("desktop:read-clipboard");
  } catch {
    requestNativePaste();
    return;
  }
  const action = desktopPasteAction(payload);
  if (!action) {
    requestNativePaste();
    return;
  }
  if (action.kind === "files") {
    for (const callback of pasteFileCallbacks.get(target) ?? []) {
      callback(action.files as DesktopClipboardFile[]);
    }
    return;
  }
  if (action.kind === "image") {
    requestNativePaste();
    return;
  }
  for (const callback of pasteTextCallbacks) callback(action.text);
}

function pasteTarget(target: EventTarget | null): DesktopPasteTarget | null {
  if (!(target instanceof Element)) return null;
  return target.closest(".composer-editor__content") ? "composer" : null;
}

function selectedText(target: EventTarget | null): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? start;
    return target.value.slice(start, end);
  }
  return globalThis.getSelection()?.toString() ?? "";
}

function installDesktopClipboardHandling() {
  globalThis.addEventListener(
    "keydown",
    (event) => {
      const target = pasteTarget(event.target);
      if (
        !event.isTrusted ||
        !target ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.key.toLowerCase() !== "v"
      ) {
        return;
      }
      event.preventDefault();
      void deliverDesktopPaste(target);
    },
    true,
  );
  globalThis.addEventListener(
    "copy",
    (event) => {
      if (!event.isTrusted) return;
      const text = selectedText(event.target);
      if (!text) return;
      event.preventDefault();
      void ipcRenderer.invoke("desktop:write-clipboard-text", text);
    },
    true,
  );
  globalThis.addEventListener(
    "paste",
    (event) => {
      if (allowNextNativePaste) {
        allowNextNativePaste = false;
        return;
      }
      const target = pasteTarget(event.target);
      if (!event.isTrusted || !target) return;
      const hasImage = Array.from(event.clipboardData?.items ?? []).some(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
      if (hasImage) return;
      event.preventDefault();
      void deliverDesktopPaste(target);
    },
    true,
  );
}

const bridge: ClickClackDesktopBridge = {
  integratedTitleBar: process.argv.includes(DESKTOP_TITLEBAR_ARG),
  platform: process.platform,
  notify: (notification) => ipcRenderer.invoke("desktop:notify", notification),
  setUnreadCount: (count) => ipcRenderer.send("desktop:set-unread", count),
  setActiveRoute: (route) => ipcRenderer.send("desktop:set-active-route", route),
  signInWithGitHub: () => ipcRenderer.invoke("desktop:sign-in-with-github"),
  toggleTerminal: () => ipcRenderer.send("desktop:terminal-toggle"),
  writeClipboardImage: (png) => ipcRenderer.invoke("desktop:write-clipboard-image", png),
  writeClipboardText: (text) => ipcRenderer.invoke("desktop:write-clipboard-text", text),
  openSettings: () => ipcRenderer.send("desktop:open-settings"),
  onNavigate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, route: string) => callback(route);
    ipcRenderer.on("desktop:navigate", listener);
    return () => ipcRenderer.removeListener("desktop:navigate", listener);
  },
  onPasteFiles: (target, callback) => {
    let callbacks = pasteFileCallbacks.get(target);
    if (!callbacks) {
      callbacks = new Set();
      pasteFileCallbacks.set(target, callbacks);
    }
    callbacks.add(callback);
    return () => {
      callbacks?.delete(callback);
      if (callbacks?.size === 0) pasteFileCallbacks.delete(target);
    };
  },
  onPasteText: (callback) => {
    pasteTextCallbacks.add(callback);
    return () => pasteTextCallbacks.delete(callback);
  },
  onQuickCompose: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("desktop:quick-compose", listener);
    return () => ipcRenderer.removeListener("desktop:quick-compose", listener);
  },
};

const trustedOrigin = process.argv
  .find((argument) => argument.startsWith(DESKTOP_SERVER_ORIGIN_ARG))
  ?.slice(DESKTOP_SERVER_ORIGIN_ARG.length);

if (desktopBridgeAllowed(globalThis.location.origin, trustedOrigin)) {
  installDesktopClipboardHandling();
  contextBridge.exposeInMainWorld("clickclackDesktop", Object.freeze(bridge));
}
