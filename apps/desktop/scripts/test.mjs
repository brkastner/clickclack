import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testOutputDirectory = path.join(root, ".test");
const contractTest = path.join(testOutputDirectory, "contract.test.cjs");
const terminalDockTest = path.join(testOutputDirectory, "terminal-dock.test.cjs");
const terminalSessionTest = path.join(testOutputDirectory, "terminal-session.test.cjs");
const terminalSurfaceTest = path.join(testOutputDirectory, "terminal-surface.test.cjs");
const releaseArtifactsTest = path.join(root, "scripts", "release-artifacts.test.mjs");
const macosSigningTest = path.join(root, "scripts", "macos-signing.test.mjs");

await build({
  absWorkingDir: root,
  bundle: true,
  entryPoints: [
    "src/contract.test.ts",
    "src/terminal-dock.test.ts",
    "src/terminal-session.test.ts",
    "src/terminal-surface.test.ts",
  ],
  format: "cjs",
  outdir: testOutputDirectory,
  outExtension: { ".js": ".cjs" },
  platform: "node",
  sourcemap: "inline",
  target: "node22",
});

await build({
  absWorkingDir: root,
  bundle: true,
  entryPoints: ["src/main.ts"],
  external: ["electron", "node-pty"],
  format: "cjs",
  outfile: path.join(root, ".test", "main.cjs"),
  platform: "node",
  target: "node22",
});

const result = spawnSync(
  process.execPath,
  [
    "--test",
    contractTest,
    terminalDockTest,
    terminalSessionTest,
    terminalSurfaceTest,
    path.join(root, "scripts", "main.test.mjs"),
    releaseArtifactsTest,
    macosSigningTest,
  ],
  {
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
