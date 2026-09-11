import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";

const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { createServer } = await import(webRequire.resolve("vite"));
const { svelte } = await import(webRequire.resolve("@sveltejs/vite-plugin-svelte"));
const root = fileURLToPath(new URL("../apps/web/tests/electron/bot-avatar-packs", import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  plugins: [svelte({ configFile: false })],
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
});
await server.listen();
let app;
try {
  app = await electron.launch({
    executablePath: desktopRequire("electron"),
    args: ["--no-sandbox", `${root}/main.cjs`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let empty = true;
  let broken = new Set();
  const imageRequests = [];
  // Synthetic one-pixel PNG exists only in this test; no avatar images ship.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=",
    "base64",
  );
  await page.route("**/api/avatar-packs**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/avatar-packs")
      return route.fulfill({
        json: { packs: empty ? [] : ["neutral"], directory: "/operator/avatar-packs" },
      });
    if (path === "/api/avatar-packs/neutral")
      return route.fulfill({
        json: { files: ["/api/avatar-packs/neutral/a.png", "/api/avatar-packs/neutral/b.png"] },
      });
    imageRequests.push(path);
    return broken.has(path)
      ? route.fulfill({ status: 404 })
      : route.fulfill({ contentType: "image/png", body: png });
  });
  await page.route(/\/(stored|light|human|human-light|edited|edited-light)\.png$/, (route) => {
    const path = new URL(route.request().url()).pathname;
    return broken.has(path)
      ? route.fulfill({ status: 404 })
      : route.fulfill({ contentType: "image/png", body: png });
  });
  const origin = server.resolvedUrls.local[0];
  await page.goto(origin);
  const toggle = page.getByRole("checkbox", { name: "Use custom bot avatars" });
  await expect(toggle).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("/operator/avatar-packs");
  await expect(toggle).not.toBeChecked();
  empty = false;
  await page.reload();
  await expect(toggle).toBeEnabled();
  await toggle.check();
  await page.getByRole("combobox").selectOption("neutral");
  const botImage = page.getByTestId("bot").locator("img");
  await expect(botImage).toHaveAttribute("src", /\/api\/avatar-packs\/neutral\//);
  const assigned = await botImage.getAttribute("src");
  await mkdir("test-results/avatar-packs", { recursive: true });
  await page.screenshot({
    path: "test-results/avatar-packs/electron-custom-avatars.png",
    fullPage: true,
  });
  for (const surface of ["profile", "background", "pinned"])
    await expect(page.getByTestId(surface).locator("img")).toHaveAttribute("src", assigned);
  await expect(page.getByTestId("human").locator("img")).toHaveAttribute(
    "src",
    /\/human(-light)?\.png/,
  );
  // Identity editing must preview the stored/typed URLs and crop, never the pack.
  await page.getByRole("button", { name: "Edit bot identity" }).click();
  const editor = page.getByTestId("identity-editor");
  const previews = editor.locator("img");
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  await expect(previews).toHaveCount(2);
  for (const preview of await previews.all())
    await expect(preview).toHaveAttribute("src", "/stored.png");
  await editor.getByRole("textbox", { name: "Default or dark avatar URL" }).fill("/edited.png");
  for (const preview of await previews.all())
    await expect(preview).toHaveAttribute("src", "/edited.png");
  await editor.getByRole("textbox", { name: "Light mode avatar URL" }).fill("/edited-light.png");
  await page.getByRole("button", { name: "Light mode", exact: true }).click();
  for (const preview of await previews.all())
    await expect(preview).toHaveAttribute("src", "/edited-light.png");
  const pan = editor.getByRole("img", {
    name: "Sidebar hero preview. Drag to pan. Use arrow keys for fine adjustment.",
  });
  await pan.press("ArrowDown");
  await pan.press("ArrowRight");
  const hero = editor.locator(".profile-editor__hero-preview img");
  await expect(hero).toHaveCSS("object-position", "50% 22%");
  await editor.getByRole("slider", { name: "Sidebar hero zoom" }).evaluate((input) => {
    input.value = "150";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(hero).toHaveCSS("transform", "none");
  await expect.poll(() => hero.evaluate((image) => image.getBoundingClientRect().width / image.parentElement.clientWidth)).toBeCloseTo(1.5);
  // A marked portrait source makes the previously clipped area measurable.
  await page.route("**/hero-test.svg", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="teal"/><path d="M0 200H400M0 400H400M0 600H400" stroke="white" stroke-width="8"/></svg>',
  }));
  await editor.getByRole("textbox", { name: "Light mode avatar URL" }).fill("/hero-test.svg");
  await expect.poll(() => hero.evaluate((image) => image.naturalHeight)).toBe(800);
  const visibleSourceHeights = [];
  for (const zoom of [100, 50, 25]) {
    await editor.getByRole("slider", { name: "Sidebar hero zoom" }).evaluate((input, zoom) => {
      input.value = String(zoom);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, zoom);
    await expect.poll(() => hero.evaluate((image) => image.getBoundingClientRect().width / image.parentElement.clientWidth)).toBeCloseTo(zoom / 100);
    visibleSourceHeights.push(await hero.evaluate((image) => {
      const box = image.getBoundingClientRect();
      const viewport = image.parentElement.getBoundingClientRect();
      return Math.max(0, Math.min(box.bottom, viewport.bottom) - Math.max(box.top, viewport.top)) * image.naturalHeight / box.height;
    }));
  }
  assert.ok(visibleSourceHeights[1] > visibleSourceHeights[0], "50% zoom reveals more portrait content");
  assert.ok(visibleSourceHeights[2] > visibleSourceHeights[1], "25% zoom reveals more portrait content");
  await editor.getByRole("textbox", { name: "Light mode avatar URL" }).fill("/edited-light.png");
  await expect(hero).toHaveAttribute("src", "/edited-light.png");
  await expect(botImage).toHaveAttribute("src", assigned);
  await expect(page.getByTestId("profile").locator("img")).toHaveAttribute("src", assigned);
  await editor.getByRole("button", { name: "Back" }).click();
  console.log(
    "PASS Electron ProfileEditor: enabled pack bypassed in both previews; typed dark/light URLs, pan and zoom preserved; normal bot display still uses pack",
  );
  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(botImage).toHaveAttribute("src", assigned);
  broken = new Set([assigned]);
  await page.reload();
  const alternate = assigned.endsWith("a.png")
    ? "/api/avatar-packs/neutral/b.png"
    : "/api/avatar-packs/neutral/a.png";
  await expect(botImage).toHaveAttribute("src", alternate);
  await page.getByTestId("pinned").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("pinned").locator("img")).toHaveAttribute("src", alternate);
  broken.add(alternate);
  await page.reload();
  await page.getByRole("button", { name: "Light mode" }).click();
  await expect(botImage).toHaveAttribute("src", "/light.png");
  await page.getByTestId("pinned").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("pinned").locator("img")).toHaveAttribute("src", "/light.png");
  await page.getByRole("button", { name: "Dark mode" }).click();
  await expect(botImage).toHaveAttribute("src", "/stored.png");
  broken.add("/stored.png");
  broken.add("/light.png");
  await page.reload();
  await expect(page.getByTestId("bot").locator("img")).toHaveCount(0);
  await page.getByTestId("pinned").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("pinned").locator("img")).toHaveCount(0);
  await expect(page.getByTestId("bot")).toHaveText("B");
  const count = imageRequests.length;
  await page.waitForTimeout(300);
  assert.equal(imageRequests.length, count, "image failure must not retry indefinitely");
  await toggle.uncheck();
  await page.getByTestId("pinned").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("pinned").locator("img")).toHaveCount(0);
  await expect(page.getByTestId("human").locator("img")).toHaveCount(1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS Electron: empty-root guidance, disabled/default-off controls, local reload persistence, stable cross-surface bot assignment, human preservation, alternate → light/dark stored → initials, bounded retries",
  );
} finally {
  await app?.close();
  await server.close();
}
