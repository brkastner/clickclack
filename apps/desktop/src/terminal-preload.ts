import { contextBridge, ipcRenderer } from "electron";
import {
  isDesktopTerminalData,
  isDesktopTerminalStatus,
  normalizeTerminalDimensions,
  sanitizeTerminalInput,
  type DesktopTerminalStatus,
} from "./contract";
import type { TerminalClient } from "./terminal-dock";
import type { TerminalPresentation } from "./terminal-surface";

async function invokeTerminalStatus(channel: string): Promise<DesktopTerminalStatus> {
  const status: unknown = await ipcRenderer.invoke(channel);
  if (!isDesktopTerminalStatus(status)) throw new Error("Invalid terminal status from desktop");
  return status;
}

const terminalClient: TerminalClient = Object.freeze({
  platform: process.platform,
  start: () => invokeTerminalStatus("desktop:terminal-start"),
  status: () => invokeTerminalStatus("desktop:terminal-status"),
  write: (data) => {
    const payload = sanitizeTerminalInput(data);
    if (payload !== null) ipcRenderer.send("desktop:terminal-write", payload);
  },
  resize: (dimensions) => {
    const payload = normalizeTerminalDimensions(dimensions);
    if (payload) ipcRenderer.send("desktop:terminal-resize", payload);
  },
  terminate: () => invokeTerminalStatus("desktop:terminal-terminate"),
  outputReady: () => ipcRenderer.send("desktop:terminal-output-ready"),
  close: () => ipcRenderer.send("desktop:terminal-hide"),
  presentation: async () => {
    const presentation: unknown = await ipcRenderer.invoke("desktop:terminal-presentation");
    if (!isTerminalPresentation(presentation)) throw new Error("Invalid terminal presentation");
    return presentation;
  },
  readClipboard: async () => {
    const text: unknown = await ipcRenderer.invoke("desktop:terminal-read-clipboard");
    return typeof text === "string" && sanitizeTerminalInput(text) !== null ? text : null;
  },
  writeClipboard: (text) => {
    const payload = sanitizeTerminalInput(text);
    return payload === null
      ? Promise.resolve(false)
      : ipcRenderer.invoke("desktop:terminal-write-clipboard", payload);
  },
  onCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, command: unknown) => {
      if (command === "copy" || command === "paste") callback(command);
    };
    ipcRenderer.on("desktop:terminal-command", listener);
    return () => ipcRenderer.removeListener("desktop:terminal-command", listener);
  },
  onData: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, input: unknown) => {
      if (!isDesktopTerminalData(input)) return;
      let acknowledged = false;
      callback(input.data, () => {
        if (acknowledged) return;
        acknowledged = true;
        ipcRenderer.send("desktop:terminal-output-ack", input.sequence);
      });
    };
    ipcRenderer.on("desktop:terminal-data", listener);
    return () => ipcRenderer.removeListener("desktop:terminal-data", listener);
  },
  onPresentation: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, input: unknown) => {
      if (isTerminalPresentation(input)) callback(input);
    };
    ipcRenderer.on("desktop:terminal-presentation", listener);
    return () => ipcRenderer.removeListener("desktop:terminal-presentation", listener);
  },
  onStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => {
      if (isDesktopTerminalStatus(status)) callback(status);
    };
    ipcRenderer.on("desktop:terminal-status", listener);
    return () => ipcRenderer.removeListener("desktop:terminal-status", listener);
  },
});

contextBridge.exposeInMainWorld("clickclackTerminal", terminalClient);

function isTerminalPresentation(input: unknown): input is TerminalPresentation {
  return Boolean(
    input &&
    typeof input === "object" &&
    typeof (input as Record<string, unknown>).open === "boolean",
  );
}
