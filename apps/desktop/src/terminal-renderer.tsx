import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { mountTerminalDock, type TerminalClient } from "./terminal-dock";

declare global {
  interface Window {
    clickclackTerminal?: TerminalClient;
  }
}

const root = document.getElementById("terminal-root");
const client = window.clickclackTerminal;
if (!root || !client) throw new Error("Terminal surface is unavailable");
mountTerminalDock(root, client);
