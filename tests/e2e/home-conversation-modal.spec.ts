import { expect, test } from "@playwright/test";
import { createGeneralChannel } from "./channel-fixture";

test("home activity opens a conversation modal with history and a working composer", async ({
  page,
}) => {
  const { workspace, channel } = await createGeneralChannel(page, "Home Peek");

  // Seed enough history that the modal has something to scroll through.
  for (let index = 1; index <= 12; index++) {
    const posted = await page.request.post(`/api/channels/${channel.id}/messages`, {
      data: { body: `seeded history line ${index}` },
    });
    expect(posted.ok()).toBe(true);
  }

  // Land on the workspace first: the home view is reached through the sidebar,
  // and a cold load on the view URL falls back to the default channel.
  await page.goto(`/app/${workspace.route_id}/${channel.route_id}`);
  await expect(page.getByRole("heading", { name: "#general" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace views" })
    .getByRole("link", { name: "home" })
    .click();
  await expect(page.getByRole("heading", { name: "recent activity" })).toBeVisible();

  const row = page.getByRole("button", { name: /^Open #general/ }).first();
  await expect(row).toBeVisible();
  await row.click();

  const modal = page.getByRole("dialog", { name: "#general conversation" });
  await expect(modal).toBeVisible();

  // The modal shows real history, not a two-line preview.
  await expect(modal.getByText("seeded history line 12")).toBeVisible();
  await expect(modal.getByText("seeded history line 9")).toBeVisible();

  // It offers the full-view escape hatch without forcing navigation.
  await expect(modal.getByRole("link", { name: "open full view" })).toHaveAttribute(
    "href",
    `/app/${workspace.route_id}/${channel.route_id}`,
  );

  // Sending from the modal posts into the conversation and renders inline.
  await modal.getByLabel("Message #general").fill("sent from the home modal");
  await modal.getByRole("button", { name: "Send", exact: true }).click();
  await expect(modal.getByText("sent from the home modal")).toBeVisible();

  // Escape closes the modal and leaves home in place.
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "recent activity" })).toBeVisible();
  await expect(page).toHaveURL(/\/views\/home$/);

  // Reopening and using the close button keeps home as the hub.
  await page
    .getByRole("button", { name: /^Open #general/ })
    .first()
    .click();
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Close conversation" }).click();
  await expect(modal).toHaveCount(0);
});
