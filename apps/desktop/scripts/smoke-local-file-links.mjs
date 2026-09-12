import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import electronPath from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "scripts", "local-file-links-smoke.cjs");
// Own the test display even on desktop hosts. Compositor focus policy and the
// user's active window must not decide whether synthetic native input arrives.
const needsXvfb = process.platform === "linux";
const result = spawnSync(
  needsXvfb ? "xvfb-run" : electronPath,
  needsXvfb ? ["-a", electronPath, "--ozone-platform=x11", fixture] : [fixture],
  { cwd: root, stdio: "inherit", timeout: 30000 },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
