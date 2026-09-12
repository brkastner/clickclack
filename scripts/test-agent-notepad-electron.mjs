import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";

const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { createServer } = await import(webRequire.resolve("vite"));
const { svelte } = await import(webRequire.resolve("@sveltejs/vite-plugin-svelte"));
const root = fileURLToPath(new URL("../apps/web/tests/electron/notepad", import.meta.url));
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
  await page.goto(server.resolvedUrls.local[0]);
  const summary = page.locator("summary");
  await expect(page.getByRole("heading", { name: "Durable notes" })).toHaveCount(0);
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Durable notes" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Progress steps" }).locator("li")).toHaveCount(3);
  assert.equal(await page.evaluate(() => window.NOTEPAD_SCRIPT_RAN), undefined);
  assert.equal(
    await page
      .locator(
        '.notepad-body [onerror], .notepad-body script, .notepad-body a[href^="javascript:"]',
      )
      .count(),
    0,
  );
  await page.getByRole("textbox", { name: "Composer draft" }).fill("Unsent fixture draft");
  await mkdir("test-results/notepad", { recursive: true });
  for (const width of [1100, 390]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 850),
      width,
    );
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") await page.getByRole("button", { name: "Toggle theme" }).click();
      await page.screenshot({
        path: `test-results/notepad/electron-${width}-${theme}.png`,
        fullPage: true,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      assert.equal(overflow, false, `${width} ${theme} horizontal overflow`);
      await expect(page.getByRole("textbox", { name: "Composer draft" })).toBeVisible();
      if (theme === "dark") await page.getByRole("button", { name: "Toggle theme" }).click();
    }
  }
  await page.getByRole("button", { name: "Remote clear" }).click();
  await expect(page.getByRole("status")).toHaveText("No notepad yet.");
  await page.getByRole("button", { name: "Remote replace" }).click();
  await expect(page.getByRole("heading", { name: "Updated notes" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Progress steps" })).toHaveCount(0);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Updated notes" })).toBeVisible();
  await page.getByRole("button", { name: "Switch conversation" }).click();
  await expect(page.getByRole("heading", { name: "Updated notes" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Composer draft" })).toHaveValue(
    "Unsent fixture draft",
  );
  await summary.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("heading", { name: "Updated notes" })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: isolated Electron notepad, both themes and widths, sanitized markdown, steps, clearing, reconnect, keyboard and draft preservation",
  );
} finally {
  await app?.close();
  await server.close();
}
