import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { _electron as electron, expect } from "@playwright/test";
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { createServer } = await import(webRequire.resolve("vite"));
const { svelte } = await import(webRequire.resolve("@sveltejs/vite-plugin-svelte"));
const root = fileURLToPath(new URL("../apps/web/tests/electron/vai-gallery", import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  plugins: [svelte({ configFile: false })],
  resolve: {
    alias: [
      { find: "$app/navigation", replacement: `${root}/navigation.ts` },
      { find: /.*\/lib\/realtime\.svelte$/, replacement: `${root}/realtime.ts` },
    ],
  },
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
    args: ["--no-sandbox", `--gallery-width=${process.env.GALLERY_WIDTH || 1100}`, `--gallery-height=${process.env.GALLERY_HEIGHT || 800}`, `${root}/main.cjs`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const user = { id: "owner", kind: "human", display_name: "Owner", handle: "owner" };
  const bot = { id: "bot", kind: "bot", display_name: "VAI", handle: "vai" };
  const workspace = { id: "workspace", route_id: "w", name: "Synthetic workspace" };
  const screenshotDir = process.env.GALLERY_SCREENSHOT_DIR || "/tmp/clickclack-gallery-visual";
  await import("node:fs/promises").then(({ mkdir }) => mkdir(screenshotDir, { recursive: true }));
  const messages = Array.from({ length: 35 }, (_, i) => ({
    id: `output-${i}`,
    workspace_id: workspace.id,
    channel_id: "channel",
    author_id: bot.id,
    author: bot,
    body: `Synthetic response ${i}`,
    body_format: "markdown",
    kind: "message",
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 35 - i)).toISOString(),
    thread_root_id: `output-${i}`,
    channel_seq: 35 - i,
    ...(i === 31
      ? { parent_message_id: "output-34", thread_root_id: "output-34", thread_seq: 2 }
      : {}),
    ...(i === 0
      ? { attachments: [{ id: "image", filename: "image.png", content_type: "image/png", byte_size: 12, width: 320, height: 180 }] }
      : i === 31
        ? { attachments: [{ id: "video", filename: "video.mp4", content_type: "video/mp4", byte_size: 12, width: 320, height: 180 }] }
        : {}),
  }));
  let olderFails = true;
  let deleted = false;
  const limits = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let json;
    if (path === "/api/me") json = { user };
    else if (path === "/api/workspaces") json = { workspaces: [workspace] };
    else if (path.endsWith("/members"))
      json = {
        members: [bot, { ...bot, id: "other", handle: "other" }].map((user) => ({
          user,
          role: "bot",
        })),
        has_more: false,
      };
    else if (path.endsWith("/channels")) json = { channels: [{ id: "channel", name: "outputs" }] };
    else if (path === "/api/dms") json = { conversations: [] };
    else if (path.endsWith("/outputs")) {
      limits.push(url.searchParams.get("limit"));
      const media = messages.filter((message) => message.attachments?.some((upload) => /^(image|video)\//.test(upload.content_type)));
      const limit = Number(url.searchParams.get("limit"));
      json = { outputs: media.slice(0, limit).filter((m) => !deleted || m.id !== "output-0"), next_cursor: null };
    } else if (path.startsWith("/api/uploads/")) {
      return route.fulfill({ contentType: "image/png", body: await readFile(`${root}/preview.png`) });
    } else if (path.startsWith("/api/messages/"))
      json = { message: messages.find((m) => m.id === path.split("/").at(-1)) };
    else return route.fulfill({ status: 404 });
    return route.fulfill({ json });
  });
  await page.goto(server.resolvedUrls.local[0]);
  await expect(page.getByRole("combobox")).toBeEnabled();
  if (process.env.GALLERY_NARROW === "true") {
    console.log("narrow bounds", await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(390, 760);
      return window.getSize();
    }));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.log("gallery fixture ready", await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  await expect(page.locator(".output-card")).toHaveCount(0);
  const captureScreenshot = async (name) => {
    const data = await app.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
      return image.toPNG().toString("base64");
    });
    await writeFile(`${screenshotDir}/${name}`, Buffer.from(data, "base64"));
  };
  await page.getByRole("combobox").selectOption("bot");
  await expect(page.locator(".output-card")).toHaveCount(2);
  await expect(page.locator(".output-card img")).toBeVisible();
  await expect(page.locator("video")).toBeVisible();
  await expect.poll(() => page.locator(".output-card img").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await captureScreenshot("gallery-desktop.png");
  if (process.env.GALLERY_NARROW === "true") {
    await page.screenshot({ path: `${screenshotDir}/gallery-narrow-page.png`, fullPage: true, animations: "disabled", timeout: 10_000 });
  }
  console.log("desktop captured");
  await page.locator('[data-output-focus="output-31"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-test-source="output-31"]')).toContainText(
    "/app/workspace/channel",
  );
  await page.getByRole("button", { name: "Return to gallery" }).click({ force: true });
  await expect(page.locator(".output-card")).toHaveCount(2);
  await expect(page.locator('[data-output-focus="output-31"]')).toBeFocused();
  await page.getByRole("button", { name: "latest" }).click({ force: true });
  await expect(page.locator('[data-test-source="output-0"]')).toBeVisible();
  assert.ok(limits.includes("1"));
  await page.getByRole("button", { name: "Return to gallery" }).click({ force: true });
  await expect(page.locator(".output-card")).toHaveCount(2);
  deleted = true;
  await page.evaluate(() => window.dispatchEvent(new Event("gallery-test-invalidate")));
  await expect(page.locator('[data-output-id="output-0"]')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(`Gallery Electron visual check passed. Screenshots: ${screenshotDir}/gallery-desktop.png, ${screenshotDir}/gallery-desktop.png`);
} finally {
  await app?.close();
  await server.close();
}
