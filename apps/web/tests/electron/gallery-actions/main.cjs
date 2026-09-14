const { app, BrowserWindow } = require("electron");
const option = (name, fallback) => {
  const value = process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split("=")[1];
  return Number(value || fallback);
};
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: option("gallery-width", 1100),
    height: option("gallery-height", 800),
    show: true,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.loadURL("about:blank");
});
app.on("window-all-closed", () => app.quit());
