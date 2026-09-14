// Isolated Electron proof of the production activity projection/disclosure.
// No live API, installed app profile, or existing conversation is used.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";

const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { createServer } = await import(webRequire.resolve("vite"));
const { svelte } = await import(webRequire.resolve("@sveltejs/vite-plugin-svelte"));
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../apps/web/tests/electron/agent-activity", import.meta.url)),
  plugins: [svelte({ configFile: false })],
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
});
let app;
try {
  await server.listen();
  app = await electron.launch({
    executablePath: desktopRequire("electron"),
    args: [
      "--no-sandbox",
      fileURLToPath(
        new URL("../apps/web/tests/electron/bot-avatar-packs/main.cjs", import.meta.url),
      ),
    ],
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin ? route.continue() : route.abort();
  });
  await page.goto(server.resolvedUrls.local[0]);
  const articles = page.locator("article[data-message-id]");
  const ids = () => articles.evaluateAll((nodes) => nodes.map((node) => node.dataset.messageId));
  await expect.poll(ids).toEqual(["tool-1", "human", "tool-3", "final"]);
  const first = page.locator('[data-message-id="tool-1"]');
  const toggle = first.locator(".preamble-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(first.locator(".preamble-tool")).toHaveCount(2);
  await toggle.click();
  await expect(first.locator(".preamble-tool")).toHaveCount(0);

  // Save actual DOM nodes and positions, not just their text. Appending late
  // activity must neither relocate nor recreate earlier keyed rows.
  await articles.evaluateAll((nodes) => {
    window.activityBefore = nodes.map((node) => ({ node, top: node.getBoundingClientRect().top }));
  });
  await page.getByRole("button", { name: "Append late activity" }).click();
  await expect.poll(ids).toEqual(["tool-1", "human", "tool-3", "final", "late", "late-tool"]);
  assert.equal(
    await page.evaluate(() =>
      window.activityBefore.every(
        ({ node, top }, index) =>
          document.querySelectorAll("article[data-message-id]")[index] === node &&
          node.getBoundingClientRect().top === top,
      ),
    ),
    true,
  );
  await expect(page.locator('[data-message-id="late-tool"] .preamble-toggle')).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Electron preserves human/final boundaries, collapses adjacent tools, and keeps earlier DOM rows stable on append.",
  );
} finally {
  await app?.close();
  await server.close();
}
