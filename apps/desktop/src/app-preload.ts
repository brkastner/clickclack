import { contextBridge, ipcRenderer } from "electron";
import {
  DESKTOP_SERVER_ORIGIN_ARG,
  DESKTOP_TITLEBAR_ARG,
  desktopBridgeAllowed,
  type DesktopNotification,
} from "./contract";

export type ClickClackDesktopBridge = {
  integratedTitleBar: boolean;
  notify(notification: DesktopNotification): Promise<boolean>;
  onNavigate(callback: (route: string) => void): () => void;
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

const pasteTextCallbacks = new Set<(text: string) => void>();

async function deliverDesktopPaste() {
  let payload: unknown;
  try {
    payload = await ipcRenderer.invoke("desktop:read-clipboard");
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object") return;
  const { hasImage, text } = payload as { hasImage?: unknown; text?: unknown };
  if (hasImage === true) {
    ipcRenderer.send("desktop:paste-native");
    return;
  }
  if (typeof text !== "string" || !text) return;
  for (const callback of pasteTextCallbacks) callback(text);
}

function isComposerTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(".composer-editor__content"));
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
      if (
        !event.isTrusted ||
        !isComposerTarget(event.target) ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.key.toLowerCase() !== "v"
      ) {
        return;
      }
      event.preventDefault();
      void deliverDesktopPaste();
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
      if (!event.isTrusted || !isComposerTarget(event.target)) return;
      const hasImage = Array.from(event.clipboardData?.items ?? []).some(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
      if (hasImage) return;
      event.preventDefault();
      void deliverDesktopPaste();
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
