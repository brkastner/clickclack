import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopTerminalData, DesktopTerminalStatus } from "./contract";
import { TerminalSession, terminalShell, type TerminalProcess } from "./terminal-session";

class FakeTerminalProcess implements TerminalProcess {
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  killCount = 0;
  pauseCount = 0;
  resumeCount = 0;
  private dataListeners = new Set<(data: string) => void>();
  private exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();

  constructor(readonly pid: number) {}

  kill(): void {
    this.killCount += 1;
  }

  onData(callback: (data: string) => void) {
    this.dataListeners.add(callback);
    return { dispose: () => this.dataListeners.delete(callback) };
  }

  onExit(callback: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListeners.add(callback);
    return { dispose: () => this.exitListeners.delete(callback) };
  }

  pause(): void {
    this.pauseCount += 1;
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  resume(): void {
    this.resumeCount += 1;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  emitExit(exitCode: number, signal?: number): void {
    for (const listener of this.exitListeners) listener({ exitCode, signal });
  }
}

test("selects a fixed local shell without renderer input", () => {
  assert.deepEqual(terminalShell("linux", { SHELL: "/bin/fish" }), {
    args: [],
    file: "/bin/fish",
  });
  assert.deepEqual(terminalShell("darwin", {}), { args: [], file: "/bin/zsh" });
  assert.deepEqual(terminalShell("win32", { ComSpec: "C:\\Windows\\cmd.exe" }), {
    args: [],
    file: "C:\\Windows\\cmd.exe",
  });
});

test("starts once, forwards IO, resizes, and terminates idempotently", () => {
  const processes: FakeTerminalProcess[] = [];
  const output: DesktopTerminalData[] = [];
  const statuses: DesktopTerminalStatus[] = [];
  const session = new TerminalSession(
    (dimensions) => {
      assert.deepEqual(dimensions, { cols: 100, rows: 30 });
      const process = new FakeTerminalProcess(100 + processes.length);
      processes.push(process);
      return process;
    },
    {
      onData: (data) => output.push(data),
      onStatus: (status) => statuses.push(status),
    },
  );

  assert.deepEqual(session.status(), { state: "idle" });
  assert.deepEqual(session.start(), { state: "running", pid: 100 });
  assert.deepEqual(session.start(), { state: "running", pid: 100 });
  assert.equal(processes.length, 1);

  processes[0]?.emitData("ready\r\n");
  session.write("pwd\r");
  session.resize({ cols: 132, rows: 42 });
  assert.deepEqual(output, [{ data: "ready\r\n", sequence: 1 }]);
  assert.deepEqual(processes[0]?.writes, ["pwd\r"]);
  assert.deepEqual(processes[0]?.resizes, [{ cols: 132, rows: 42 }]);

  assert.deepEqual(session.terminate(), { state: "exited", exitCode: null, signal: null });
  assert.equal(processes[0]?.killCount, 1);
  session.write("ignored");
  assert.deepEqual(processes[0]?.writes, ["pwd\r"]);
  assert.deepEqual(statuses, [
    { state: "running", pid: 100 },
    { state: "exited", exitCode: null, signal: null },
  ]);
});

test("publishes natural exits and can start a fresh process", () => {
  const processes: FakeTerminalProcess[] = [];
  const statuses: DesktopTerminalStatus[] = [];
  const session = new TerminalSession(
    () => {
      const process = new FakeTerminalProcess(200 + processes.length);
      processes.push(process);
      return process;
    },
    { onData: () => {}, onStatus: (status) => statuses.push(status) },
  );

  session.start();
  processes[0]?.emitExit(7, 15);
  assert.deepEqual(session.status(), { state: "exited", exitCode: 7, signal: 15 });
  assert.deepEqual(session.start(), { state: "running", pid: 201 });
  assert.equal(processes.length, 2);
});

test("disposes a live process once and stops forwarding stale output", () => {
  const process = new FakeTerminalProcess(300);
  const output: DesktopTerminalData[] = [];
  const session = new TerminalSession(() => process, {
    onData: (data) => output.push(data),
    onStatus: () => {},
  });

  session.start();
  session.dispose();
  session.dispose();
  process.emitData("stale");

  assert.equal(process.killCount, 1);
  assert.deepEqual(output, []);
  assert.deepEqual(session.status(), { state: "idle" });
});

test("keeps independent owners isolated", () => {
  const firstOutput: DesktopTerminalData[] = [];
  const secondOutput: DesktopTerminalData[] = [];
  const firstProcess = new FakeTerminalProcess(401);
  const secondProcess = new FakeTerminalProcess(402);
  const first = new TerminalSession(() => firstProcess, {
    onData: (data) => firstOutput.push(data),
    onStatus: () => {},
  });
  const second = new TerminalSession(() => secondProcess, {
    onData: (data) => secondOutput.push(data),
    onStatus: () => {},
  });

  first.start();
  second.start();
  firstProcess.emitData("first");
  secondProcess.emitData("second");

  assert.deepEqual(firstOutput, [{ data: "first", sequence: 1 }]);
  assert.deepEqual(secondOutput, [{ data: "second", sequence: 1 }]);
});

test("serializes output behind acknowledgements and applies bounded flow control", () => {
  const process = new FakeTerminalProcess(500);
  const output: DesktopTerminalData[] = [];
  const statuses: DesktopTerminalStatus[] = [];
  const session = new TerminalSession(() => process, {
    onData: (data) => output.push(data),
    onStatus: (status) => statuses.push(status),
  });

  session.start();
  process.emitData("a".repeat(300 * 1024));
  assert.equal(output.length, 1);
  assert.equal(process.pauseCount, 1);

  session.acknowledgeOutput(999);
  assert.equal(output.length, 1);
  for (let index = 0; index < output.length; index += 1) {
    session.acknowledgeOutput(output[index]?.sequence ?? 0);
  }

  assert.ok(output.length > 1);
  assert.equal(process.resumeCount, 1);
  assert.deepEqual(statuses, [{ state: "running", pid: 500 }]);
});

test("replays an unacknowledged chunk when the renderer reconnects", () => {
  const process = new FakeTerminalProcess(501);
  const output: DesktopTerminalData[] = [];
  const session = new TerminalSession(() => process, {
    onData: (data) => output.push(data),
    onStatus: () => {},
  });

  session.start();
  process.emitData("pending");
  session.reconnectOutput();

  assert.deepEqual(output, [
    { data: "pending", sequence: 1 },
    { data: "pending", sequence: 2 },
  ]);
});

test("terminates a producer that exceeds the bounded output buffer", () => {
  const process = new FakeTerminalProcess(502);
  const statuses: DesktopTerminalStatus[] = [];
  const session = new TerminalSession(() => process, {
    onData: () => {},
    onStatus: (status) => statuses.push(status),
  });

  session.start();
  process.emitData("x".repeat(1024 * 1024 + 1));

  assert.equal(process.killCount, 1);
  const finalStatus = statuses.at(-1);
  assert.equal(finalStatus?.state, "error");
  if (finalStatus?.state === "error") assert.match(finalStatus.message, /buffer/u);
});

test("reports launch failures without throwing", () => {
  const statuses: DesktopTerminalStatus[] = [];
  const session = new TerminalSession(
    () => {
      throw new Error("shell unavailable");
    },
    { onData: () => {}, onStatus: (status) => statuses.push(status) },
  );

  assert.deepEqual(session.start(), { state: "error", message: "shell unavailable" });
  assert.deepEqual(statuses, [{ state: "error", message: "shell unavailable" }]);
});
