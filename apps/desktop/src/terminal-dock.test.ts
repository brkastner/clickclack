import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(path.resolve(process.cwd(), "src", relativePath), "utf8");
const readDesktopFile = (relativePath: string) =>
  readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

test("keeps terminal I/O out of the page-facing preload while exposing its toggle", () => {
  const preload = readSource("./app-preload.ts");
  const main = readSource("./main.ts");
  const desktopBridge = readDesktopFile("../web/src/lib/desktop.ts");
  const titlebar = readDesktopFile("../web/src/components/topbar/DesktopTitlebar.svelte");

  assert.match(preload, /toggleTerminal: \(\) => ipcRenderer\.send\("desktop:terminal-toggle"\)/u);
  assert.match(main, /"desktop:terminal-toggle"[\s\S]*isMainSender\(event\)/u);
  assert.match(desktopBridge, /toggleTerminal\(\): void/u);
  assert.match(titlebar, /aria-label="Toggle terminal"/u);
  assert.match(titlebar, /desktop\?\.toggleTerminal\(\)/u);
  assert.doesNotMatch(
    preload,
    /desktop:terminal-(?:data|output|resize|start|status|terminate|write)/u,
  );
  assert.match(preload, /contextBridge\.exposeInMainWorld\("clickclackDesktop"/u);
});

test("routes URI-list files only to the focused composer", () => {
  const preload = readSource("./app-preload.ts");

  assert.match(preload, /DesktopPasteTarget = "composer"/u);
  assert.match(preload, /pasteFileCallbacks\.get\(target\)/u);
  assert.match(preload, /for \(const callback of pasteTextCallbacks\)/u);
  assert.match(preload, /requestNativePaste\(\)/u);
  assert.doesNotMatch(preload, /profile-(?:dark|light)/u);
});

test("uses the full Rosé Pine Moon ANSI palette", () => {
  const source = readSource("./terminal-dock.tsx");

  assert.match(source, /green: color\("--terminal-green", "#3e8fb0"\)/u);
  assert.match(source, /blue: color\("--terminal-blue", "#9ccfd8"\)/u);
  assert.match(source, /cyan: color\("--terminal-cyan", "#ea9a97"\)/u);
  assert.match(source, /brightBlack: color\("--terminal-bright-black", "#908caa"\)/u);
  assert.doesNotMatch(source, /green: color\("--success"/u);
  assert.doesNotMatch(source, /blue: color\("--info"/u);
});

test("loads Kitty graphics support into xterm", () => {
  const source = readSource("./terminal-dock.tsx");
  const packageJSON = readDesktopFile("package.json");

  assert.match(source, /import \{ ImageAddon \} from "@xterm\/addon-image"/u);
  assert.match(source, /new ImageAddon\(\{ kittySupport: true \}\)/u);
  assert.match(source, /xterm\.loadAddon\(imageAddon\)/u);
  assert.match(packageJSON, /"@xterm\/addon-image": "0\.10\.0-beta\.301"/u);
});

test("resizes the native terminal split with pointer and keyboard input", () => {
  const source = readSource("./terminal-dock.tsx");
  const preload = readSource("./terminal-preload.ts");
  const main = readSource("./main.ts");

  assert.match(source, /role="separator"/u);
  assert.match(source, /aria-label="Resize terminal"/u);
  assert.match(source, /event\.currentTarget\.setPointerCapture\(event\.pointerId\)/u);
  assert.match(source, /event\.key === "ArrowUp"/u);
  assert.match(source, /client\.resizeDock\(next\)/u);
  assert.match(preload, /desktop:terminal-resize-dock/u);
  assert.match(main, /terminalSurface\?\.resizeDock\(event, input\)/u);
});

test("mounts the local renderer only into its packaged root", () => {
  const renderer = readSource("./terminal-renderer.tsx");
  const dock = readSource("./terminal-dock.tsx");

  assert.match(renderer, /document\.getElementById\("terminal-root"\)/u);
  assert.match(renderer, /mountTerminalDock\(root, client\)/u);
  assert.doesNotMatch(renderer, /querySelector/u);
  assert.doesNotMatch(dock, /main\.timeline|topbar-actions|desktop-titlebar-actions/u);
  assert.doesNotMatch(dock, /attachShadow|MutationObserver|terminal-toggle/u);
});

test("fits, resizes, focuses, and starts before accepting queued input", () => {
  const source = readSource("./terminal-dock.tsx");
  const firstPresentation =
    source.match(/const prepareAndStart = \(\) => \{([\s\S]*?)\n    \};/u)?.[1] ?? "";
  const fit = firstPresentation.indexOf("proposedDimensions(");
  const resize = firstPresentation.indexOf("client.resize(dimensions)");
  const focus = firstPresentation.indexOf("xterm.focus()");
  const ready = firstPresentation.indexOf("client.outputReady()");
  const start = firstPresentation.indexOf("startTerminal()");

  assert.ok(fit >= 0 && fit < resize && resize < focus && focus < start && start < ready);
  assert.match(source, /const canRestart = initialized &&/u);
});

test("closing hides the native surface without terminating the shell", () => {
  const source = readSource("./terminal-dock.tsx");
  const application =
    source.match(
      /function TerminalApplication[\s\S]*?\n\}\n\nexport type MountedTerminalDock/u,
    )?.[0] ?? "";

  assert.match(application, /onClose=\{client\.close\}/u);
  assert.doesNotMatch(application, /terminate/u);
});

test("acknowledges output only after xterm finishes processing it", () => {
  const source = readSource("./terminal-dock.tsx");
  const preload = readSource("./terminal-preload.ts");

  assert.match(
    source,
    /client\.onData\(\(data, acknowledge\) => xterm\.write\(data, acknowledge\)\)/u,
  );
  assert.match(preload, /desktop:terminal-output-ack/u);
  assert.match(preload, /if \(acknowledged\) return/u);
});

test("keeps platform copy and paste shortcuts local while preserving Ctrl+C input", () => {
  const source = readSource("./terminal-dock.tsx");

  assert.match(source, /event\.ctrlKey && event\.shiftKey[\s\S]*key === "c"/u);
  assert.match(source, /event\.ctrlKey && event\.shiftKey[\s\S]*key === "v"/u);
  assert.match(source, /event\.metaKey[\s\S]*key === "c"/u);
  assert.match(source, /event\.metaKey[\s\S]*key === "v"/u);
  assert.doesNotMatch(source, /event\.ctrlKey && !event\.shiftKey[\s\S]*key === "c"/u);
});

test("closes the terminal when its focused xterm receives CmdOrCtrl+J", () => {
  const source = readSource("./terminal-dock.tsx");

  assert.match(source, /isTerminalToggleShortcut\(event, client\.platform\)/u);
  assert.match(
    source,
    /isTerminalToggleShortcut\(event, client\.platform\)[\s\S]*client\.close\(\)[\s\S]*return false/u,
  );
});

test("uses native sibling views and targets application-only menu actions", () => {
  const main = readSource("./main.ts");
  const addApplication = main.indexOf("window.contentView.addChildView(appView)");
  const addTerminal = main.indexOf("window.contentView.addChildView(localTerminalView)");

  assert.match(main, /const window = new BaseWindow/u);
  assert.ok(addApplication >= 0 && addApplication < addTerminal);
  assert.match(main, /applicationView\?\.webContents\.reload\(\)/u);
  assert.match(main, /applicationView\?\.webContents\.reloadIgnoringCache\(\)/u);
  assert.match(main, /accelerator: "CmdOrCtrl\+J"/u);
  assert.match(main, /desktop:terminal-toggle/u);
  assert.match(
    main,
    /terminalSurface\?\.hide\(\);[\s\S]*applicationView\?\.webContents\.focus\(\)/u,
  );
  assert.match(main, /window\.on\("closed", \(\) => \{[\s\S]*surface\.dispose\(\)/u);
});

test("builds and packages a locked-down local terminal document", () => {
  const build = readDesktopFile("scripts/build.mjs");
  const html = readDesktopFile("resources/terminal.html");
  const terminalPreload = readSource("./terminal-preload.ts");
  const packagedSmoke = readDesktopFile("scripts/smoke-terminal.mjs");
  const builder = readDesktopFile("electron-builder.yml");

  assert.match(build, /"terminal-preload": "src\/terminal-preload\.ts"/u);
  assert.match(build, /"terminal-renderer": "src\/terminal-renderer\.tsx"/u);
  assert.match(html, /default-src 'none'/u);
  assert.match(html, /script-src 'self' 'wasm-unsafe-eval'/u);
  assert.match(html, /style-src 'self' 'unsafe-inline'/u);
  assert.match(html, /connect-src 'none'/u);
  assert.match(html, /frame-src 'none'/u);
  assert.match(html, /id="terminal-root"/u);
  assert.doesNotMatch(terminalPreload, /clickclackDesktop/u);
  assert.match(builder, /- dist\/\*\*\/\*/u);
  assert.match(builder, /- resources\/\*\*\/\*/u);
  assert.match(packagedSmoke, /verifyPackagedTerminalSurface/u);
  assert.match(packagedSmoke, /resources\/terminal\.html/u);
});
