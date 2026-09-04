import {
  app,
  BaseWindow,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  screen,
  session,
  shell,
  Tray,
  WebContentsView,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents,
} from "electron";
import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseURIList, readClipboardImageFiles } from "./clipboard-uri";
import {
  appURL,
  clampUnreadCount,
  desktopPermissionAllowed,
  DESKTOP_AUTH_PROTOCOL,
  deepLinkToRoute,
  defaultSettings,
  desktopTitleBarOptions,
  desktopMainWindowNavigationAllowed,
  DESKTOP_SERVER_ORIGIN_ARG,
  DESKTOP_TITLEBAR_ARG,
  desktopOAuthCallbackCode,
  desktopOAuthStartURL,
  mergeSettings,
  hasIntegratedTitleBarCapability,
  isSafeClipboardPNG,
  LEGACY_DESKTOP_PROTOCOL,
  normalizeServerURL,
  safeAppRoute,
  sanitizeNotification,
  type DesktopSettings,
  type PublicDesktopSettings,
  type WindowState,
} from "./contract";
import { createLocalTerminalProcessFactory, TerminalSurface } from "./terminal-surface";

const PROTOCOLS = [LEGACY_DESKTOP_PROTOCOL, DESKTOP_AUTH_PROTOCOL] as const;
const SETTINGS_FILE = "desktop.json";
const APP_NAME = "ClickClack";
const MAX_CLIPBOARD_IMAGE_BYTES = 64 * 1024 * 1024;

let mainWindow: BaseWindow | null = null;
let applicationView: WebContentsView | null = null;
let terminalSurface: TerminalSurface | null = null;
let applicationReady = false;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let settings = defaultSettings();
let currentRoute = "/app";
let unreadCount = 0;
let quitting = false;
let routesReady = false;
let pendingRoute: string | null = null;
let pendingProtocolURL: string | null = null;
let pendingDesktopAuth: { serverUrl: string; verifier: string } | null = null;
let windowSaveTimer: NodeJS.Timeout | undefined;
let saveQueue = Promise.resolve();
let integratedTitleBar = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerProtocol();
  app.on("second-instance", (_event, commandLine) => {
    const link = protocolURLFromArgs(commandLine);
    if (link) handleProtocolURL(link);
    else openRouteWhenReady(currentRoute);
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleProtocolURL(url);
  });

  void app.whenReady().then(start);
}

async function start() {
  app.setName(APP_NAME);
  if (process.platform === "win32") app.setAppUserModelId("chat.clickclack.desktop");
  nativeTheme.themeSource = "system";
  settings = await readSettings();
  integratedTitleBar = await serverSupportsIntegratedTitleBar(settings.serverUrl);
  applyLoginItemSetting();
  registerIPC();
  secureSession();
  installDownloadHandling();
  createApplicationMenu();
  createTray();

  const startupLink = protocolURLFromArgs(process.argv);
  const initialRoute = pendingRoute ?? (startupLink ? deepLinkToRoute(startupLink) : null);
  pendingRoute = null;
  if (initialRoute) currentRoute = initialRoute;
  createMainWindow(currentRoute);
  nativeTheme.on("updated", refreshMainWindowTitleBar);
  routesReady = true;
  if (pendingProtocolURL) {
    const link = pendingProtocolURL;
    pendingProtocolURL = null;
    handleProtocolURL(link);
  } else if (startupLink && desktopOAuthCallbackCode(startupLink)) {
    handleProtocolURL(startupLink);
  }

  app.on("activate", () => showMainWindow());
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && (!settings.closeToTray || quitting)) app.quit();
  });
}

function registerProtocol() {
  for (const protocol of PROTOCOLS) {
    if (process.defaultApp && process.argv[1]) {
      app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1])]);
      continue;
    }
    app.setAsDefaultProtocolClient(protocol);
  }
}

function protocolURLFromArgs(args: readonly string[]): string | undefined {
  return args.find((argument) => PROTOCOLS.some((protocol) => argument.startsWith(`${protocol}:`)));
}

function createMainWindow(route = currentRoute): BaseWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const saved = visibleWindowState(settings.window);
  const window = new BaseWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#131419" : "#f7f3ed",
    height: saved.height ?? 860,
    icon: assetPath("icon.png"),
    minHeight: 560,
    minWidth: 760,
    show: false,
    title: APP_NAME,
    ...(integratedTitleBar
      ? desktopTitleBarOptions(process.platform, nativeTheme.shouldUseDarkColors)
      : {}),
    width: saved.width ?? 1280,
    ...(saved.x === undefined ? {} : { x: saved.x }),
    ...(saved.y === undefined ? {} : { y: saved.y }),
  });
  const appView = new WebContentsView({
    webPreferences: {
      additionalArguments: [
        `${DESKTOP_SERVER_ORIGIN_ARG}${normalizeServerURL(settings.serverUrl)}`,
        ...(integratedTitleBar ? [DESKTOP_TITLEBAR_ARG] : []),
      ],
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: distPath("app-preload.cjs"),
      sandbox: true,
      spellcheck: true,
      webSecurity: true,
    },
  });
  appView.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#131419" : "#f7f3ed");

  const terminalURL = pathToFileURL(resourcePath("terminal.html")).href;
  const terminalPartition = `clickclack-terminal-${randomBytes(12).toString("hex")}`;
  const terminalSession = session.fromPartition(terminalPartition, { cache: false });
  const localTerminalView = new WebContentsView({
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      partition: terminalPartition,
      preload: distPath("terminal-preload.cjs"),
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      webviewTag: false,
    },
  });
  localTerminalView.setBackgroundColor("#1f1d2e");
  secureTerminalView(localTerminalView.webContents, terminalSession, terminalURL);

  window.contentView.addChildView(appView);
  window.contentView.addChildView(localTerminalView);
  const surface = new TerminalSurface({
    applicationView: appView,
    createProcess: createLocalTerminalProcessFactory(
      process.platform,
      process.env,
      app.getPath("home"),
    ),
    integratedTitleBar,
    onOpenChanged: createApplicationMenu,
    platform: process.platform,
    readClipboard: () => clipboard.readText(),
    terminalURL,
    terminalView: localTerminalView,
    window,
    writeClipboard: (text) => clipboard.writeText(text),
  });
  appView.webContents.on("focus", createApplicationMenu);
  localTerminalView.webContents.on("focus", createApplicationMenu);
  localTerminalView.webContents.on("context-menu", () => {
    Menu.buildFromTemplate([
      { label: "Copy", click: () => surface.sendCommand("copy") },
      { label: "Paste", click: () => surface.sendCommand("paste") },
    ]).popup({ window });
  });

  mainWindow = window;
  applicationView = appView;
  terminalSurface = surface;
  applicationReady = false;
  configureWebContents(window, appView.webContents);
  createApplicationMenu();

  let applicationPresented = false;
  const presentApplication = () => {
    if (applicationPresented || mainWindow !== window || applicationView !== appView) return;
    applicationPresented = true;
    applicationReady = true;
    if (saved.maximized) window.maximize();
    surface.layout();
    window.show();
  };
  appView.webContents.once("did-finish-load", presentApplication);
  appView.webContents.once("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) presentApplication();
  });
  window.on("close", (event) => {
    rememberWindowState();
    if (!quitting && settings.closeToTray) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    surface.dispose();
    if (!appView.webContents.isDestroyed()) appView.webContents.close();
    if (mainWindow === window) {
      mainWindow = null;
      applicationView = null;
      terminalSurface = null;
      applicationReady = false;
    }
  });
  window.on("resize", () => {
    surface.layout();
    scheduleWindowStateSave();
  });
  window.on("move", scheduleWindowStateSave);
  window.on("maximize", () => {
    surface.layout();
    scheduleWindowStateSave();
  });
  window.on("unmaximize", () => {
    surface.layout();
    scheduleWindowStateSave();
  });
  appView.webContents.on("did-navigate", (_event, url) => {
    const parsed = routeFromServerURL(url);
    if (parsed) currentRoute = parsed;
  });
  appView.webContents.on("page-title-updated", (_event, title) => {
    window.setTitle(title || APP_NAME);
  });
  appView.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") void appView.webContents.reload();
  });
  void surface.load().catch((error) => console.error("Could not load terminal surface", error));
  void appView.webContents.loadURL(appURL(settings.serverUrl, route)).catch(presentApplication);
  return window;
}

function refreshMainWindowTitleBar() {
  if (!integratedTitleBar || !mainWindow || mainWindow.isDestroyed()) return;
  const overlay = desktopTitleBarOptions(
    process.platform,
    nativeTheme.shouldUseDarkColors,
  ).titleBarOverlay;
  if (overlay) mainWindow.setTitleBarOverlay(overlay);
}

async function serverSupportsIntegratedTitleBar(serverUrl: string): Promise<boolean> {
  try {
    const response = await net.fetch(appURL(serverUrl), {
      headers: { Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return false;
    return hasIntegratedTitleBarCapability(await responsePrefix(response));
  } catch {
    // Older or unavailable self-hosted renderers keep the native frame.
    return false;
  }
}

async function responsePrefix(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let result = "";
  let length = 0;
  try {
    while (length < 64 * 1024 && !result.includes("</head>")) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = 64 * 1024 - length;
      const chunk = value.subarray(0, remaining);
      result += decoder.decode(chunk, { stream: chunk.length === value.length });
      length += chunk.length;
      if (chunk.length < value.length) break;
    }
  } finally {
    await reader.cancel();
  }
  return result + decoder.decode();
}

function secureTerminalView(contents: WebContents, terminalSession: Session, terminalURL: string) {
  const allowedURLs = new Set([
    terminalURL,
    pathToFileURL(distPath("terminal-renderer.js")).href,
    pathToFileURL(distPath("terminal-renderer.css")).href,
  ]);
  terminalSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  terminalSession.setPermissionCheckHandler(() => false);
  terminalSession.on("will-download", (event, item) => {
    event.preventDefault();
    item.cancel();
  });
  terminalSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !allowedURLs.has(details.url) });
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (url !== terminalURL) event.preventDefault();
  });
  contents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame || event.url !== terminalURL) event.preventDefault();
  });
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame && url !== terminalURL) void contents.loadURL(terminalURL).catch(() => {});
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

function configureWebContents(window: BaseWindow, contents: WebContents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isGitHubLoginStartURL(url)) {
      void beginDesktopOAuth();
    } else if (isAllowedMainWindowURL(url)) {
      void contents.loadURL(url);
    } else if (isExternalURL(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  contents.on("will-navigate", guardMainFrameNavigation);
  contents.on("will-redirect", guardMainFrameNavigation);
  contents.on("context-menu", (_event, params) => {
    const template: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        template.push({
          label: suggestion,
          click: () => contents.replaceMisspelling(suggestion),
        });
      }
      if (template.length > 0) template.push({ type: "separator" });
      template.push({
        label: `Learn “${params.misspelledWord}”`,
        click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
    }
    if (params.isEditable) {
      if (template.length > 0) template.push({ type: "separator" });
      template.push(
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      );
    } else if (params.selectionText) {
      // The native copy role writes both text/plain and text/html flavors, so a
      // pasted message arrives with the rendered markup translated back into
      // markdown: backticks around code spans and percent-encoded href values
      // instead of the link text. Write the plain selection ourselves so the
      // clipboard carries exactly what is on screen.
      template.push(
        {
          label: "Copy",
          click: () => clipboard.writeText(params.selectionText),
        },
        { role: "selectAll" },
      );
    }
    if (params.linkURL && isExternalURL(params.linkURL)) {
      if (template.length > 0) template.push({ type: "separator" });
      template.push({
        label: "Open Link in Browser",
        click: () => void shell.openExternal(params.linkURL),
      });
    }
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window });
  });
}

function guardMainFrameNavigation(
  event: Electron.Event,
  url: string,
  _isInPlace: boolean,
  isMainFrame: boolean,
) {
  if (!isMainFrame) return;
  if (isGitHubLoginStartURL(url)) {
    event.preventDefault();
    void beginDesktopOAuth();
    return;
  }
  if (isAllowedMainWindowURL(url)) {
    return;
  }
  event.preventDefault();
  if (url.startsWith(`${LEGACY_DESKTOP_PROTOCOL}://`)) {
    openRoute(deepLinkToRoute(url));
  } else if (isExternalURL(url)) {
    void shell.openExternal(url);
  }
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  const window = new BrowserWindow({
    backgroundColor: "#17110f",
    height: 720,
    icon: assetPath("icon.png"),
    maximizable: false,
    minHeight: 640,
    minWidth: 620,
    parent: mainWindow ?? undefined,
    resizable: true,
    show: false,
    title: "ClickClack Desktop Settings",
    width: 680,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: distPath("settings-preload.cjs"),
      sandbox: true,
      webSecurity: true,
    },
  });
  settingsWindow = window;
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    settingsWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void window.loadFile(resourcePath("settings.html"));
}

function registerIPC() {
  ipcMain.handle("desktop:notify", (event, input) => {
    if (!isMainSender(event)) return false;
    const payload = sanitizeNotification(input);
    if (!payload || !Notification.isSupported()) return false;
    const notification = new Notification({
      body: payload.body,
      icon: assetPath("icon.png"),
      silent: false,
      title: payload.title,
    });
    notification.on("click", () => openRoute(payload.route ?? currentRoute));
    notification.show();
    return true;
  });
  ipcMain.on("desktop:set-unread", (event, input) => {
    if (!isMainSender(event)) return;
    setUnreadCount(clampUnreadCount(input));
  });
  ipcMain.on("desktop:set-active-route", (event, input) => {
    if (!isMainSender(event) || typeof input !== "string") return;
    const route = safeAppRoute(input);
    if (route) currentRoute = route;
  });
  ipcMain.on("desktop:open-settings", (event) => {
    if (isMainSender(event)) createSettingsWindow();
  });
  ipcMain.on("desktop:terminal-toggle", (event) => {
    if (isMainSender(event)) terminalSurface?.toggle();
  });
  ipcMain.handle("desktop:sign-in-with-github", async (event) => {
    if (!isMainSender(event)) return false;
    await beginDesktopOAuth();
    return true;
  });
  ipcMain.handle("desktop:read-clipboard", async (event) => {
    if (!isMainSender(event)) return null;
    const uriFormat = clipboard
      .availableFormats()
      .find((format) => format.toLowerCase().split(";", 1)[0] === "text/uri-list");
    const uriList = uriFormat ? clipboard.read(uriFormat) : "";
    const hasLocalFileURI = parseURIList(uriList).length > 0;
    const files = hasLocalFileURI ? await readClipboardImageFiles(uriList) : [];
    return {
      files,
      hasImage: files.length === 0 && !clipboard.readImage().isEmpty(),
      text: hasLocalFileURI ? "" : clipboard.readText(),
    };
  });
  ipcMain.on("desktop:paste-native", (event) => {
    if (isMainSender(event)) event.sender.paste();
  });
  ipcMain.handle("desktop:write-clipboard-image", (event, input) => {
    if (
      !isMainSender(event) ||
      !(input instanceof ArrayBuffer) ||
      input.byteLength === 0 ||
      input.byteLength > MAX_CLIPBOARD_IMAGE_BYTES ||
      !isSafeClipboardPNG(input)
    ) {
      return false;
    }
    const image = nativeImage.createFromBuffer(Buffer.from(input));
    if (image.isEmpty()) return false;
    clipboard.writeImage(image);
    return true;
  });
  ipcMain.handle("desktop:write-clipboard-text", (event, input) => {
    if (!isMainSender(event) || typeof input !== "string") return false;
    clipboard.writeText(input);
    return true;
  });
  ipcMain.handle(
    "desktop:terminal-presentation",
    (event) => terminalSurface?.presentation(event) ?? null,
  );
  ipcMain.on("desktop:terminal-hide", (event) => terminalSurface?.requestHide(event));
  ipcMain.handle(
    "desktop:terminal-start",
    (event) => terminalSurface?.start(event) ?? terminalRequestRejected(),
  );
  ipcMain.handle(
    "desktop:terminal-status",
    (event) => terminalSurface?.status(event) ?? terminalRequestRejected(),
  );
  ipcMain.on("desktop:terminal-write", (event, input) => terminalSurface?.write(event, input));
  ipcMain.on("desktop:terminal-resize", (event, input) => terminalSurface?.resize(event, input));
  ipcMain.on("desktop:terminal-resize-dock", (event, input) =>
    terminalSurface?.resizeDock(event, input),
  );
  ipcMain.on("desktop:terminal-output-ready", (event) => terminalSurface?.outputReady(event));
  ipcMain.on("desktop:terminal-output-ack", (event, input) =>
    terminalSurface?.acknowledgeOutput(event, input),
  );
  ipcMain.handle(
    "desktop:terminal-terminate",
    (event) => terminalSurface?.terminate(event) ?? terminalRequestRejected(),
  );
  ipcMain.handle(
    "desktop:terminal-read-clipboard",
    (event) => terminalSurface?.readClipboard(event) ?? null,
  );
  ipcMain.handle(
    "desktop:terminal-write-clipboard",
    (event, input) => terminalSurface?.writeClipboard(event, input) ?? false,
  );

  ipcMain.handle("settings:get", (event) => {
    requireSettingsSender(event.sender.id);
    return settingsInfo();
  });
  ipcMain.handle("settings:test-server", async (event, input) => {
    requireSettingsSender(event.sender.id);
    const serverUrl = normalizeServerURL(String(input ?? ""));
    try {
      const response = await net.fetch(appURL(serverUrl), {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      if (response.status >= 500) {
        return { detail: `Server answered with HTTP ${response.status}`, ok: false, serverUrl };
      }
      return { detail: `ClickClack answered on ${new URL(serverUrl).host}`, ok: true, serverUrl };
    } catch (error) {
      return {
        detail: error instanceof Error ? error.message : "Could not reach this server",
        ok: false,
        serverUrl,
      };
    }
  });
  ipcMain.handle("settings:save", async (event, input: PublicDesktopSettings) => {
    requireSettingsSender(event.sender.id);
    const next = mergeSettings({
      ...settings,
      ...input,
      serverUrl: normalizeServerURL(input.serverUrl),
    });
    settings = next;
    await persistSettings();
    integratedTitleBar = await serverSupportsIntegratedTitleBar(settings.serverUrl);
    applyLoginItemSetting();
    currentRoute = "/app";
    if (mainWindow && !mainWindow.isDestroyed()) {
      rememberWindowState();
      const previousWindow = mainWindow;
      mainWindow = null;
      previousWindow.destroy();
      createMainWindow();
    } else {
      createMainWindow();
    }
    setTimeout(() => settingsWindow?.close(), 350);
    return settingsInfo();
  });
}

function terminalRequestRejected() {
  return { state: "error", message: "Terminal request rejected" };
}

function settingsInfo() {
  return {
    closeToTray: settings.closeToTray,
    platform: process.platform,
    serverUrl: settings.serverUrl,
    startAtLogin: settings.startAtLogin,
    supportsAutoLaunch: process.platform === "darwin" || process.platform === "win32",
    version: app.getVersion(),
  };
}

function isMainSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    applicationView &&
    !applicationView.webContents.isDestroyed() &&
    applicationView.webContents.id === event.sender.id &&
    event.senderFrame === applicationView.webContents.mainFrame &&
    isSameServerURL(event.senderFrame.url),
  );
}

function requireSettingsSender(id: number) {
  if (!settingsWindow || settingsWindow.isDestroyed() || settingsWindow.webContents.id !== id) {
    throw new Error("Settings request rejected");
  }
}

function secureSession() {
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const securityOrigin =
        "securityOrigin" in details && details.securityOrigin
          ? details.securityOrigin
          : webContents.getURL();
      const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      callback(
        Boolean(
          mainWindow &&
          applicationView &&
          !mainWindow.isDestroyed() &&
          applicationView.webContents.id === webContents.id &&
          desktopPermissionAllowed(permission, securityOrigin, settings.serverUrl, mediaTypes),
        ),
      );
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      Boolean(
        mainWindow &&
        applicationView &&
        webContents &&
        !mainWindow.isDestroyed() &&
        applicationView.webContents.id === webContents.id &&
        desktopPermissionAllowed(
          permission,
          details.securityOrigin ?? requestingOrigin,
          settings.serverUrl,
          details.mediaType ? [details.mediaType] : [],
        ),
      ),
  );
}

function installDownloadHandling() {
  session.defaultSession.on("will-download", (_event, item) => {
    item.once("done", (_doneEvent, state) => {
      if (state !== "completed" || !Notification.isSupported()) return;
      const filePath = item.getSavePath();
      const notification = new Notification({
        body: path.basename(filePath),
        icon: assetPath("icon.png"),
        title: "Download complete",
      });
      notification.on("click", () => shell.showItemInFolder(filePath));
      notification.show();
    });
  });
}

function createApplicationMenu() {
  const terminalFocused = terminalSurface?.isFocused() ?? false;
  const editItems: MenuItemConstructorOptions[] = terminalFocused
    ? [
        {
          label: "Copy",
          accelerator: process.platform === "darwin" ? "Cmd+C" : "Ctrl+Shift+C",
          click: () => terminalSurface?.sendCommand("copy"),
        },
        {
          label: "Paste",
          accelerator: process.platform === "darwin" ? "Cmd+V" : "Ctrl+Shift+V",
          click: () => terminalSurface?.sendCommand("paste"),
        },
      ]
    : [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ];
  const template: MenuItemConstructorOptions[] = [];
  if (process.platform === "darwin") {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: createSettingsWindow },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }
  template.push(
    {
      label: "File",
      submenu: [
        { label: "Quick Compose", accelerator: "CmdOrCtrl+Shift+K", click: quickCompose },
        ...(process.platform === "darwin"
          ? []
          : [
              { type: "separator" as const },
              { label: "Settings…", accelerator: "CmdOrCtrl+,", click: createSettingsWindow },
              { type: "separator" as const },
              { role: "quit" as const },
            ]),
      ],
    },
    { label: "Edit", submenu: editItems },
    {
      label: "View",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => applicationView?.webContents.reload(),
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => applicationView?.webContents.reloadIgnoringCache(),
        },
        { type: "separator" },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          click: () => applicationView?.webContents.setZoomLevel(0),
        },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+Plus",
          click: () => changeApplicationZoom(0.5),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => changeApplicationZoom(-0.5),
        },
        { type: "separator" },
        {
          label: "Toggle Terminal",
          accelerator: "CmdOrCtrl+J",
          click: () => terminalSurface?.toggle(),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }] },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function changeApplicationZoom(delta: number) {
  const contents = applicationView?.webContents;
  if (!contents) return;
  contents.setZoomLevel(Math.max(-3, Math.min(3, contents.getZoomLevel() + delta)));
}

function createTray() {
  const image = nativeImage.createFromPath(
    assetPath(process.platform === "darwin" ? "trayTemplate.png" : "icon.png"),
  );
  if (process.platform === "darwin") image.setTemplateImage(true);
  tray = new Tray(image.resize({ height: process.platform === "darwin" ? 18 : 20 }));
  tray.setToolTip(APP_NAME);
  tray.on("click", showMainWindow);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const label =
    unreadCount === 0
      ? "No unread messages"
      : `${unreadCount} unread ${unreadCount === 1 ? "message" : "messages"}`;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open ClickClack", click: showMainWindow },
      { label: "Quick Compose", accelerator: "CmdOrCtrl+Shift+K", click: quickCompose },
      { type: "separator" },
      { enabled: false, label },
      { label: "Settings…", click: createSettingsWindow },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  if (process.platform === "darwin") tray.setTitle(unreadCount > 0 ? String(unreadCount) : "");
}

function setUnreadCount(next: number) {
  if (unreadCount === next) return;
  unreadCount = next;
  app.setBadgeCount(next);
  if (mainWindow && process.platform === "win32") {
    const overlay = next > 0 ? nativeImage.createFromPath(assetPath("unread-badge.png")) : null;
    mainWindow.setOverlayIcon(overlay, next > 0 ? `${next} unread messages` : "");
  }
  updateTrayMenu();
}

function quickCompose() {
  terminalSurface?.hide();
  showMainWindow();
  applicationView?.webContents.focus();
  applicationView?.webContents.send("desktop:quick-compose");
}

function showMainWindow() {
  const window = mainWindow ?? createMainWindow();
  if (!applicationReady) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function openRoute(route: string | null | undefined) {
  const safeRoute = safeAppRoute(route ?? "") ?? "/app";
  currentRoute = safeRoute;
  if (!mainWindow) createMainWindow(safeRoute);
  showMainWindow();
  const contents = applicationView?.webContents;
  if (!contents) return;
  if (!isSameServerURL(contents.getURL())) {
    void contents.loadURL(appURL(settings.serverUrl, safeRoute));
    return;
  }
  if (contents.isLoading()) {
    contents.once("did-finish-load", () => contents.send("desktop:navigate", safeRoute));
  } else {
    contents.send("desktop:navigate", safeRoute);
  }
}

function handleProtocolURL(input: string) {
  const authCode = desktopOAuthCallbackCode(input);
  if (authCode) {
    if (!routesReady) {
      pendingProtocolURL = input;
      return;
    }
    void completeDesktopOAuth(authCode);
    return;
  }
  openRouteWhenReady(deepLinkToRoute(input));
}

async function beginDesktopOAuth() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const serverUrl = normalizeServerURL(settings.serverUrl);
  pendingDesktopAuth = { serverUrl, verifier };
  showMainWindow();
  try {
    await shell.openExternal(desktopOAuthStartURL(serverUrl, challenge));
  } catch (error) {
    pendingDesktopAuth = null;
    throw error;
  }
}

async function completeDesktopOAuth(code: string) {
  const pending = pendingDesktopAuth;
  if (!pending || pending.serverUrl !== normalizeServerURL(settings.serverUrl)) {
    await showDesktopAuthError("This sign-in request expired. Start again from ClickClack.");
    return;
  }
  try {
    const response = await session.defaultSession.fetch(
      new URL("/api/auth/github/desktop/consume", pending.serverUrl).toString(),
      {
        body: JSON.stringify({ code, code_verifier: pending.verifier }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-ClickClack-CSRF": "1",
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
    await response.arrayBuffer();
    const meResponse = await session.defaultSession.fetch(
      new URL("/api/me", pending.serverUrl).toString(),
      {
        credentials: "include",
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!meResponse.ok) {
      throw new Error(`Server did not establish a desktop session (HTTP ${meResponse.status})`);
    }
    await meResponse.arrayBuffer();
    pendingDesktopAuth = null;
    currentRoute = "/app";
    if (!mainWindow) createMainWindow(currentRoute);
    const contents = applicationView?.webContents;
    if (!contents) throw new Error("Application view is unavailable");
    await contents.loadURL(appURL(pending.serverUrl, currentRoute));
    showMainWindow();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown authentication error";
    await showDesktopAuthError(`GitHub sign-in could not be completed. ${detail}`);
  }
}

async function showDesktopAuthError(message: string) {
  const options: Electron.MessageBoxOptions = {
    message,
    title: "ClickClack sign-in failed",
    type: "error",
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    await dialog.showMessageBox(mainWindow, options);
  } else {
    await dialog.showMessageBox(options);
  }
}

function openRouteWhenReady(route: string | null | undefined) {
  const safeRoute = safeAppRoute(route ?? "") ?? "/app";
  if (!routesReady) {
    pendingRoute = safeRoute;
    return;
  }
  openRoute(safeRoute);
}

function routeFromServerURL(input: string): string | null {
  try {
    const value = new URL(input);
    if (value.origin !== normalizeServerURL(settings.serverUrl)) return null;
    return safeAppRoute(`${value.pathname}${value.search}${value.hash}`);
  } catch {
    return null;
  }
}

function isSameServerURL(input: string): boolean {
  try {
    return new URL(input).origin === normalizeServerURL(settings.serverUrl);
  } catch {
    return false;
  }
}

function isAllowedMainWindowURL(input: string): boolean {
  return desktopMainWindowNavigationAllowed(input, settings.serverUrl, integratedTitleBar);
}

function isGitHubLoginStartURL(input: string): boolean {
  try {
    const value = new URL(input);
    return (
      value.origin === normalizeServerURL(settings.serverUrl) &&
      value.pathname === "/api/auth/github/start"
    );
  } catch {
    return false;
  }
}

function isExternalURL(input: string): boolean {
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(input).protocol);
  } catch {
    return false;
  }
}

function visibleWindowState(saved: WindowState | undefined): WindowState {
  if (
    !saved ||
    saved.x === undefined ||
    saved.y === undefined ||
    saved.width === undefined ||
    saved.height === undefined
  ) {
    return saved ?? {};
  }
  const bounds = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  const display = screen.getDisplayMatching(bounds);
  const intersects =
    display.workArea.x < bounds.x + bounds.width &&
    display.workArea.x + display.workArea.width > bounds.x &&
    display.workArea.y < bounds.y + bounds.height &&
    display.workArea.y + display.workArea.height > bounds.y;
  return intersects
    ? saved
    : { height: saved.height, maximized: saved.maximized, width: saved.width };
}

function scheduleWindowStateSave() {
  if (windowSaveTimer) clearTimeout(windowSaveTimer);
  windowSaveTimer = setTimeout(rememberWindowState, 300);
}

function rememberWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getNormalBounds();
  settings = {
    ...settings,
    window: {
      height: bounds.height,
      maximized: mainWindow.isMaximized(),
      width: bounds.width,
      x: bounds.x,
      y: bounds.y,
    },
  };
  void persistSettings();
}

function applyLoginItemSetting() {
  if (!app.isPackaged || (process.platform !== "darwin" && process.platform !== "win32")) return;
  app.setLoginItemSettings({ openAtLogin: settings.startAtLogin });
}

async function readSettings(): Promise<DesktopSettings> {
  try {
    return mergeSettings(JSON.parse(await readFile(settingsPath(), "utf8")));
  } catch {
    return defaultSettings();
  }
}

function persistSettings(): Promise<void> {
  const snapshot = JSON.stringify(settings, null, 2) + "\n";
  const destination = settingsPath();
  const temporary = `${destination}.tmp`;
  const operation = saveQueue.then(async () => {
    await writeFile(temporary, snapshot, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  });
  saveQueue = operation.catch(logSettingsError);
  return operation;
}

function logSettingsError(error: unknown) {
  console.error("Could not save desktop settings", error);
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

function distPath(name: string): string {
  return path.join(__dirname, name);
}

function assetPath(name: string): string {
  return path.join(__dirname, "..", "assets", name);
}

function resourcePath(name: string): string {
  return path.join(__dirname, "..", "resources", name);
}

process.on("uncaughtException", (error) => {
  console.error(error);
  if (app.isReady()) void dialog.showErrorBox("ClickClack desktop error", error.message);
});
