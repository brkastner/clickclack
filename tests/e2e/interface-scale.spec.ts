import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForAppReady } from "./app-ready";
import { createGeneralChannel } from "./channel-fixture";

// The scale control sits in the same bar it resizes. If the bar scaled with
// everything else, the slider would slide out from under the pointer mid-drag
// and the value would snap to an extreme. These tests pin that down against
// real layout rather than asserting on stylesheet text.

const SCALE_KEY = "clickclack:interface-scale:v1";
const MAX_SCALE = 1.6;

test.beforeEach(async ({ page }) => {
  const { route } = await createGeneralChannel(page, "Interface Scale");
  await page.goto(route);
  await waitForAppReady(page);
  await page.evaluate((key) => window.localStorage.removeItem(key), SCALE_KEY);
});

/** The panel unfurls over 260ms; measuring through that reads a moving box. */
async function settledBox(target: Locator) {
  let previous = await target.boundingBox();
  for (let i = 0; i < 40; i++) {
    await target.page().waitForTimeout(50);
    const next = await target.boundingBox();
    if (
      previous &&
      next &&
      Math.abs(next.x - previous.x) < 0.5 &&
      Math.abs(next.width - previous.width) < 0.5
    ) {
      return next;
    }
    previous = next;
  }
  throw new Error("slider geometry never settled");
}

async function openControl(page: Page) {
  await page.getByRole("button", { name: /Interface scale/ }).click();
  const slider = page.getByRole("slider", { name: "Interface scale" });
  await expect(slider).toBeVisible();
  await settledBox(slider);
  return slider;
}

test("the wheel drives the slider and the track never moves", async ({ page }) => {
  const slider = await openControl(page);
  const before = (await slider.boundingBox())!;
  const sidebarBefore = (await page.locator(".sidebar").boundingBox())!;

  // Four notches up is 0.05 each, so 100% -> 120%.
  await slider.hover();
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
  await expect(slider).toHaveValue("1.2");

  const after = (await slider.boundingBox())!;
  const sidebarAfter = (await page.locator(".sidebar").boundingBox())!;

  // The bar opted out of the zoom: the track is exactly where it was.
  expect(Math.abs(after.x - before.x)).toBeLessThan(1.5);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1.5);
  expect(Math.abs(after.width - before.width)).toBeLessThan(1.5);

  // Everything below it did scale.
  expect(sidebarAfter.width / sidebarBefore.width).toBeGreaterThan(1.15);
  expect(sidebarAfter.width / sidebarBefore.width).toBeLessThan(1.25);

  // Scrolling back down returns to where it started, rather than sticking.
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 120);
  await expect(slider).toHaveValue("1");
});

test("dragging the handle lands where it is dropped", async ({ page }) => {
  const slider = await openControl(page);
  const box = (await slider.boundingBox())!;

  // Drag in steps, which is what previously fed the scale change back into the
  // control's own geometry and threw the value to an extreme.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  const value = Number(await slider.inputValue());
  expect(value).toBeGreaterThan(1.05);
  expect(value).toBeLessThan(MAX_SCALE);
});

test("the chosen scale survives a reload", async ({ page }) => {
  const slider = await openControl(page);
  await slider.hover();
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
  await expect(slider).toHaveValue("1.15");

  await page.reload();
  await waitForAppReady(page);

  const applied = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
  );
  expect(applied).toBe("1.15");

  const stored = await page.evaluate((key) => window.localStorage.getItem(key), SCALE_KEY);
  expect(stored).toBe("1.15");
});

test("the shell still fits the window at a larger scale", async ({ page }) => {
  const slider = await openControl(page);
  await slider.hover();
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
  await expect(slider).toHaveValue("1.3");

  // --app-vh divides the zoom back out; without it the shell overflows and the
  // document scrolls.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
