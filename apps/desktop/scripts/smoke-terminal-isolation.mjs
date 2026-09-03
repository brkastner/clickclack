import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import electronPath from "electron";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopDirectory = path.dirname(scriptsDirectory);
const fixture = path.join(scriptsDirectory, "terminal-isolation-smoke");
const surfaceModule = path.join(desktopDirectory, ".test", "terminal-surface-smoke.cjs");
await build({
  absWorkingDir: desktopDirectory,
  bundle: true,
  entryPoints: ["src/terminal-surface.ts"],
  external: ["node-pty"],
  format: "cjs",
  outfile: surfaceModule,
  platform: "node",
  target: "node22",
});
const needsXvfb =
  process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const env = {
  ...process.env,
  CLICKCLACK_TERMINAL_SURFACE_MODULE: surfaceModule,
  ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
};
const result = needsXvfb
  ? spawnSync("xvfb-run", ["-a", electronPath, "--ozone-platform=x11", fixture], {
      env,
      stdio: "inherit",
      timeout: 30_000,
    })
  : spawnSync(electronPath, [fixture], {
      env,
      stdio: "inherit",
      timeout: 30_000,
    });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
