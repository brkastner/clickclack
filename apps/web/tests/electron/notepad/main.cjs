const { app, BrowserWindow } = require("electron");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const profile = mkdtempSync(join(tmpdir(), "clickclack-notepad-"));
app.setPath("userData", profile);
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1100,
    height: 850,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.loadURL("about:blank");
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => rmSync(profile, { recursive: true, force: true }));
