import { expect, test, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { waitForAppReady } from "./app-ready";

// A clipped element keeps its layout box, so toBeVisible() and boundingBox()
// both still pass for it. Hit-test the centre instead: an element clipped by an
// ancestor scroll container is not painted, so it never wins that point.
async function expectHittable(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit === element || element.contains(hit);
      }),
    )
    .toBe(true);
}

test("the workspace create form opens and is not clipped by the switcher", async ({ page }) => {
  await page.goto("/app");
  await waitForAppReady(page);

  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "New workspace" }).click();

  // Regression: nested scroll containers can clip a popover even though its
  // form still has a layout box. The switcher must keep the form hittable.
  const nameInput = page.getByLabel("Workspace name");
  await expectHittable(nameInput);

  const name = `Switcher Workspace ${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  await nameInput.fill(name);
  await nameInput.press("Enter");

  await expect(
    page.getByRole("button", { name: "Switch workspace" }).getByText(name),
  ).toBeVisible();
});
