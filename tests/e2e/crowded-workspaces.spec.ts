import { expect, test, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { waitForAppReady } from "./app-ready";

// A clipped or off-viewport element keeps its layout box, so toBeVisible()
// still passes for it. Hit-test the centre instead (see workspace-create.spec).
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

// The workspace switcher's menu must scroll internally when many workspaces
// exist so its create controls stay on-screen and interactive.
test("create form stays usable with a crowded workspace menu", async ({ page, request }) => {
  for (let i = 0; i < 14; i++) {
    const name = `Crowd ${i} ${randomUUID().slice(0, 6)}`;
    const response = await request.post("/api/workspaces", { data: { name } });
    expect(response.ok()).toBe(true);
  }

  await page.goto("/app");
  await waitForAppReady(page);
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "New workspace" }).click();
  await expectHittable(page.getByLabel("Workspace name"));
});
