import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { _electron as electron, expect } from "@playwright/test";
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { createServer } = await import(webRequire.resolve("vite"));
const { svelte } = await import(webRequire.resolve("@sveltejs/vite-plugin-svelte"));
const root = fileURLToPath(new URL("../apps/web/tests/electron/vai-gallery", import.meta.url));
const execFileAsync = promisify(execFile);
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
  const messages = Array.from({ length: 65 }, (_, i) => ({
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
    attachments: [{
      id: `media-${i}`,
      filename: i % 2 ? `video-${i}.mp4` : `image-${i}.png`,
      content_type: i % 2 ? "video/mp4" : "image/png",
      byte_size: 12,
      // Varied portrait/landscape fixture dimensions exercise reserved frames.
      width: i % 3 === 0 ? 180 : 320,
      height: i % 3 === 0 ? 320 : 180,
    }],
  }));
  let olderFails = true;
  let deleted = false;
  let lateMetadata = false;
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
    else if (path === "/api/dms") json = { conversations: [{ id: "dm", members: [user, bot] }] }; 
    else if (path.endsWith("/outputs")) {
      limits.push(url.searchParams.get("limit"));
      const media = messages.filter((message) => message.attachments?.some((upload) => /^(image|video)\//.test(upload.content_type)));
      const limit = Number(url.searchParams.get("limit"));
      const offset = url.searchParams.get("cursor") === "older" ? limit : 0;
      const outputs = media.slice(offset, offset + limit)
        .filter((m) => !deleted || m.id !== "output-0")
        .map((m) => lateMetadata && m.id === "output-0" ? { ...m, attachments: m.attachments?.map((upload) => ({ ...upload, width: 640, height: 120 })) } : m);
      json = { outputs, next_cursor: offset + limit < media.length ? "older" : null };
    } else if (path.startsWith("/api/uploads/")) {
      return route.fulfill({ contentType: "image/png", body: await readFile(`${root}/preview.png`) });
    } else if (path.startsWith("/api/messages/"))
      json = { message: messages.find((m) => m.id === path.split("/").at(-1)) };
    else return route.fulfill({ status: 404 });
    return route.fulfill({ json });
  });
  await page.goto(server.resolvedUrls.local[0]);
  const colorMode = process.env.GALLERY_COLOR_MODE;
  if (colorMode === "light" || colorMode === "dark") {
    await page.evaluate((mode) => { document.documentElement.dataset.colorMode = mode; }, colorMode);
  }
  const sourceSelect = page.getByRole("combobox");
  await expect(sourceSelect).toBeEnabled();
  if (colorMode) {
    await expect(sourceSelect).toHaveCSS("color-scheme", colorMode);
    const optionColors = await sourceSelect.locator("option").evaluateAll((options) =>
      options.map((option) => ({ background: getComputedStyle(option).backgroundColor, color: getComputedStyle(option).color })),
    );
    assert.ok(optionColors.every((option) => option.background !== "rgba(0, 0, 0, 0)" && option.color !== "rgba(0, 0, 0, 0)"));
  }
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
  if (process.env.GALLERY_CAPTURE_OPEN_SELECT === "true") {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await sourceSelect.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const screenshotPath = `${screenshotDir}/gallery-${colorMode || "system"}-open-dropdown.png`;
    await execFileAsync("grim", [screenshotPath]);
    await page.keyboard.press("Escape");
    console.log(`native open select captured: ${screenshotPath}`);
  }
  await sourceSelect.selectOption("bot");
  await expect(page.locator(".output-card")).toHaveCount(60);
  await expect(page.locator(".output-card img").first()).toBeVisible();
  await expect(page.locator("video").first()).toBeVisible();
  await expect.poll(() => page.locator(".output-card img").first().evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await captureScreenshot("gallery-desktop.png");
  if (process.env.GALLERY_NARROW === "true") {
    await page.screenshot({ path: `${screenshotDir}/gallery-narrow-page.png`, fullPage: true, animations: "disabled", timeout: 10_000 });
  }
  console.log("desktop captured");
  const imageOpener = page.getByLabel("Open image from #outputs").first();
  await imageOpener.focus();
  await imageOpener.click();
  await expect(page.getByRole("dialog", { name: /Expanded image-0/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /Expanded image-0/ })).toHaveCount(0);
  await expect(imageOpener).toBeFocused();
  await imageOpener.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to pending message" }).click();
  await page.locator("video").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to pending message" }).click();
  await expect(page.getByLabel("Pending gallery attachments")).toContainText("2 pending");
  await page.getByRole("button", { name: "add to message…" }).click();
  await expect(page.getByRole("dialog", { name: "Choose destination" })).toBeVisible();
  await page.getByRole("button", { name: "VAI" }).click();
  await expect(page.locator('[data-test-source=""]')).toContainText("/app/workspace/dm");
  await page.getByRole("button", { name: "Return to gallery" }).click({ force: true });
  await expect(page.locator(".output-card")).toHaveCount(60);
  const tilePositions = () => page.locator('[data-gallery-block="0"] [data-output-id]').evaluateAll((cards) => cards.slice(0, 3).map((card) => ({ id: card.getAttribute("data-output-id"), x: card.offsetLeft, y: card.offsetTop })));
  const firstBlockPositions = await tilePositions();
  await page.getByRole("button", { name: "load older media" }).click();
  await expect(page.locator(".output-card")).toHaveCount(65);
  assert.deepEqual(await tilePositions(), firstBlockPositions, "appending a page must not move old masonry tiles");
  lateMetadata = true;
  await page.evaluate(() => window.dispatchEvent(new Event("gallery-test-invalidate")));
  await expect.poll(() => page.locator('[data-output-id="output-0"] img').getAttribute("width")).toBe("640");
  assert.deepEqual(await tilePositions(), firstBlockPositions, "late metadata must not move old masonry tiles");
  await page.locator('[data-output-focus="output-31"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-test-source="output-31"]')).toContainText(
    "/app/workspace/channel",
  );
  await page.getByRole("button", { name: "Return to gallery" }).click({ force: true });
  await expect(page.locator(".output-card")).toHaveCount(65);
  await expect(page.locator('[data-output-focus="output-31"]')).toBeFocused();
  await page.getByRole("button", { name: "latest" }).click({ force: true });
  await expect(page.locator('[data-test-source="output-0"]')).toBeVisible();
  assert.ok(limits.includes("1"));
  await page.getByRole("button", { name: "Return to gallery" }).click({ force: true });
  await expect(page.locator(".output-card")).toHaveCount(65);
  deleted = true;
  await page.evaluate(() => window.dispatchEvent(new Event("gallery-test-invalidate")));
  await expect(page.locator('[data-output-id="output-0"]')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(`Gallery Electron visual check passed. Screenshots: ${screenshotDir}/gallery-desktop.png, ${screenshotDir}/gallery-desktop.png`);
} finally {
  await app?.close();
  await server.close();
}
