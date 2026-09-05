import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const bundle = fileURLToPath(new URL("../.test/main.cjs", import.meta.url));
export const A = "http://127.0.0.1:19720";
export const B = "http://127.0.0.1:19721";
export const C = "http://127.0.0.1:19722";

export function deferred() {
  return Promise.withResolvers();
}

export async function settle() {
  for (let i = 0; i < 5; i++) await setImmediate();
}

export async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await setImmediate();
  }
  assert.fail("Desktop did not reach the expected observable state");
}

// Run the real main entry point; replace only Electron and controllable I/O.
// Programmatic loadURL does not emit will-navigate (Electron's navigation contract).
export async function desktop(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clickclack-main-"));
  let pendingIO = 0;
  const trackIO = async (operation) => {
    pendingIO++;
    try {
      return await operation();
    } finally {
      pendingIO--;
    }
  };
  const idle = async () => {
    await settle();
    await until(() => pendingIO === 0);
    await settle();
  };
  t.after(async () => {
    await idle();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const destination = path.join(directory, "desktop.json");
  await fs.writeFile(destination, JSON.stringify({ serverUrl: A, closeToTray: true }));
  const windows = [];
  const errors = [];
  const logs = [];
  const badges = [];
  const browserURLs = [];
  const requests = [];
  const handlers = new Map();
  const timers = new Map();
  const ready = deferred();
  const app = new EventEmitter();
  Object.assign(app, {
    requestSingleInstanceLock: () => true,
    setAsDefaultProtocolClient() {},
    whenReady: () => ready.promise,
    setName() {},
    setAppUserModelId() {},
    getPath: () => directory,
    getVersion: () => "0.0.0-test",
    isPackaged: false,
    isReady: () => true,
    setBadgeCount: (count) => badges.push(count),
  });
  const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, handler) => handlers.set(channel, handler);
  const controls = {
    probe: async () => new Response("<html><head></head></html>"),
    fetch: async () => new Response("{}"),
    openExternal: async () => {},
    writeFile: fs.writeFile,
    rename: fs.rename,
  };
  let nextContentsID = 1;
  let focusedContents;
  class Contents extends EventEmitter {
    constructor() {
      super();
      this.id = nextContentsID++;
      this.destroyed = false;
      this.loads = [];
      this.messages = [];
      this.mainFrame = { url: "" };
    }
    setWindowOpenHandler(handler) {
      this.openWindow = handler;
    }
    getURL() {
      return this.mainFrame.url;
    }
    isLoading() {
      return false;
    }
    isDestroyed() {
      return this.destroyed;
    }
    close() {
      this.destroyed = true;
    }
    focus() {
      focusedContents = this;
      this.emit("focus");
    }
    isFocused() {
      return focusedContents === this;
    }
    send(...args) {
      this.messages.push(args);
    }
    sendInputEvent() {}
    async loadURL(url) {
      assert.equal(this.destroyed, false, "Cannot navigate destroyed web contents");
      this.loads.push(url);
      this.mainFrame.url = url;
      this.emit("did-navigate", {}, url);
      if (this.navigation) await this.navigation.promise;
      this.emit("did-finish-load");
    }
  }
  class View {
    constructor(options) {
      this.options = options;
      this.webContents = new Contents();
    }
    setBackgroundColor() {}
    setBounds(bounds) {
      this.bounds = bounds;
    }
  }
  class BaseWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.shows = 0;
      this.bounds = { x: 30, y: 40, width: options.width, height: options.height };
      this.views = [];
      this.contentView = { addChildView: (view) => this.views.push(view) };
      windows.push(this);
    }
    // Test observations follow the application view, never the terminal view.
    get applicationContents() {
      return this.webContents ?? this.views[0].webContents;
    }
    get loads() {
      return this.applicationContents.loads;
    }
    get messages() {
      return this.applicationContents.messages;
    }
    get url() {
      return this.applicationContents.getURL();
    }
    set navigation(value) {
      this.applicationContents.navigation = value;
    }
    get navigation() {
      return this.applicationContents.navigation;
    }
    isDestroyed() {
      return this.destroyed;
    }
    getNormalBounds() {
      return this.bounds;
    }
    getContentBounds() {
      return this.bounds;
    }
    isMaximized() {
      return false;
    }
    isMinimized() {
      return false;
    }
    show() {
      this.shows++;
    }
    focus() {}
    hide() {}
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
    close() {
      this.emit("close", { preventDefault() {} });
    }
    setOverlayIcon() {}
  }
  class Window extends BaseWindow {
    constructor(options) {
      super(options);
      this.webContents = new Contents();
    }
    async loadFile(file) {
      await this.webContents.loadURL(`file://${file}`);
    }
  }
  const session = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    fetch: (url, options) => {
      requests.push({ url, options });
      return controls.fetch(url, options);
    },
  });
  const nativeImage = {
    setTemplateImage() {},
    resize() {
      return this;
    },
  };
  class Tray extends EventEmitter {
    setToolTip() {}
    setContextMenu() {}
    setTitle() {}
  }
  const electron = {
    app,
    BaseWindow,
    BrowserWindow: Window,
    WebContentsView: View,
    ipcMain,
    Tray,
    nativeTheme: new EventEmitter(),
    nativeImage: { createFromPath: () => nativeImage },
    Menu: { buildFromTemplate: (value) => value, setApplicationMenu() {} },
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 3000, height: 2000 } }) },
    net: { fetch: (...args) => controls.probe(...args) },
    session: {
      defaultSession: session,
      fromPartition: () =>
        Object.assign(new EventEmitter(), {
          setPermissionRequestHandler() {},
          setPermissionCheckHandler() {},
          webRequest: { onBeforeRequest() {} },
        }),
    },
    shell: {
      openExternal: (url) => {
        browserURLs.push(url);
        return controls.openExternal(url);
      },
    },
    dialog: {
      showMessageBox: async (...args) => {
        errors.push(args.at(-1).message);
      },
    },
  };
  const testProcess = Object.assign(new EventEmitter(), {
    platform: process.platform,
    argv: [],
    execPath: process.execPath,
    env: {},
  });
  vm.runInNewContext(
    await fs.readFile(bundle, "utf8"),
    {
      require: (name) =>
        name === "electron"
          ? electron
          : name === "node:fs/promises"
            ? {
                ...fs,
                writeFile: (...args) => trackIO(() => controls.writeFile(...args)),
                rename: (...args) => trackIO(() => controls.rename(...args)),
              }
            : require(name),
      __dirname: path.dirname(bundle),
      process: testProcess,
      console: { error: (...args) => logs.push(args) },
      URL,
      Response,
      TextDecoder,
      AbortSignal,
      Error,
      setTimeout: (callback, delay) => {
        const id = {};
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    { filename: bundle },
  );
  ready.resolve();
  await until(() => windows.length > 0);
  const event = (window) => ({
    sender: window.applicationContents,
    senderFrame: window.applicationContents.mainFrame,
  });
  const invoke = (window, channel, input) => handlers.get(channel)(event(window), input);
  const send = (window, channel, input) => ipcMain.emit(channel, event(window), input);
  send(windows[0], "desktop:open-settings");
  const settingsWindow = windows[1];
  return {
    app,
    controls,
    windows,
    errors,
    logs,
    badges,
    requests,
    browserURLs,
    destination,
    idle,
    get main() {
      return windows.filter((window) => !window.options.parent && !window.destroyed).at(-1);
    },
    getSettings: () => invoke(settingsWindow, "settings:get"),
    save: (serverUrl) =>
      invoke(settingsWindow, "settings:save", {
        serverUrl,
        closeToTray: true,
        startAtLogin: false,
      }),
    signIn: (window = windows[0]) => invoke(window, "desktop:sign-in-with-github"),
    send,
    callback: (code = "a".repeat(43)) =>
      app.emit(
        "open-url",
        { preventDefault() {} },
        `chat.clickclack.desktop:/auth/callback?code=${code}`,
      ),
    disk: async () => JSON.parse(await fs.readFile(destination, "utf8")),
    flushTimers: async () => {
      for (const [id, timer] of timers) {
        timers.delete(id);
        timer.callback();
      }
      await settle();
    },
  };
}
