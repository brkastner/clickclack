import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  TerminalSurface,
  terminalProcessEnvironment,
  terminalSurfaceLayout,
  type Rectangle,
  type SurfaceView,
  type SurfaceWebContents,
  type TerminalIPCEvent,
} from "./terminal-surface";
import type { TerminalProcess } from "./terminal-session";

class FakeWebContents extends EventEmitter implements SurfaceWebContents {
  readonly mainFrame = { url: "" };
  readonly sent: Array<{ channel: string; payload: unknown }> = [];
  closeCount = 0;
  destroyed = false;
  focusCount = 0;
  focused = false;
  loadCount = 0;
  readonly inputEvents: Electron.KeyboardInputEvent[] = [];
  url = "";

  constructor(readonly id: number) {
    super();
  }

  close(): void {
    this.closeCount += 1;
    this.destroyed = true;
  }

  focus(): void {
    this.focusCount += 1;
    this.focused = true;
  }

  getURL(): string {
    return this.url;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isFocused(): boolean {
    return this.focused;
  }

  async loadURL(url: string): Promise<void> {
    this.loadCount += 1;
    this.emit("did-start-loading");
    this.url = url;
    this.mainFrame.url = url;
    this.emit("did-finish-load");
  }

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }

  sendInputEvent(input: Electron.KeyboardInputEvent): void {
    this.inputEvents.push(input);
  }
}

class FakeView implements SurfaceView {
  bounds: Rectangle = { height: 0, width: 0, x: 0, y: 0 };

  constructor(readonly webContents: FakeWebContents) {}

  setBounds(bounds: Rectangle): void {
    this.bounds = { ...bounds };
  }
}

class FakeWindow {
  destroyed = false;

  constructor(public bounds: Rectangle = { height: 600, width: 800, x: 40, y: 50 }) {}

  getContentBounds(): Rectangle {
    return this.bounds;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

class FakeProcess implements TerminalProcess {
  readonly pid: number;
  killCount = 0;
  writes: string[] = [];
  private dataCallback: ((data: string) => void) | null = null;
  private exitCallback: ((event: { exitCode: number; signal?: number }) => void) | null = null;

  constructor(pid: number) {
    this.pid = pid;
  }

  kill(): void {
    this.killCount += 1;
  }

  onData(callback: (data: string) => void) {
    this.dataCallback = callback;
    return { dispose: () => (this.dataCallback = null) };
  }

  onExit(callback: (event: { exitCode: number; signal?: number }) => void) {
    this.exitCallback = callback;
    return { dispose: () => (this.exitCallback = null) };
  }

  pause(): void {}
  resize(): void {}
  resume(): void {}

  write(data: string): void {
    this.writes.push(data);
  }
}

function createFixture(id = 1) {
  const applicationContents = new FakeWebContents(id * 10);
  const terminalContents = new FakeWebContents(id * 10 + 1);
  const applicationView = new FakeView(applicationContents);
  const terminalView = new FakeView(terminalContents);
  const window = new FakeWindow();
  const processes: FakeProcess[] = [];
  const clipboardWrites: string[] = [];
  const terminalURL = `file:///terminal-${id}.html`;
  terminalContents.url = terminalURL;
  terminalContents.mainFrame.url = terminalURL;
  const surface = new TerminalSurface({
    applicationView,
    createProcess: () => {
      const process = new FakeProcess(100 + processes.length);
      processes.push(process);
      return process;
    },
    integratedTitleBar: true,
    platform: "linux",
    readClipboard: () => "paste text",
    terminalURL,
    terminalView,
    window,
    writeClipboard: (text) => clipboardWrites.push(text),
  });
  const terminalEvent: TerminalIPCEvent = {
    sender: terminalContents,
    senderFrame: terminalContents.mainFrame,
  };
  const applicationEvent: TerminalIPCEvent = {
    sender: applicationContents,
    senderFrame: applicationContents.mainFrame,
  };
  return {
    applicationContents,
    applicationEvent,
    applicationView,
    clipboardWrites,
    processes,
    surface,
    terminalContents,
    terminalEvent,
    terminalURL,
    terminalView,
    window,
  };
}

test("forces terminal color capability without inheriting the desktop NO_COLOR flag", () => {
  const environment = terminalProcessEnvironment({
    HOME: "/home/test",
    NO_COLOR: "1",
    TERM: "dumb",
  });

  assert.equal(environment.NO_COLOR, undefined);
  assert.equal(environment.TERM, "xterm-256color");
  assert.equal(environment.COLORTERM, "truecolor");
  assert.equal(environment.HOME, "/home/test");
});

test("partitions native content bounds between sibling views", () => {
  assert.deepEqual(terminalSurfaceLayout({ height: 600, width: 800 }, true, "linux", true), {
    application: { height: 380, width: 800, x: 0, y: 0 },
    terminal: { height: 220, width: 800, x: 0, y: 380 },
  });
  assert.deepEqual(terminalSurfaceLayout({ height: 600, width: 800 }, false, "linux", true), {
    application: { height: 600, width: 800, x: 0, y: 0 },
    terminal: { height: 0, width: 0, x: 800, y: 600 },
  });
  assert.deepEqual(
    terminalSurfaceLayout({ height: 600, width: 800 }, false, "darwin", true).terminal,
    {
      height: 0,
      width: 0,
      x: 800,
      y: 600,
    },
  );
  assert.equal(
    terminalSurfaceLayout({ height: 2_000, width: 1_400 }, true, "linux", false).terminal.height,
    380,
  );
});

test("never overlays the application view", () => {
  for (const open of [false, true]) {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const layout = terminalSurfaceLayout({ height: 600, width: 800 }, open, platform, true);
      assert.equal(rectanglesIntersect(layout.application, layout.terminal), false);
    }
  }
});

test("authorizes only the exact live terminal main frame and canonical file URL", () => {
  const fixture = createFixture();
  assert.equal(fixture.surface.owns(fixture.terminalEvent), true);
  assert.equal(fixture.surface.owns(fixture.applicationEvent), false);
  const rogueFileContents = new FakeWebContents(999);
  rogueFileContents.url = fixture.terminalURL;
  rogueFileContents.mainFrame.url = fixture.terminalURL;
  assert.equal(
    fixture.surface.owns({ sender: rogueFileContents, senderFrame: rogueFileContents.mainFrame }),
    false,
  );
  assert.equal(
    fixture.surface.owns({ ...fixture.terminalEvent, senderFrame: { url: fixture.terminalURL } }),
    false,
  );

  fixture.terminalContents.mainFrame.url = `${fixture.terminalURL}#changed`;
  assert.equal(fixture.surface.owns(fixture.terminalEvent), false);
  fixture.terminalContents.mainFrame.url = fixture.terminalURL;
  fixture.window.destroyed = true;
  assert.equal(fixture.surface.owns(fixture.terminalEvent), false);
});

test("opens, hides, and reopens without terminating the session", () => {
  const fixture = createFixture();
  assert.deepEqual(fixture.applicationView.bounds, { height: 600, width: 800, x: 0, y: 0 });

  fixture.surface.open();
  assert.equal(fixture.surface.isOpen(), true);
  assert.deepEqual(fixture.applicationView.bounds, { height: 380, width: 800, x: 0, y: 0 });
  assert.deepEqual(fixture.terminalView.bounds, { height: 220, width: 800, x: 0, y: 380 });
  assert.equal(fixture.terminalContents.focusCount, 1);
  assert.deepEqual(fixture.surface.start(fixture.terminalEvent), { state: "running", pid: 100 });

  fixture.surface.hide();
  assert.equal(fixture.surface.isOpen(), false);
  assert.equal(fixture.applicationContents.focusCount, 1);
  assert.equal(fixture.processes[0]?.killCount, 0);
  fixture.surface.open();
  assert.deepEqual(fixture.surface.start(fixture.terminalEvent), { state: "running", pid: 100 });
  assert.equal(fixture.processes.length, 1);
});

test("queues terminal key input until xterm reports that it owns focus", () => {
  const fixture = createFixture();
  fixture.surface.open();
  let prevented = false;
  fixture.terminalContents.emit(
    "before-input-event",
    { preventDefault: () => (prevented = true) },
    {
      alt: false,
      code: "KeyX",
      control: false,
      isAutoRepeat: false,
      isComposing: false,
      key: "x",
      location: 0,
      meta: false,
      modifiers: [],
      shift: false,
      type: "keyDown",
    } satisfies Electron.Input,
  );

  assert.equal(prevented, true);
  assert.deepEqual(fixture.terminalContents.inputEvents, []);

  fixture.surface.outputReady(fixture.terminalEvent);
  assert.deepEqual(fixture.terminalContents.inputEvents, [
    { keyCode: "x", modifiers: [], type: "keyDown" },
  ]);
});

test("preserves input queued before the terminal document finishes loading", async () => {
  const fixture = createFixture();
  fixture.surface.open();
  fixture.terminalContents.emit("before-input-event", { preventDefault() {} }, {
    alt: false,
    code: "KeyX",
    control: false,
    isAutoRepeat: false,
    isComposing: false,
    key: "x",
    location: 0,
    meta: false,
    modifiers: [],
    shift: false,
    type: "keyDown",
  } satisfies Electron.Input);

  await fixture.surface.load();
  fixture.surface.outputReady(fixture.terminalEvent);

  assert.deepEqual(fixture.terminalContents.inputEvents, [
    { keyCode: "x", modifiers: [], type: "keyDown" },
  ]);
});

test("rejects application senders for every terminal operation", () => {
  const fixture = createFixture();
  assert.equal(fixture.surface.presentation(fixture.applicationEvent), null);
  fixture.surface.requestHide(fixture.applicationEvent);
  assert.equal(fixture.surface.isOpen(), false);
  assert.deepEqual(fixture.surface.start(fixture.applicationEvent), {
    state: "error",
    message: "Terminal request rejected",
  });
  assert.deepEqual(fixture.surface.status(fixture.applicationEvent), {
    state: "error",
    message: "Terminal request rejected",
  });
  assert.deepEqual(fixture.surface.terminate(fixture.applicationEvent), {
    state: "error",
    message: "Terminal request rejected",
  });
  fixture.surface.write(fixture.applicationEvent, "blocked");
  fixture.surface.resize(fixture.applicationEvent, { cols: 120, rows: 40 });
  fixture.surface.outputReady(fixture.applicationEvent);
  fixture.surface.acknowledgeOutput(fixture.applicationEvent, 1);
  assert.equal(fixture.surface.readClipboard(fixture.applicationEvent), null);
  assert.equal(fixture.surface.writeClipboard(fixture.applicationEvent, "blocked"), false);
  assert.equal(fixture.processes.length, 0);
  assert.deepEqual(fixture.clipboardWrites, []);
});

test("bounds clipboard text inside the authorized terminal owner", () => {
  const fixture = createFixture();
  assert.equal(fixture.surface.readClipboard(fixture.terminalEvent), "paste text");
  assert.equal(fixture.surface.writeClipboard(fixture.terminalEvent, "copied"), true);
  assert.equal(
    fixture.surface.writeClipboard(fixture.terminalEvent, "x".repeat(64 * 1024 + 1)),
    false,
  );
  assert.deepEqual(fixture.clipboardWrites, ["copied"]);
});

test("keeps two terminal owners isolated", () => {
  const first = createFixture(1);
  const second = createFixture(2);

  assert.equal(first.surface.owns(second.terminalEvent), false);
  assert.equal(second.surface.owns(first.terminalEvent), false);
  first.surface.open();
  second.surface.open();
  first.surface.start(first.terminalEvent);
  second.surface.start(second.terminalEvent);
  first.surface.write(second.terminalEvent, "wrong owner");
  second.surface.write(second.terminalEvent, "second owner");

  assert.deepEqual(first.processes[0]?.writes, []);
  assert.deepEqual(second.processes[0]?.writes, ["second owner"]);
});

test("disposes the PTY and terminal webContents exactly once", () => {
  const fixture = createFixture();
  fixture.surface.open();
  fixture.surface.start(fixture.terminalEvent);
  fixture.surface.dispose();
  fixture.surface.dispose();

  assert.equal(fixture.processes[0]?.killCount, 1);
  assert.equal(fixture.terminalContents.closeCount, 1);
  assert.equal(fixture.applicationContents.closeCount, 0);
  assert.equal(fixture.surface.owns(fixture.terminalEvent), false);
});

function rectanglesIntersect(left: Rectangle, right: Rectangle): boolean {
  return (
    left.width > 0 &&
    left.height > 0 &&
    right.width > 0 &&
    right.height > 0 &&
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

test("reloads a failed local renderer without replacing its PTY", async () => {
  const fixture = createFixture();
  await fixture.surface.load();
  fixture.surface.open();
  fixture.surface.start(fixture.terminalEvent);
  fixture.terminalContents.emit("render-process-gone", {}, { reason: "crashed" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fixture.terminalContents.loadCount, 2);
  assert.equal(fixture.processes.length, 1);
  assert.deepEqual(fixture.surface.start(fixture.terminalEvent), { state: "running", pid: 100 });
});
