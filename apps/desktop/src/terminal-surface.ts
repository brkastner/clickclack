import type { DesktopTerminalData, DesktopTerminalStatus } from "./contract";
import {
  normalizeTerminalDimensions,
  normalizeTerminalSequence,
  sanitizeTerminalInput,
} from "./contract";
import { TerminalSession, terminalShell, type TerminalProcessFactory } from "./terminal-session";

export type Rectangle = { height: number; width: number; x: number; y: number };

export type TerminalSurfaceLayout = {
  application: Rectangle;
  terminal: Rectangle;
};

export const TERMINAL_MIN_DOCK_HEIGHT = 220;
export const TERMINAL_MAX_DOCK_HEIGHT = 380;
const MAX_PENDING_INPUT_EVENTS = 32;

export function terminalSurfaceLayout(
  content: Pick<Rectangle, "height" | "width">,
  open: boolean,
  _platform: NodeJS.Platform,
  _integratedTitleBar: boolean,
): TerminalSurfaceLayout {
  const width = Math.max(0, Math.floor(content.width));
  const height = Math.max(0, Math.floor(content.height));
  if (open) {
    const dockHeight = Math.min(
      height,
      Math.min(
        TERMINAL_MAX_DOCK_HEIGHT,
        Math.max(TERMINAL_MIN_DOCK_HEIGHT, Math.round(height * 0.34)),
      ),
    );
    const applicationHeight = Math.max(0, height - dockHeight);
    return {
      application: { height: applicationHeight, width, x: 0, y: 0 },
      terminal: { height: dockHeight, width, x: 0, y: applicationHeight },
    };
  }

  return {
    application: { height, width, x: 0, y: 0 },
    terminal: { height: 0, width: 0, x: width, y: height },
  };
}

type FrameLike = { url: string };

export type TerminalIPCEvent = {
  sender: SurfaceWebContents;
  senderFrame: FrameLike | null;
};

export type SurfaceWebContents = {
  readonly id: number;
  readonly mainFrame: FrameLike;
  close(): void;
  focus(): void;
  getURL(): string;
  isDestroyed(): boolean;
  isFocused(): boolean;
  loadURL(url: string): Promise<void>;
  off(event: string, listener: (...args: any[]) => void): unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
  send(channel: string, ...args: unknown[]): void;
  sendInputEvent(input: Electron.KeyboardInputEvent): void;
};

export type SurfaceView = {
  readonly webContents: SurfaceWebContents;
  setBounds(bounds: Rectangle): void;
};

export type SurfaceWindow = {
  getContentBounds(): Rectangle;
  isDestroyed(): boolean;
};

export type TerminalSurfaceOptions = {
  applicationView: SurfaceView;
  createProcess: TerminalProcessFactory;
  integratedTitleBar: boolean;
  onOpenChanged?(open: boolean): void;
  platform: NodeJS.Platform;
  readClipboard(): string;
  terminalURL: string;
  terminalView: SurfaceView;
  window: SurfaceWindow;
  writeClipboard(text: string): void;
};

export type TerminalPresentation = { open: boolean };
export type TerminalCommand = "copy" | "paste";

let nodePtyModule: typeof import("node-pty") | null = null;

export function terminalProcessEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const terminalEnvironment = { ...environment };
  delete terminalEnvironment.NO_COLOR;
  terminalEnvironment.COLORTERM = "truecolor";
  terminalEnvironment.TERM = "xterm-256color";
  return terminalEnvironment;
}

export function createLocalTerminalProcessFactory(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  cwd: string,
): TerminalProcessFactory {
  const shell = terminalShell(platform, environment);
  return (dimensions) => {
    nodePtyModule ??= require("node-pty") as typeof import("node-pty");
    return nodePtyModule.spawn(shell.file, shell.args, {
      cols: dimensions.cols,
      cwd,
      env: terminalProcessEnvironment(environment),
      name: "xterm-256color",
      rows: dimensions.rows,
    });
  };
}

export class TerminalSurface {
  private disposed = false;
  private openState = false;
  private rendererReady = false;
  private readonly pendingInput: Electron.KeyboardInputEvent[] = [];
  private readonly terminalSession: TerminalSession;

  private readonly handleBeforeInput = (
    event: Pick<Electron.Event, "preventDefault">,
    input: Electron.Input,
  ) => {
    if (this.disposed || !this.openState || this.rendererReady) return;
    const queued = queuedKeyboardInput(input);
    if (!queued) return;
    event.preventDefault();
    if (this.pendingInput.length === MAX_PENDING_INPUT_EVENTS) this.pendingInput.shift();
    this.pendingInput.push(queued);
  };

  private readonly handleDidStartLoading = () => {
    this.rendererReady = false;
  };

  private readonly handleDidFinishLoad = () => {
    this.rendererReady = false;
    this.sendPresentation();
    if (this.openState) this.options.terminalView.webContents.focus();
  };

  private readonly handleRenderProcessGone = (_event: unknown, details: { reason?: string }) => {
    if (this.disposed || details.reason === "clean-exit") return;
    this.rendererReady = false;
    void this.load().catch(() => {
      // A later menu toggle or window replacement can retry the local surface.
    });
  };

  constructor(private readonly options: TerminalSurfaceOptions) {
    this.terminalSession = new TerminalSession(options.createProcess, {
      onData: (data) => this.send("desktop:terminal-data", data),
      onStatus: (status) => this.send("desktop:terminal-status", status),
    });
    options.terminalView.webContents.on("before-input-event", this.handleBeforeInput);
    options.terminalView.webContents.on("did-start-loading", this.handleDidStartLoading);
    options.terminalView.webContents.on("did-finish-load", this.handleDidFinishLoad);
    options.terminalView.webContents.on("render-process-gone", this.handleRenderProcessGone);
    this.layout();
  }

  load(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.options.terminalView.webContents.loadURL(this.options.terminalURL);
  }

  isOpen(): boolean {
    return this.openState;
  }

  isFocused(): boolean {
    return !this.disposed && this.options.terminalView.webContents.isFocused();
  }

  owns(event: TerminalIPCEvent): boolean {
    if (this.disposed || this.options.window.isDestroyed()) return false;
    const terminalContents = this.options.terminalView.webContents;
    return Boolean(
      !terminalContents.isDestroyed() &&
      event.sender === terminalContents &&
      event.senderFrame === terminalContents.mainFrame &&
      event.senderFrame?.url === this.options.terminalURL &&
      terminalContents.getURL() === this.options.terminalURL,
    );
  }

  open(): void {
    if (this.disposed || this.openState) return;
    this.openState = true;
    this.rendererReady = false;
    this.pendingInput.length = 0;
    this.layout();
    this.options.terminalView.webContents.focus();
    this.sendPresentation();
    this.options.onOpenChanged?.(true);
  }

  hide(): void {
    if (this.disposed) return;
    const changed = this.openState;
    this.openState = false;
    this.rendererReady = false;
    this.pendingInput.length = 0;
    this.layout();
    this.sendPresentation();
    this.options.applicationView.webContents.focus();
    if (changed) this.options.onOpenChanged?.(false);
  }

  toggle(): void {
    if (this.openState) this.hide();
    else this.open();
  }

  layout(): TerminalSurfaceLayout {
    const bounds = terminalSurfaceLayout(
      this.options.window.getContentBounds(),
      this.openState,
      this.options.platform,
      this.options.integratedTitleBar,
    );
    this.options.applicationView.setBounds(bounds.application);
    this.options.terminalView.setBounds(bounds.terminal);
    return bounds;
  }

  presentation(event: TerminalIPCEvent): TerminalPresentation | null {
    if (!this.owns(event)) return null;
    if (this.openState) this.options.terminalView.webContents.focus();
    return { open: this.openState };
  }

  requestHide(event: TerminalIPCEvent): void {
    if (this.owns(event)) this.hide();
  }

  start(event: TerminalIPCEvent): DesktopTerminalStatus {
    return this.owns(event) && this.openState && this.options.terminalView.webContents.isFocused()
      ? this.terminalSession.start()
      : terminalRequestRejected();
  }

  status(event: TerminalIPCEvent): DesktopTerminalStatus {
    return this.owns(event) ? this.terminalSession.status() : terminalRequestRejected();
  }

  write(event: TerminalIPCEvent, input: unknown): void {
    if (!this.owns(event)) return;
    const data = sanitizeTerminalInput(input);
    if (data !== null) this.terminalSession.write(data);
  }

  resize(event: TerminalIPCEvent, input: unknown): void {
    if (!this.owns(event)) return;
    const dimensions = normalizeTerminalDimensions(input);
    if (dimensions) this.terminalSession.resize(dimensions);
  }

  outputReady(event: TerminalIPCEvent): void {
    if (!this.owns(event) || !this.openState || this.rendererReady) return;
    this.rendererReady = true;
    const contents = this.options.terminalView.webContents;
    contents.focus();
    this.terminalSession.reconnectOutput();
    for (const input of this.pendingInput.splice(0)) contents.sendInputEvent(input);
  }

  acknowledgeOutput(event: TerminalIPCEvent, input: unknown): void {
    if (!this.owns(event)) return;
    const sequence = normalizeTerminalSequence(input);
    if (sequence !== null) this.terminalSession.acknowledgeOutput(sequence);
  }

  terminate(event: TerminalIPCEvent): DesktopTerminalStatus {
    return this.owns(event) ? this.terminalSession.terminate() : terminalRequestRejected();
  }

  readClipboard(event: TerminalIPCEvent): string | null {
    if (!this.owns(event)) return null;
    const text = this.options.readClipboard();
    return sanitizeTerminalInput(text) === null ? null : text;
  }

  writeClipboard(event: TerminalIPCEvent, input: unknown): boolean {
    if (!this.owns(event)) return false;
    const text = sanitizeTerminalInput(input);
    if (text === null) return false;
    this.options.writeClipboard(text);
    return true;
  }

  sendCommand(command: TerminalCommand): void {
    if (!this.openState) return;
    this.send("desktop:terminal-command", command);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const contents = this.options.terminalView.webContents;
    contents.off("before-input-event", this.handleBeforeInput);
    contents.off("did-start-loading", this.handleDidStartLoading);
    contents.off("did-finish-load", this.handleDidFinishLoad);
    contents.off("render-process-gone", this.handleRenderProcessGone);
    this.terminalSession.dispose();
    if (!contents.isDestroyed()) contents.close();
  }

  private sendPresentation(): void {
    this.send("desktop:terminal-presentation", {
      open: this.openState,
    } satisfies TerminalPresentation);
  }

  private send(
    channel: string,
    payload: DesktopTerminalData | DesktopTerminalStatus | TerminalPresentation | TerminalCommand,
  ): void {
    const contents = this.options.terminalView.webContents;
    if (
      this.disposed ||
      this.options.window.isDestroyed() ||
      contents.isDestroyed() ||
      contents.getURL() !== this.options.terminalURL
    ) {
      return;
    }
    try {
      contents.send(channel, payload);
    } catch {
      // The local renderer reconnects after reload and replays unacknowledged output.
    }
  }
}

function queuedKeyboardInput(input: Electron.Input): Electron.KeyboardInputEvent | null {
  if (input.type !== "keyDown" && input.type !== "keyUp") return null;
  const modifiers: NonNullable<Electron.KeyboardInputEvent["modifiers"]> = [];
  if (input.shift) modifiers.push("shift");
  if (input.control) modifiers.push("control");
  if (input.alt) modifiers.push("alt");
  if (input.meta) modifiers.push("meta");
  if (input.isAutoRepeat) modifiers.push("isautorepeat");
  return { keyCode: input.key, modifiers, type: input.type };
}

function terminalRequestRejected(): DesktopTerminalStatus {
  return { state: "error", message: "Terminal request rejected" };
}
