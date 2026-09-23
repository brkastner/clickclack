import { expect, test, type Page } from "@playwright/test";
import { waitForAppReady } from "./app-ready";
import { createGeneralChannel } from "./channel-fixture";

async function createChannel(page: Page, workspaceID: string, name: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceID}/channels`, {
    data: { name, kind: "public" },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { channel: { id: string; route_id: string } }).channel;
}

const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const paletteInput = (page: Page) => page.getByRole("combobox", { name: "Search commands" });

test("ctrl+k opens the palette from the composer and jumps to a channel", async ({ page }) => {
  const { workspace, route } = await createGeneralChannel(page, "Palette jump");
  const target = await createChannel(page, workspace.id, "palette-target");
  await page.goto(route);
  await waitForAppReady(page);

  const composer = page.locator(".ProseMirror[contenteditable='true']");
  await composer.click();
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await expect(paletteInput(page)).toBeFocused();
  // The chord never reaches the composer.
  await expect(composer).toHaveText("");

  await paletteInput(page).fill("paltar");
  const option = page.getByRole("option", { name: /palette-target/ });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await expect(palette(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/${target.route_id}$`));
});

test("the palette closes on Escape, on a second ctrl+k, and from the backdrop", async ({
  page,
}) => {
  const { route } = await createGeneralChannel(page, "Palette close");
  await page.goto(route);
  await waitForAppReady(page);

  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
  // Escape inside the palette doesn't also leave the conversation.
  await expect(page).toHaveURL(new RegExp(`${route}$`));

  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeHidden();

  await page.getByRole("button", { name: "Open command palette" }).first().click();
  await expect(palette(page)).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(palette(page)).toBeHidden();
});

test("reopening right after a close keeps the palette open", async ({ page }) => {
  const { route } = await createGeneralChannel(page, "Palette reopen");
  await page.goto(route);
  await waitForAppReady(page);

  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  // Close and reopen inside one task, ahead of the dialog's queued close event.
  await page.evaluate(async () => {
    const chord = { key: "k", code: "KeyK", ctrlKey: true, bubbles: true, cancelable: true };
    window.dispatchEvent(new KeyboardEvent("keydown", chord));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent("keydown", chord));
  });
  await page.waitForTimeout(100);
  await expect(palette(page)).toBeVisible();
  await expect(paletteInput(page)).toBeFocused();
});

test("arrow keys move the selection and actions run", async ({ page }) => {
  const { route } = await createGeneralChannel(page, "Palette actions");
  await page.goto(route);
  await waitForAppReady(page);

  await page.keyboard.press("Control+k");
  await paletteInput(page).fill("new channel");
  await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Create channel" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await paletteInput(page).fill("zzzz-nothing");
  await expect(page.getByText("No matches for “zzzz-nothing”")).toBeVisible();
  await paletteInput(page).fill("");
  const options = page.getByRole("option");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(options.last()).toHaveAttribute("aria-selected", "true");
});

test("the palette works on settings pages and lists channels after a cold load", async ({
  page,
}) => {
  const { workspace, channel } = await createGeneralChannel(page, "Palette settings");
  await page.goto(`/app/${workspace.route_id}/settings/overview`);
  await expect(page.getByRole("dialog", { name: "Workspace settings" })).toBeVisible();

  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await paletteInput(page).fill("general");
  await expect(page.getByRole("option", { name: /general/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/${channel.route_id}$`));
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the topbar button opens a sheet that stays above the keyboard", async ({ page }) => {
    const { route } = await createGeneralChannel(page, "Palette phone");
    await page.goto(route);
    await waitForAppReady(page);

    await page.getByRole("button", { name: "Open command palette" }).first().tap();
    await expect(palette(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Close command palette" })).toBeVisible();

    const panel = page.locator(".command-palette-panel");
    await page.evaluate(() => {
      const viewport = window.visualViewport;
      if (!viewport) throw new Error("Visual Viewport API unavailable");
      Object.defineProperty(viewport, "height", { configurable: true, value: 500 });
      viewport.dispatchEvent(new Event("resize"));
    });
    await expect
      .poll(() => panel.evaluate((element) => element.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(500);

    await page.getByRole("button", { name: "Close command palette" }).tap();
    await expect(palette(page)).toBeHidden();
  });
});
