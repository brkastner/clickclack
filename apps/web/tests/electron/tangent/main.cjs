const { app, BrowserWindow } = require("electron");
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1500, height: 900, useContentSize: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.loadURL("about:blank");
});
app.on("window-all-closed", () => app.quit());
