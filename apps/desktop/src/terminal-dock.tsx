import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DesktopTerminalDimensions, DesktopTerminalStatus } from "./contract";
import type { TerminalCommand, TerminalPresentation } from "./terminal-surface";

export type TerminalClient = {
  close(): void;
  onCommand(callback: (command: TerminalCommand) => void): () => void;
  onData(callback: (data: string, acknowledge: () => void) => void): () => void;
  onPresentation(callback: (presentation: TerminalPresentation) => void): () => void;
  onStatus(callback: (status: DesktopTerminalStatus) => void): () => void;
  outputReady(): void;
  platform: NodeJS.Platform;
  presentation(): Promise<TerminalPresentation>;
  readClipboard(): Promise<string | null>;
  resize(dimensions: DesktopTerminalDimensions): void;
  start(): Promise<DesktopTerminalStatus>;
  status(): Promise<DesktopTerminalStatus>;
  terminate(): Promise<DesktopTerminalStatus>;
  write(data: string): void;
  writeClipboard(text: string): Promise<boolean>;
};

type TerminalDockProps = {
  client: TerminalClient;
  onClose: () => void;
  open: boolean;
};

type TerminalDockErrorBoundaryProps = {
  children: ReactNode;
  onClose: () => void;
};

type TerminalDockErrorBoundaryState = { error: string };

class TerminalDockErrorBoundary extends Component<
  TerminalDockErrorBoundaryProps,
  TerminalDockErrorBoundaryState
> {
  state: TerminalDockErrorBoundaryState = { error: "" };

  static getDerivedStateFromError(error: unknown): TerminalDockErrorBoundaryState {
    return { error: error instanceof Error ? error.message : "Terminal failed to render" };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Terminal dock render failed", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <section className="terminal-dock terminal-dock--error" aria-label="Terminal">
        <div className="terminal-dock__header">
          <strong>Terminal unavailable</strong>
          <button type="button" onClick={this.props.onClose} aria-label="Close terminal">
            Close
          </button>
        </div>
        <p role="alert">{this.state.error}</p>
      </section>
    );
  }
}

function statusText(status: DesktopTerminalStatus, starting: boolean): string {
  if (starting) return "Starting";
  switch (status.state) {
    case "idle":
      return "Not started";
    case "running":
      return `Running · pid ${status.pid}`;
    case "exited":
      return status.exitCode === null ? "Stopped" : `Exited · code ${status.exitCode}`;
    case "error":
      return status.message;
  }
}

function terminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    background: color("--bg", "#1f1d2e"),
    black: color("--panel-3", "#26233a"),
    blue: color("--info", "#9ccfd8"),
    brightBlack: color("--muted-2", "#6e6a86"),
    brightBlue: color("--info", "#9ccfd8"),
    brightCyan: color("--brand-b", "#ebbcba"),
    brightGreen: color("--success", "#9ccfd8"),
    brightMagenta: color("--accent", "#c4a7e7"),
    brightRed: color("--danger", "#eb6f92"),
    brightWhite: color("--text-strong", "#e0def4"),
    brightYellow: color("--warn", "#f6c177"),
    cursor: color("--accent", "#c4a7e7"),
    cursorAccent: color("--bg", "#1f1d2e"),
    cyan: color("--brand-b", "#ebbcba"),
    foreground: color("--text", "#e0def4"),
    green: color("--success", "#9ccfd8"),
    magenta: color("--accent", "#c4a7e7"),
    red: color("--danger", "#eb6f92"),
    selectionBackground: color("--accent-soft", "#403d52"),
    white: color("--text", "#e0def4"),
    yellow: color("--warn", "#f6c177"),
  };
}

function proposedDimensions(
  host: HTMLDivElement,
  xterm: Terminal,
  fitAddon: FitAddon,
): DesktopTerminalDimensions | null {
  if (host.clientWidth < 2 || host.clientHeight < 2) return null;
  const dimensions = fitAddon.proposeDimensions();
  if (!dimensions || dimensions.cols < 2 || dimensions.rows < 1) return null;
  fitAddon.fit();
  return { cols: xterm.cols, rows: xterm.rows };
}

function isTerminalCopyShortcut(event: KeyboardEvent, platform: NodeJS.Platform): boolean {
  const key = event.key.toLowerCase();
  return platform === "darwin"
    ? event.metaKey && !event.ctrlKey && !event.altKey && key === "c"
    : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey && key === "c";
}

function isTerminalPasteShortcut(event: KeyboardEvent, platform: NodeJS.Platform): boolean {
  const key = event.key.toLowerCase();
  return platform === "darwin"
    ? event.metaKey && !event.ctrlKey && !event.altKey && key === "v"
    : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey && key === "v";
}

function TerminalDock({ client, open, onClose }: TerminalDockProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastDimensionsRef = useRef("");
  const [hasOpened, setHasOpened] = useState(open);
  const [initialized, setInitialized] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<DesktopTerminalStatus>({ state: "idle" });
  const [requestError, setRequestError] = useState("");

  const fitAndResize = useCallback(() => {
    const host = hostRef.current;
    const xterm = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!host || !xterm || !fitAddon) return null;
    const dimensions = proposedDimensions(host, xterm, fitAddon);
    if (!dimensions) return null;
    const key = `${dimensions.cols}:${dimensions.rows}`;
    if (key !== lastDimensionsRef.current) {
      lastDimensionsRef.current = key;
      client.resize(dimensions);
    }
    return dimensions;
  }, [client]);

  const startTerminal = useCallback(async () => {
    setStarting(true);
    setRequestError("");
    try {
      setStatus(await client.start());
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not start terminal");
    } finally {
      setStarting(false);
    }
  }, [client]);

  const terminateTerminal = useCallback(async () => {
    setRequestError("");
    try {
      setStatus(await client.terminate());
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not stop terminal");
    }
  }, [client]);

  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  useEffect(() => {
    if (!hasOpened || !hostRef.current) return;
    const host = hostRef.current;
    const xterm = new Terminal({
      allowTransparency: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
        "monospace",
      fontSize: 13,
      lineHeight: 1.18,
      scrollback: 5_000,
      theme: terminalTheme(),
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(host);
    terminalRef.current = xterm;
    fitAddonRef.current = fitAddon;

    const copySelection = () => {
      const selection = xterm.getSelection();
      if (selection) void client.writeClipboard(selection).catch(() => {});
    };
    const pasteClipboard = () => {
      void client
        .readClipboard()
        .then((text) => {
          if (text) xterm.paste(text);
        })
        .catch(() => {});
    };
    xterm.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (isTerminalCopyShortcut(event, client.platform)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        copySelection();
        return false;
      }
      if (isTerminalPasteShortcut(event, client.platform)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pasteClipboard();
        return false;
      }
      return true;
    });

    const inputSubscription = xterm.onData((data) => client.write(data));
    const removeCommandListener = client.onCommand((command) => {
      if (command === "copy") copySelection();
      else pasteClipboard();
    });
    const removeDataListener = client.onData((data, acknowledge) => xterm.write(data, acknowledge));
    const removeStatusListener = client.onStatus((nextStatus) => {
      setStatus(nextStatus);
      setStarting(false);
    });
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(host);

    let startFrame = 0;
    const prepareAndStart = () => {
      const dimensions = proposedDimensions(host, xterm, fitAddon);
      if (!dimensions) {
        startFrame = requestAnimationFrame(prepareAndStart);
        return;
      }
      lastDimensionsRef.current = `${dimensions.cols}:${dimensions.rows}`;
      client.resize(dimensions);
      xterm.focus();
      void startTerminal().finally(() => {
        setInitialized(true);
        client.outputReady();
      });
    };
    startFrame = requestAnimationFrame(prepareAndStart);

    return () => {
      cancelAnimationFrame(startFrame);
      resizeObserver.disconnect();
      removeStatusListener();
      removeDataListener();
      removeCommandListener();
      inputSubscription.dispose();
      fitAddon.dispose();
      xterm.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
    };
  }, [client, fitAndResize, hasOpened, startTerminal]);

  useEffect(() => {
    if (!open || !initialized || !terminalRef.current) return;
    const frame = requestAnimationFrame(() => {
      fitAndResize();
      terminalRef.current?.focus();
      client.outputReady();
    });
    return () => cancelAnimationFrame(frame);
  }, [client, fitAndResize, initialized, open]);

  const currentStatus = requestError || statusText(status, starting);
  const canTerminate = status.state === "running" && !starting;
  const canRestart = initialized && status.state !== "running" && !starting;

  return (
    <section
      className="terminal-dock"
      hidden={!open}
      aria-hidden={!open}
      aria-label="Terminal"
      data-terminal-state={starting ? "starting" : status.state}
    >
      <div className="terminal-dock__header">
        <div className="terminal-dock__identity">
          <span className="terminal-dock__prompt" aria-hidden="true">
            &gt;_
          </span>
          <strong>Terminal</strong>
          <span className="terminal-dock__status" role="status" title={currentStatus}>
            {currentStatus}
          </span>
        </div>
        <div className="terminal-dock__actions">
          {canTerminate ? (
            <button type="button" onClick={terminateTerminal}>
              Terminate
            </button>
          ) : null}
          {canRestart ? (
            <button type="button" onClick={startTerminal}>
              Restart
            </button>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Close terminal">
            Close
          </button>
        </div>
      </div>
      <div className="terminal-dock__viewport" ref={hostRef} />
    </section>
  );
}

function TerminalApplication({ client }: { client: TerminalClient }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const removePresentationListener = client.onPresentation((presentation) => {
      setOpen(presentation.open);
    });
    void client
      .presentation()
      .then((presentation) => setOpen(presentation.open))
      .catch(() => {});
    return removePresentationListener;
  }, [client]);

  return (
    <TerminalDockErrorBoundary onClose={client.close}>
      <TerminalDock client={client} open={open} onClose={client.close} />
    </TerminalDockErrorBoundary>
  );
}

export type MountedTerminalDock = { dispose(): void };

export function mountTerminalDock(
  rootElement: HTMLElement,
  client: TerminalClient,
): MountedTerminalDock {
  const root: Root = createRoot(rootElement);
  root.render(<TerminalApplication client={client} />);
  return { dispose: () => root.unmount() };
}
