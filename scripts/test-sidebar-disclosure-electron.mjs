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
  root: fileURLToPath(new URL("../apps/web/tests/electron/sidebar-disclosure", import.meta.url)),
  plugins: [svelte({ configFile: false })],
  server: { host: "127.0.0.1", port: 0, fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
});
await server.listen();
let app;
try {
  app = await electron.launch({ executablePath: desktopRequire("electron"), args: ["--no-sandbox", fileURLToPath(new URL("../apps/web/tests/electron/bot-avatar-packs/main.cjs", import.meta.url))] });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.fulfill({ json: {} }));
  await page.goto(server.resolvedUrls.local[0]);
  const alpha = page.locator('.profile-source-link', { hasText: "Alpha" });
  const beta = page.locator('.profile-source-link', { hasText: "Beta" });
  const empty = page.locator('.profile-source-link', { hasText: "Empty" });
  const list = page.locator('#sidebar-persona-wsp_one-bot_one-channels');
  const key = "clickclack:sidebar-sections:v1:wsp_one";
  await expect(alpha).toHaveAttribute("aria-expanded", "true");
  const selection = await page.getByTestId("selection").textContent();
  const unread = await beta.locator('.persona-unread-stack').textContent();
  await alpha.click();
  await expect(alpha).toHaveAttribute("aria-expanded", "false");
  await expect(list).toBeHidden();
  await expect(beta).toHaveAttribute("aria-expanded", "true");
  await alpha.press("Tab");
  await expect(page.getByRole('button', { name: 'Create channel for Alpha', exact: true })).toBeFocused();
  assert.equal(await list.evaluate(el => el.contains(document.activeElement)), false);
  await alpha.press("Enter");
  await expect(list).toBeVisible();
  await alpha.press("Space");
  await expect(list).toBeHidden();
  await beta.click();
  await expect(empty).not.toHaveAttribute("aria-expanded");
  await expect(empty).not.toHaveAttribute("aria-controls");
  await expect(empty.locator('.persona-disclosure-caret')).toHaveCount(0);
  await expect(page.locator('#sidebar-persona-wsp_one-bot_empty-channels')).toBeHidden();
  await expect(page.getByTestId("events")).toHaveText("[]");
  await expect(page.getByTestId("selection")).toHaveText(selection);
  assert.equal(await beta.locator('.persona-unread-stack').textContent(), unread);
  await page.getByRole('button', { name: 'Create channel for Alpha', exact: true }).click();
  await expect(page.getByTestId("events")).toHaveText('["create:bot_one"]');
  await expect(alpha).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(alpha).toHaveAttribute("aria-expanded", "false");
  await expect(beta).toHaveAttribute("aria-expanded", "false");
  await page.getByRole('button', { name: 'Switch workspace' }).click();
  await expect(alpha).toHaveAttribute("aria-expanded", "true");
  await page.getByRole('button', { name: 'Switch workspace' }).click();
  await expect(alpha).toHaveAttribute("aria-expanded", "false");
  await page.getByRole('button', { name: 'Move Alpha', exact: true }).press('ArrowDown');
  await expect(page.locator('.profile-source-link').first()).toContainText('Beta');
  await expect(alpha).toHaveAttribute("aria-expanded", "false");
  await alpha.click();
  await list.getByRole('link').click();
  await expect(page.getByTestId('events')).toHaveText('["channel:chn_one"]');
  // Existing channel pinning and the persona shelf remain independent of disclosure.
  await list.getByRole('link').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('clickclack:persona-channel-pins:v1:human:wsp_one'))).toContain('chn_one');
  await page.locator('.sidebar-people-row').getByRole('link', { name: /Alpha/ }).first().click();
  await expect(page.getByTestId('events')).toContainText('channel:chn_one');
  // The separate Direct messages list still opens the existing DM.
  await page.locator('a[href="#dm-dm_one"]').click();
  await expect(page.getByTestId('events')).toContainText('direct:dm_one');
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    for (const width of [240, 360]) {
      await page.getByTestId('sidebar-shell').evaluate((el, width) => el.style.width = `${width}px`, width);
      await alpha.focus();
      await expect(alpha).toBeFocused();
      await expect(alpha.locator('.persona-disclosure-caret')).toBeVisible();
      await expect(alpha.locator('.persona-band img')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create channel for Alpha', exact: true })).toBeVisible();
    }
  }
  // Empty headers navigate rather than toggling, without writing disclosure state.
  await page.getByRole('button', { name: 'Clear events' }).click();
  const beforeEmpty = await page.evaluate(key => localStorage.getItem(key), key);
  await empty.click();
  await expect(page.getByTestId('events')).toHaveText('["start:bot_empty"]');
  await page.getByRole('button', { name: 'Clear events' }).click();
  await empty.press('Enter');
  await empty.press('Space');
  await expect(page.getByTestId('events')).toHaveText('["start:bot_empty","start:bot_empty"]');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), beforeEmpty);
  await page.getByRole('button', { name: 'Clear events' }).click();
  await page.getByRole('button', { name: 'Create channel for Empty', exact: true }).click();
  await expect(page.getByTestId('events')).toHaveText('["create:bot_empty"]');
  // Archiving the last owned channel uses the existing DM and leaves no list gap.
  await page.getByRole('button', { name: 'Toggle Alpha channel archive' }).click();
  await expect(alpha).not.toHaveAttribute('aria-expanded');
  await expect(alpha.locator('.persona-disclosure-caret')).toHaveCount(0);
  await expect(list).toBeHidden();
  assert.equal(await list.evaluate(el => el.getBoundingClientRect().height), 0);
  const group = alpha.locator('xpath=../..');
  const header = alpha.locator('xpath=..');
  assert.equal(Math.round((await group.boundingBox()).height), Math.round((await header.boundingBox()).height));
  await page.getByRole('button', { name: 'Clear events' }).click();
  await alpha.click();
  await expect(page.getByTestId('events')).toHaveText('["direct:dm_one"]');
  await page.getByRole('button', { name: 'Toggle Alpha channel archive' }).click();
  await expect(alpha).toHaveAttribute('aria-expanded', 'true');
  await expect(list).toBeVisible();
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ channels: false, directMessages: true })), key);
  await page.reload();
  await expect(alpha).toHaveAttribute('aria-expanded', 'true');
  await alpha.click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  assert.equal(saved.channels, false);
  assert.equal(saved.personas.bot_one, false);
  await page.evaluate(key => localStorage.setItem(key, '{broken'), key);
  await page.reload();
  await expect(alpha).toHaveAttribute('aria-expanded', 'true');
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage unavailable'); };
    Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); };
  });
  await page.reload();
  await alpha.click();
  await expect(alpha).toHaveAttribute('aria-expanded', 'false');
  await alpha.click();
  await expect(alpha).toHaveAttribute('aria-expanded', 'true');
  assert.deepEqual(errors, []);
  console.log('Sidebar disclosure Electron regression passed.');
} finally {
  await app?.close();
  await server.close();
}
