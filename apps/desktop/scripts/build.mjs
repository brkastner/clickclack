import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  absWorkingDir: root,
  bundle: true,
  entryPoints: {
    main: "src/main.ts",
    "app-preload": "src/app-preload.ts",
    "settings-preload": "src/settings-preload.ts",
    "terminal-preload": "src/terminal-preload.ts",
  },
  external: ["electron", "node-pty"],
  format: "cjs",
  loader: { ".css": "text" },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  platform: "node",
  sourcemap: true,
  target: "node22",
});

await build({
  absWorkingDir: root,
  bundle: true,
  entryPoints: {
    settings: "src/settings.ts",
    "terminal-renderer": "src/terminal-renderer.tsx",
  },
  format: "iife",
  outdir: "dist",
  platform: "browser",
  sourcemap: true,
  target: "chrome136",
});
