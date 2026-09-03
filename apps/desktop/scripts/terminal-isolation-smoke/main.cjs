const assert = require("node:assert/strict");
const { once } = require("node:events");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, clipboard, ipcMain, WebContentsView } = require("electron");
const { TerminalSurface } = require(process.env.CLICKCLACK_TERMINAL_SURFACE_MODULE);

const terminalURL = pathToFileURL(
  path.resolve(__dirname, "..", "..", "resources", "terminal.html"),
).href;
const terminalPreload = path.resolve(__dirname, "..", "..", "dist", "terminal-preload.cjs");

void app.whenReady().then(async () => {
  const window = new BaseWindow({ frame: false, height: 600, show: true, width: 800 });
  const applicationView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const terminalView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `terminal-isolation-smoke-${process.pid}`,
      preload: terminalPreload,
      sandbox: true,
    },
  });
  window.contentView.addChildView(applicationView);
  window.contentView.addChildView(terminalView);

  const processes = [];
  const surface = new TerminalSurface({
    applicationView,
    createProcess: () => {
      const process = new FakeProcess(4_200 + processes.length);
      processes.push(process);
      return process;
    },
    integratedTitleBar: true,
    platform: process.platform,
    readClipboard: () => clipboard.readText(),
    terminalURL,
    terminalView,
    window,
    writeClipboard: (text) => clipboard.writeText(text),
  });
  registerTerminalIPC(surface);
  window.on("closed", () => surface.dispose());

  try {
    await Promise.all([
      applicationView.webContents.loadURL(hostileApplicationPage()),
      surface.load(),
    ]);
    assert.equal(window.contentView.children.at(-1), terminalView);
    assertDisjoint(applicationView.getBounds(), terminalView.getBounds());

    surface.open();
    assertDisjoint(applicationView.getBounds(), terminalView.getBounds());
    terminalView.webContents.sendInputEvent({ type: "keyDown", keyCode: "x" });
    terminalView.webContents.sendInputEvent({ type: "keyUp", keyCode: "x" });

    await waitFor(() => processes[0]?.writes.includes("x"));
    await waitForXtermFocus(terminalView);
    const openTerminalBounds = terminalView.getBounds();
    await resizeTerminalWithKeyboard(terminalView);
    await waitFor(() => terminalView.getBounds().height === openTerminalBounds.height + 24);
    const resizedApplicationBounds = applicationView.getBounds();
    const resizedTerminalBounds = terminalView.getBounds();
    const resizedContentBounds = window.contentView.getBounds();
    assert.equal(resizedApplicationBounds.width, resizedContentBounds.width);
    assert.equal(resizedTerminalBounds.width, resizedContentBounds.width);
    assert.equal(
      resizedApplicationBounds.height + resizedTerminalBounds.height,
      resizedContentBounds.height,
    );
    assertDisjoint(resizedApplicationBounds, resizedTerminalBounds);

    await resizeTerminalWithKeyboard(terminalView, "End");
    await waitFor(
      async () => (await terminalAriaValue(terminalView)) === terminalView.getBounds().height,
    );
    await resizeTerminalWithKeyboard(terminalView, "End");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await terminalAriaValue(terminalView), terminalView.getBounds().height);
    await dispatchLocalEventFamilies(terminalView);
    assert.deepEqual(await applicationCounters(applicationView), zeroCounters());
    assert.equal(processes.length, 1);

    surface.hide();
    const hiddenLayout = surface.layout();
    assert.deepEqual(applicationView.getBounds(), hiddenLayout.application);
    assert.deepEqual(terminalView.getBounds(), hiddenLayout.terminal);
    assertDisjoint(applicationView.getBounds(), terminalView.getBounds());

    surface.open();
    terminalView.webContents.sendInputEvent({ type: "keyDown", keyCode: "y" });
    terminalView.webContents.sendInputEvent({ type: "keyUp", keyCode: "y" });
    await waitFor(() => processes[0]?.writes.includes("y"));
    assert.equal(processes.length, 1);

    const oldDocumentMarker = await terminalView.webContents.executeJavaScript(
      "globalThis.__terminalSmokeDocument = crypto.randomUUID()",
    );
    const reloadFinished = once(terminalView.webContents, "did-finish-load");
    terminalView.webContents.reload();
    await reloadFinished;
    assert.equal(
      await terminalView.webContents.executeJavaScript(
        "globalThis.__terminalSmokeDocument ?? null",
      ),
      null,
    );
    assert.equal(typeof oldDocumentMarker, "string");
    terminalView.webContents.sendInputEvent({ type: "keyDown", keyCode: "z" });
    terminalView.webContents.sendInputEvent({ type: "keyUp", keyCode: "z" });
    await waitFor(() => processes[0]?.writes.includes("z"));
    await waitForXtermFocus(terminalView);
    assert.equal(processes.length, 1);
    assert.deepEqual(await applicationCounters(applicationView), zeroCounters());
    processes[0].emitData("\x1b[31mRED \x1b[32mGREEN \x1b[34mBLUE \x1b[36mCYAN\x1b[0m\r\n");
    await waitForDistinctTerminalColors(terminalView);
    await verifyKittyGraphicsHandshake(processes[0]);

    window.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(processes[0].killCount, 1);
    console.log("terminal renderer isolation and lifecycle smoke passed");
    app.exit(0);
  } catch (error) {
    console.error(error);
    surface.dispose();
    if (!applicationView.webContents.isDestroyed()) applicationView.webContents.close();
    if (!window.isDestroyed()) window.destroy();
    app.exit(1);
  }
});

class FakeProcess {
  constructor(pid) {
    this.pid = pid;
    this.killCount = 0;
    this.writes = [];
    this.dataCallback = null;
    this.exitCallback = null;
  }

  kill() {
    this.killCount += 1;
  }

  onData(callback) {
    this.dataCallback = callback;
    return { dispose: () => (this.dataCallback = null) };
  }

  onExit(callback) {
    this.exitCallback = callback;
    return { dispose: () => (this.exitCallback = null) };
  }

  emitData(data) {
    this.dataCallback?.(data);
  }

  pause() {}
  resize() {}
  resume() {}

  write(data) {
    this.writes.push(data);
  }
}

function registerTerminalIPC(surface) {
  ipcMain.handle("desktop:terminal-presentation", (event) => surface.presentation(event));
  ipcMain.on("desktop:terminal-hide", (event) => surface.requestHide(event));
  ipcMain.handle("desktop:terminal-start", (event) => surface.start(event));
  ipcMain.handle("desktop:terminal-status", (event) => surface.status(event));
  ipcMain.on("desktop:terminal-write", (event, input) => surface.write(event, input));
  ipcMain.on("desktop:terminal-resize", (event, input) => surface.resize(event, input));
  ipcMain.on("desktop:terminal-resize-dock", (event, input) => surface.resizeDock(event, input));
  ipcMain.on("desktop:terminal-output-ready", (event) => surface.outputReady(event));
  ipcMain.on("desktop:terminal-output-ack", (event, input) =>
    surface.acknowledgeOutput(event, input),
  );
  ipcMain.handle("desktop:terminal-terminate", (event) => surface.terminate(event));
  ipcMain.handle("desktop:terminal-read-clipboard", (event) => surface.readClipboard(event));
  ipcMain.handle("desktop:terminal-write-clipboard", (event, input) =>
    surface.writeClipboard(event, input),
  );
}

function hostileApplicationPage() {
  const html = `<!doctype html>
    <html><body><div class="composer" contenteditable="true"></div><script>
      window.eventCounters = ${JSON.stringify(zeroCounters())};
      for (const type of ["beforeinput", "copy", "input", "keydown", "keyup", "paste", "selectionchange"]) {
        addEventListener(type, () => { window.eventCounters[type] += 1; }, true);
      }
      for (const type of ["compositionstart", "compositionupdate", "compositionend"]) {
        addEventListener(type, () => { window.eventCounters.composition += 1; }, true);
      }
      document.body.tabIndex = -1;
      document.body.focus();
    </script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function dispatchLocalEventFamilies(view) {
  await view.webContents.executeJavaScript(`
    for (const type of ["beforeinput", "copy", "input", "paste", "selectionchange"]) {
      document.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
    }
    for (const type of ["compositionstart", "compositionupdate", "compositionend"]) {
      document.dispatchEvent(new CompositionEvent(type, { bubbles: true, composed: true, data: "x" }));
    }
  `);
}

async function waitForXtermFocus(view) {
  await waitFor(async () =>
    view.webContents.executeJavaScript(
      'document.activeElement?.classList.contains("xterm-helper-textarea") === true',
    ),
  );
}

async function resizeTerminalWithKeyboard(view, key = "ArrowUp") {
  await view.webContents.executeJavaScript(`(() => {
    const handle = document.querySelector(".terminal-dock__resize-handle");
    handle?.focus();
    handle?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: ${JSON.stringify(key)} }));
  })()`);
}

async function terminalAriaValue(view) {
  return view.webContents.executeJavaScript(
    'Number(document.querySelector(".terminal-dock__resize-handle")?.getAttribute("aria-valuenow"))',
  );
}

async function verifyKittyGraphicsHandshake(process) {
  const writesBeforeProbe = process.writes.length;
  process.emitData("\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\");
  await waitFor(
    () => process.writes.slice(writesBeforeProbe).join("").includes("Gi=31;OK"),
    () => `Kitty query writes: ${JSON.stringify(process.writes.slice(writesBeforeProbe))}`,
  );

  const writesBeforeImage = process.writes.length;
  process.emitData("\x1b_Ga=t,f=24,s=1,v=1,i=32;AAAA\x1b\\");
  await waitFor(() => process.writes.slice(writesBeforeImage).join("").includes("Gi=32;OK"));
  process.emitData("\x1b_Ga=p,i=32,p=1,x=0,y=0,w=1,h=1,c=1,r=1,z=-1,C=1\x1b\\");
  await waitFor(
    () => process.writes.slice(writesBeforeImage).join("").includes("Gi=32,p=1;OK"),
    () => `Kitty image writes: ${JSON.stringify(process.writes.slice(writesBeforeImage))}`,
  );
}

async function waitForDistinctTerminalColors(view) {
  let lastProbe = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    lastProbe = await view.webContents.executeJavaScript(`({
      colors: [...document.querySelectorAll(".xterm-rows span")]
        .filter((element) => /RED|GREEN|BLUE|CYAN/.test(element.textContent || ""))
        .map((element) => ({ color: getComputedStyle(element).color, text: element.textContent })),
      canvases: document.querySelectorAll("canvas").length,
      rowsText: document.querySelector(".xterm-rows")?.textContent || "",
    })`);
    if (new Set(lastProbe.colors.map(({ color }) => color)).size >= 4) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`terminal color probe failed: ${JSON.stringify(lastProbe)}`);
}

async function applicationCounters(view) {
  return view.webContents.executeJavaScript("structuredClone(window.eventCounters)");
}

function zeroCounters() {
  return {
    beforeinput: 0,
    composition: 0,
    copy: 0,
    input: 0,
    keydown: 0,
    keyup: 0,
    paste: 0,
    selectionchange: 0,
  };
}

function assertDisjoint(left, right) {
  const intersects =
    left.width > 0 &&
    left.height > 0 &&
    right.width > 0 &&
    right.height > 0 &&
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
  assert.equal(intersects, false, `view bounds intersect: ${JSON.stringify({ left, right })}`);
}

async function waitFor(predicate, diagnostic) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `timed out waiting for terminal renderer state${diagnostic ? ` (${diagnostic()})` : ""}`,
  );
}
