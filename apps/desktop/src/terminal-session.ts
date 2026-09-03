import type {
  DesktopTerminalData,
  DesktopTerminalDimensions,
  DesktopTerminalStatus,
} from "./contract";

type Disposable = { dispose(): void };

type QueuedOutput = {
  bytes: number;
  data: string;
};

export const MAX_TERMINAL_OUTPUT_BUFFER_BYTES = 1024 * 1024;
export const MAX_TERMINAL_OUTPUT_CHUNK_BYTES = 64 * 1024;
export const TERMINAL_OUTPUT_HIGH_WATER_BYTES = 256 * 1024;
export const TERMINAL_OUTPUT_LOW_WATER_BYTES = 64 * 1024;

export type TerminalProcess = {
  readonly pid: number;
  kill(): void;
  onData(callback: (data: string) => void): Disposable;
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): Disposable;
  pause(): void;
  resize(cols: number, rows: number): void;
  resume(): void;
  write(data: string): void;
};

export type TerminalProcessFactory = (dimensions: DesktopTerminalDimensions) => TerminalProcess;

export type TerminalSessionEvents = {
  onData(data: DesktopTerminalData): void;
  onStatus(status: DesktopTerminalStatus): void;
};

export type TerminalShell = {
  args: string[];
  file: string;
};

export function terminalShell(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): TerminalShell {
  if (platform === "win32") {
    return { args: [], file: environment.ComSpec || environment.COMSPEC || "cmd.exe" };
  }
  return {
    args: [],
    file: environment.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash"),
  };
}

export class TerminalSession {
  private bufferedOutputBytes = 0;
  private currentStatus: DesktopTerminalStatus = { state: "idle" };
  private dimensions: DesktopTerminalDimensions;
  private inFlightOutput: (QueuedOutput & { sequence: number }) | null = null;
  private listeners: Disposable[] = [];
  private outputPaused = false;
  private outputQueue: QueuedOutput[] = [];
  private outputSequence = 0;
  private process: TerminalProcess | null = null;

  constructor(
    private readonly createProcess: TerminalProcessFactory,
    private readonly events: TerminalSessionEvents,
    initialDimensions: DesktopTerminalDimensions = { cols: 100, rows: 30 },
  ) {
    this.dimensions = initialDimensions;
  }

  status(): DesktopTerminalStatus {
    return this.currentStatus;
  }

  start(): DesktopTerminalStatus {
    if (this.process) return this.currentStatus;
    this.clearOutput();

    try {
      const process = this.createProcess(this.dimensions);
      this.process = process;
      this.listeners = [
        process.onData((data) => {
          if (this.process === process) this.enqueueOutput(data);
        }),
        process.onExit(({ exitCode, signal }) => {
          if (this.process !== process) return;
          this.releaseProcess(false);
          this.setStatus({ state: "exited", exitCode, signal: signal ?? null });
        }),
      ];
      this.setStatus({ state: "running", pid: process.pid });
    } catch (error) {
      this.releaseProcess(true);
      this.setStatus({
        state: "error",
        message: error instanceof Error ? error.message.slice(0, 500) : "Could not start shell",
      });
    }

    return this.currentStatus;
  }

  write(data: string): void {
    if (!this.process || this.currentStatus.state !== "running") return;
    try {
      this.process.write(data);
    } catch (error) {
      this.fail(error, "Could not write to shell");
    }
  }

  resize(dimensions: DesktopTerminalDimensions): void {
    this.dimensions = dimensions;
    if (!this.process || this.currentStatus.state !== "running") return;
    try {
      this.process.resize(dimensions.cols, dimensions.rows);
    } catch {
      // A resize can race with process exit. The exit event owns the state change.
    }
  }

  acknowledgeOutput(sequence: number): void {
    if (this.inFlightOutput?.sequence !== sequence) return;
    this.inFlightOutput = null;
    this.updateFlowControl();
    this.deliverNextOutput();
  }

  reconnectOutput(): void {
    if (this.inFlightOutput) {
      const { bytes, data } = this.inFlightOutput;
      this.outputQueue.unshift({ bytes, data });
      this.bufferedOutputBytes += bytes;
      this.inFlightOutput = null;
    }
    this.updateFlowControl();
    this.deliverNextOutput();
  }

  terminate(): DesktopTerminalStatus {
    if (!this.process) return this.currentStatus;
    const process = this.process;
    this.releaseProcess(true);
    try {
      process.kill();
      this.setStatus({ state: "exited", exitCode: null, signal: null });
    } catch (error) {
      this.setStatus({
        state: "error",
        message: error instanceof Error ? error.message.slice(0, 500) : "Could not stop shell",
      });
    }
    return this.currentStatus;
  }

  dispose(): void {
    const process = this.process;
    this.releaseProcess(true);
    if (!process) return;
    try {
      process.kill();
    } catch {
      // The window is already closing, so disposal is best effort.
    }
    this.currentStatus = { state: "idle" };
  }

  private enqueueOutput(data: string): void {
    for (const chunk of splitOutput(data)) {
      if (this.totalOutputBytes() + chunk.bytes > MAX_TERMINAL_OUTPUT_BUFFER_BYTES) {
        this.fail(
          new Error("Terminal output exceeded the delivery buffer"),
          "Terminal output stopped",
        );
        return;
      }
      this.outputQueue.push(chunk);
      this.bufferedOutputBytes += chunk.bytes;
    }
    this.updateFlowControl();
    this.deliverNextOutput();
  }

  private deliverNextOutput(): void {
    if (this.inFlightOutput || this.outputQueue.length === 0) return;
    const next = this.outputQueue.shift();
    if (!next) return;
    this.bufferedOutputBytes -= next.bytes;
    const sequence = ++this.outputSequence;
    this.inFlightOutput = { ...next, sequence };
    this.events.onData({ data: next.data, sequence });
  }

  private updateFlowControl(): void {
    const process = this.process;
    if (!process) return;
    const bytes = this.totalOutputBytes();
    if (!this.outputPaused && bytes >= TERMINAL_OUTPUT_HIGH_WATER_BYTES) {
      try {
        process.pause();
        this.outputPaused = true;
      } catch {
        // The hard buffer limit still prevents unbounded memory use.
      }
      return;
    }
    if (this.outputPaused && bytes <= TERMINAL_OUTPUT_LOW_WATER_BYTES) {
      try {
        process.resume();
        this.outputPaused = false;
      } catch (error) {
        this.fail(error, "Could not resume terminal output");
      }
    }
  }

  private totalOutputBytes(): number {
    return this.bufferedOutputBytes + (this.inFlightOutput?.bytes ?? 0);
  }

  private fail(error: unknown, fallback: string): void {
    const process = this.process;
    this.releaseProcess(true);
    if (process) {
      try {
        process.kill();
      } catch {
        // Preserve the original failure below.
      }
    }
    this.setStatus({
      state: "error",
      message: error instanceof Error ? error.message.slice(0, 500) : fallback,
    });
  }

  private releaseProcess(clearOutput: boolean): void {
    this.process = null;
    for (const listener of this.listeners) listener.dispose();
    this.listeners = [];
    this.outputPaused = false;
    if (clearOutput) this.clearOutput();
  }

  private clearOutput(): void {
    this.bufferedOutputBytes = 0;
    this.inFlightOutput = null;
    this.outputQueue = [];
  }

  private setStatus(status: DesktopTerminalStatus): void {
    this.currentStatus = status;
    this.events.onStatus(status);
  }
}

function splitOutput(data: string): QueuedOutput[] {
  const chunks: QueuedOutput[] = [];
  const maxCodeUnits = Math.floor(MAX_TERMINAL_OUTPUT_CHUNK_BYTES / 4);
  for (let offset = 0; offset < data.length;) {
    let end = Math.min(offset + maxCodeUnits, data.length);
    const finalCodeUnit = data.charCodeAt(end - 1);
    if (end < data.length && finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end -= 1;
    const chunk = data.slice(offset, end);
    chunks.push({ bytes: Buffer.byteLength(chunk), data: chunk });
    offset = end;
  }
  return chunks;
}
