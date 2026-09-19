import { expect, test } from "@playwright/test";
import { waitForAppReady } from "./app-ready";
import { createGeneralChannel } from "./channel-fixture";

test.use({ viewport: { width: 390, height: 844 } });

test("hides primary navigation while the software keyboard occludes the viewport", async ({
  page,
}) => {
  const { route } = await createGeneralChannel(page, "Mobile keyboard navigation");
  await page.goto(route);
  await waitForAppReady(page);

  const navigation = page.locator(".mobile-primary-navigation");
  await expect(navigation).toBeVisible();
  await page.locator(".ProseMirror[contenteditable='true']").focus();

  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("Visual Viewport API unavailable");
    Object.defineProperty(viewport, "height", { configurable: true, value: 520 });
    viewport.dispatchEvent(new Event("resize"));
  });

  await expect(navigation).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-mobile-keyboard-open", "");
  await expect
    .poll(() => page.locator(".shell").evaluate((element) => element.getBoundingClientRect().height))
    .toBe(844);

  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("Visual Viewport API unavailable");
    Object.defineProperty(viewport, "height", { configurable: true, value: 844 });
    viewport.dispatchEvent(new Event("resize"));
  });

  await expect(navigation).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-mobile-keyboard-open", "");
});
