import electronPath from "electron";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const CHILD_ARG = "--terminal-smoke-child";
const PACKAGED_ARG = "--packaged";
const ASAR_ARG = "--app-asar=";
const MARKER = "__CLICKCLACK_TERMINAL_READY__";

if (!process.argv.includes(CHILD_ARG)) {
  const packaged = process.argv.includes(PACKAGED_ARG);
  const runtime = packaged ? findPackagedRuntime(path.resolve("release")) : electronPath;
  const appAsar = packaged ? findAppAsar(runtime) : "";
  const childArguments = [
    fileURLToPath(import.meta.url),
    CHILD_ARG,
    ...(appAsar ? [`${ASAR_ARG}${appAsar}`] : []),
  ];
  const result = spawnSync(runtime, childArguments, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

const appAsar = process.argv
  .find((argument) => argument.startsWith(ASAR_ARG))
  ?.slice(ASAR_ARG.length);
const require = appAsar
  ? createRequire(path.join(appAsar, "package.json"))
  : createRequire(import.meta.url);
if (appAsar) verifyPackagedTerminalSurface(appAsar);
const { spawn } = require("node-pty");
const windows = process.platform === "win32";
const shell = windows
  ? process.env.ComSpec || process.env.COMSPEC || "cmd.exe"
  : process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
const terminal = spawn(shell, [], {
  cols: 80,
  cwd: os.homedir(),
  env: { ...process.env, TERM: "xterm-256color" },
  name: "xterm-256color",
  rows: 24,
});

let output = "";
let settled = false;
const timeout = setTimeout(() => finish(new Error("terminal native smoke timed out")), 10_000);

terminal.onData((data) => {
  output = (output + data).slice(-16_384);
});
terminal.onExit(() => {
  if (output.includes(MARKER)) finish();
  else finish(new Error(`terminal marker missing from output: ${JSON.stringify(output)}`));
});
terminal.write(`echo ${MARKER}\r`);
terminal.write("exit\r");

function finish(error) {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  if (error) {
    try {
      terminal.kill();
    } catch {
      // The child may already have exited.
    }
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  console.log(`${appAsar ? "packaged " : ""}terminal native smoke passed`);
}

function verifyPackagedTerminalSurface(appAsar) {
  const requiredFiles = [
    "dist/terminal-preload.cjs",
    "dist/terminal-renderer.css",
    "dist/terminal-renderer.js",
    "resources/terminal.html",
  ];
  for (const relativePath of requiredFiles) {
    const file = path.join(appAsar, relativePath);
    if (!existsSync(file) || !statSync(file).isFile()) {
      throw new Error(`packaged terminal resource missing: ${relativePath}`);
    }
  }
  const html = readFileSync(path.join(appAsar, "resources", "terminal.html"), "utf8");
  if (!html.includes("default-src 'none'") || !html.includes("terminal-renderer.js")) {
    throw new Error("packaged terminal document is missing its CSP or renderer entry");
  }
}

function findPackagedRuntime(releaseDirectory) {
  if (!existsSync(releaseDirectory))
    throw new Error("package the desktop app before smoke testing it");
  const candidates = [];
  walk(releaseDirectory, 0, candidates);
  const runtimes = candidates.filter(isPackagedRuntime);
  runtimes.sort((left, right) => runtimePreference(right) - runtimePreference(left));
  const runtime = runtimes[0];
  if (!runtime) throw new Error(`packaged Electron runtime not found under ${releaseDirectory}`);
  return runtime;
}

function walk(directory, depth, files) {
  if (depth > 5) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(entryPath, depth + 1, files);
    else if (entry.isFile()) files.push(entryPath);
  }
}

function isPackagedRuntime(candidate) {
  if (process.platform === "win32") {
    return path.basename(candidate) === "ClickClack.exe" && candidate.includes("win-unpacked");
  }
  if (process.platform === "darwin") {
    return candidate.endsWith(path.join("ClickClack.app", "Contents", "MacOS", "ClickClack"));
  }
  return path.basename(candidate) === "clickclack" && candidate.includes("linux-unpacked");
}

function runtimePreference(runtime) {
  if (process.platform !== "darwin") return 0;
  const armBuild = runtime.includes("arm64");
  return (process.arch === "arm64") === armBuild ? 1 : 0;
}

function findAppAsar(runtime) {
  let directory = path.dirname(runtime);
  for (let depth = 0; depth < 5; depth += 1) {
    for (const resources of ["resources", "Resources"]) {
      const candidate = path.join(directory, resources, "app.asar");
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`app.asar not found beside packaged runtime ${runtime}`);
}
