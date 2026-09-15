/// <reference types="vite/client" />

import type { ClickClackDesktopBridge } from "./lib/desktop";
import type { NativeBridge } from "./lib/native";

declare global {
  interface Window {
    Capacitor?: NativeBridge;
    clickclackDesktop?: ClickClackDesktopBridge;
  }
}

export {};
