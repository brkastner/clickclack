import { expect, test } from "@playwright/test";
import { waitForAppReady } from "./app-ready";
import { createGeneralChannel } from "./channel-fixture";

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the top bar folds its tools into one menu", async ({ page }) => {
    const { route } = await createGeneralChannel(page, "Topbar menu");
    await page.goto(route);
    await waitForAppReady(page);

    const topbar = page.locator(".topbar");
    // Only the palette and the menu trigger stay in the bar.
    await expect(
      topbar.locator(".topbar-actions > button, .topbar-actions > div > button"),
    ).toHaveCount(2);
    await expect(topbar.getByRole("button", { name: "Pinned items" })).toHaveCount(0);

    const trigger = topbar.getByRole("button", { name: "More tools" });
    await trigger.tap();
    const menu = page.getByRole("menu", { name: "More tools" });
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Toggles keep the menu open so the change is visible.
    const avatars = menu.getByRole("menuitemcheckbox", { name: "Large avatars" });
    await expect(avatars).toHaveAttribute("aria-checked", "false");
    await avatars.tap();
    await expect(avatars).toHaveAttribute("aria-checked", "true");
    await expect(menu).toBeVisible();

    const scale = menu.getByRole("group", { name: "Interface scale" }).locator("output");
    await expect(scale).toHaveText("100%");
    await menu.getByRole("menuitem", { name: "Increase interface scale" }).tap();
    await expect(scale).toHaveText("105%");
    await menu.getByRole("menuitem", { name: "Decrease interface scale" }).tap();
    await expect(scale).toHaveText("100%");

    // Tapping outside closes it.
    await page
      .locator(".messages")
      .first()
      .tap({ position: { x: 20, y: 200 } });
    await expect(menu).toBeHidden();

    // Actions that open a panel close the menu. On a phone the pinned pane
    // takes the whole screen, so this goes last.
    await trigger.tap();
    await menu.getByRole("menuitemcheckbox", { name: "Pinned items" }).tap();
    await expect(menu).toBeHidden();
    await expect(page.getByRole("complementary", { name: "Pinned messages pane" })).toBeVisible();
  });

  test("escape closes the menu without leaving the conversation", async ({ page }) => {
    const { route } = await createGeneralChannel(page, "Topbar menu escape");
    await page.goto(route);
    await waitForAppReady(page);

    await page.getByRole("button", { name: "More tools" }).click();
    const menu = page.getByRole("menu", { name: "More tools" });
    await expect(menu).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.getByRole("button", { name: "More tools" })).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`${route}$`));
  });
});

test("wide web keeps the inline tools", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const { route } = await createGeneralChannel(page, "Topbar menu wide");
  await page.goto(route);
  await waitForAppReady(page);
  await expect(page.getByRole("button", { name: "More tools" })).toHaveCount(0);
  await expect(page.locator(".topbar").getByRole("button", { name: "Pinned items" })).toBeVisible();
});
