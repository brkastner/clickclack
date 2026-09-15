#!/usr/bin/env node
/**
 * Build the Android app and install it on a device, in one command.
 *
 * `pnpm mobile:install`
 *
 * What this exists to absorb: the server URL is baked into the app at build
 * time, the device lives on a tailnet rather than on whatever Wi-Fi this
 * machine is on, Android rotates its wireless-debugging port on every toggle,
 * and Gradle refuses the newest JDK a workstation is likely to default to.
 * Remembering all four every time is how a working setup becomes an unused one.
 *
 * Defaults come from live Tailscale status: this machine on port 8080 and the
 * `pixel-10-pro` peer on adb port 5555. apps/mobile/.env.local can override
 * those defaults without putting a personal host in a commit, and environment
 * variables win over both:
 *
 *   CLICKCLACK_SERVER_URL      origin the app loads, baked in at build time
 *   CLICKCLACK_ANDROID_DEVICE  adb target, for example phone.tailnet:5555
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SERVER_URL, normalizeServerURL, SERVER_URL_ENV } from "../src/contract.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEVICE_ENV = "CLICKCLACK_ANDROID_DEVICE";
const DEFAULT_ANDROID_PEER = "pixel-10-pro";
const DEFAULT_CLICKCLACK_PORT = 8080;

/**
 * The port `adb tcpip` parks on. Android's wireless debugging screen shows a
 * port that changes every time it is toggled, which is useless to hardcode;
 * switching the daemon to a fixed port is what makes a saved address keep
 * working. It survives until the phone reboots.
 */
const STABLE_ADB_PORT = 5555;

/**
 * Gradle rejects a JDK newer than it knows about, and a workstation's default
 * `java` is often exactly that. Anything up to this major is acceptable.
 */
const MAX_JDK_MAJOR = 24;

/** Parse a KEY=value file. Quotes are stripped; everything else is literal. */
export function parseEnvFile(text) {
  const values = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const split = trimmed.indexOf("=");
    if (split <= 0) continue;
    const key = trimmed.slice(0, split).trim();
    let value = trimmed.slice(split + 1).trim();
    if (value.length > 1 && (value.startsWith('"') || value.startsWith("'"))) {
      const quote = value[0];
      if (value.endsWith(quote)) value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** Turn `tailscale status --json` into this machine's app URL and the phone's host. */
export function tailnetDefaults(status, peerName = DEFAULT_ANDROID_PEER) {
  const withoutDot = (value) => (typeof value === "string" ? value.replace(/\.$/, "") : "");
  const selfDNS = withoutDot(status?.Self?.DNSName);
  const peers = Object.values(status?.Peer ?? {});
  const phone = peers.find(
    (peer) => peer?.HostName === peerName || withoutDot(peer?.DNSName).split(".")[0] === peerName,
  );
  return {
    serverURL: selfDNS ? `https://${selfDNS}:${DEFAULT_CLICKCLACK_PORT}` : DEFAULT_SERVER_URL,
    device: withoutDot(phone?.DNSName) || peerName,
  };
}

/** Real environment wins, then the local file, then live tailnet discovery. */
export function resolveSettings(env, fileValues, discovered = {}) {
  return {
    serverURL:
      env[SERVER_URL_ENV] ||
      fileValues[SERVER_URL_ENV] ||
      discovered.serverURL ||
      DEFAULT_SERVER_URL,
    device: env[DEVICE_ENV] || fileValues[DEVICE_ENV] || discovered.device || "",
  };
}

/** Add the stable port to a bare host, so the setting can be just a hostname. */
export function adbTarget(device, port = STABLE_ADB_PORT) {
  const value = device.trim();
  if (!value) return "";
  // A bracketed IPv6 literal, or a host that already names a port.
  if (value.startsWith("[")) return value.includes("]:") ? value : `${value}:${port}`;
  const colons = value.split(":").length - 1;
  if (colons === 1) return value;
  if (colons > 1) return `[${value}]:${port}`;
  return `${value}:${port}`;
}

export function jdkMajor(name) {
  const numbers = name.match(/\d+/g)?.map(Number) ?? [];
  // Some JDK 8-17 packages kept the old `java-1.<major>` naming scheme.
  if (numbers[0] === 1 && numbers.length > 1) return numbers[1];
  return numbers[0] ?? null;
}

/**
 * Pick the newest installed JDK that Gradle will accept. A JAVA_HOME that is
 * already acceptable is left alone; one that is too new is not, because being
 * silently ignored is worse than being replaced with an explanation.
 */
export function chooseJDK(current, candidates, max = MAX_JDK_MAJOR) {
  const currentMajor = current ? jdkMajor(path.basename(current)) : null;
  if (current && (currentMajor === null || currentMajor <= max)) return current;
  const usable = candidates
    .map((dir) => ({ dir, major: jdkMajor(path.basename(dir)) }))
    .filter((entry) => entry.major !== null && entry.major <= max)
    .sort((a, b) => b.major - a.major);
  return usable.length > 0 ? usable[0].dir : current;
}

function installedJDKs(root = "/usr/lib/jvm") {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => path.join(root, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, "bin/javac")));
}

function androidSDK(env) {
  const configured = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (configured && fs.existsSync(configured)) return configured;
  const fallback = path.join(os.homedir(), "Android/Sdk");
  if (fs.existsSync(fallback)) return fallback;
  throw new Error("No Android SDK found. Set ANDROID_HOME or install the SDK.");
}

function discoverTailnet() {
  const result = spawnSync("tailscale", ["status", "--json"], { encoding: "utf8" });
  if (result.status !== 0) return {};
  try {
    return tailnetDefaults(JSON.parse(result.stdout));
  } catch {
    return {};
  }
}

function adb(args, { quiet = false } = {}) {
  const result = spawnSync("adb", args, { encoding: "utf8" });
  if (result.error) throw new Error("adb is not installed or not on PATH");
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (!quiet && output) console.log(output);
  return { ok: result.status === 0, output };
}

/** Devices adb currently considers usable, excluding ones that are unauthorized. */
export function connectedDevices(devicesOutput) {
  return devicesOutput
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.endsWith("\tdevice") || line.endsWith(" device"))
    .map((line) => line.split(/\s+/)[0]);
}

function pairingHelp(target) {
  return [
    "No device is connected.",
    "",
    "On the phone: Settings > Developer options > Wireless debugging > on,",
    'then "Pair device with pairing code". That popup shows a pairing port and',
    "a six-digit code; the screen behind it shows a different, connect port.",
    "",
    "  adb pair <host>:<pairing-port>     # enter the six-digit code",
    "  adb connect <host>:<connect-port>",
    `  adb tcpip ${STABLE_ADB_PORT}`,
    "",
    `That last line is the one that matters: it moves the daemon to port ${STABLE_ADB_PORT},`,
    `so ${target || "the saved device"} keeps working until the phone reboots and`,
    "this command needs no arguments again.",
  ].join("\n");
}

/** adb exits 0 for some failed connects, so inspect its text too. */
function tryConnect(target) {
  const connected = adb(["connect", target], { quiet: true });
  return connected.ok && !/failed|unable|refused/i.test(connected.output);
}

/**
 * Get the phone on the line. If it is connected through Android's rotating
 * wireless port (or USB), move adbd to the fixed tailnet port as part of the
 * same run. That makes every later install a true one-command operation.
 */
function connectDevice(target) {
  if (!target) throw new Error(pairingHelp(target));
  const existing = connectedDevices(adb(["devices"], { quiet: true }).output);
  if (existing.includes(target)) {
    console.log(`device: ${target} (already connected)`);
    return target;
  }

  if (tryConnect(target)) {
    console.log(`device: ${target}`);
    return target;
  }

  if (existing.length === 0) throw new Error(pairingHelp(target));

  const bootstrap = existing[0];
  console.log(`device: moving ${bootstrap} to ${target}`);
  const tcp = adb(["-s", bootstrap, "tcpip", String(STABLE_ADB_PORT)], { quiet: true });
  if (!tcp.ok || !/restarting in TCP mode/i.test(tcp.output)) {
    throw new Error(`${tcp.output}\n\n${pairingHelp(target)}`);
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (tryConnect(target)) return target;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }
  throw new Error(pairingHelp(target));
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function main() {
  const env = process.env;
  const envFile = path.join(ROOT, ".env.local");
  const fileValues = fs.existsSync(envFile) ? parseEnvFile(fs.readFileSync(envFile, "utf8")) : {};
  const settings = resolveSettings(env, fileValues, discoverTailnet());
  // Validate with the same rule the shell itself applies, so a bad URL fails
  // here rather than after a full Gradle build.
  const origin = normalizeServerURL(settings.serverURL);
  const target = adbTarget(settings.device);

  console.log(`server: ${origin}`);
  const device = connectDevice(target);

  const android = path.join(ROOT, "android");
  const sdk = androidSDK(env);
  const childEnv = {
    ...env,
    [SERVER_URL_ENV]: origin,
    ANDROID_HOME: sdk,
    ANDROID_SERIAL: device,
  };
  const jdk = chooseJDK(env.JAVA_HOME, installedJDKs());
  if (jdk) {
    childEnv.JAVA_HOME = jdk;
    if (jdk !== env.JAVA_HOME) console.log(`jdk: ${jdk}`);
  }

  // Regenerating is idempotent, so this covers a fresh clone and a change to
  // the server URL with the same command.
  const pnpm = env.npm_execpath ? process.execPath : "pnpm";
  const pnpmArgs = env.npm_execpath ? [env.npm_execpath] : [];
  const script = fs.existsSync(android) ? "sync" : "add:android";
  run(pnpm, [...pnpmArgs, "run", script], { cwd: ROOT, env: childEnv });

  fs.writeFileSync(path.join(android, "local.properties"), `sdk.dir=${sdk}\n`);
  const gradlew = path.join(android, "gradlew");
  run(gradlew, ["installDebug", "--console=plain"], { cwd: android, env: childEnv });
  console.log(`\nInstalled on ${device}. The app loads ${origin}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exit(1);
  }
}
