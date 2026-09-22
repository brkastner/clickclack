import { expect, test } from "@playwright/test";
import { createGeneralChannel } from "./channel-fixture";

test("home channel context menu dismisses the activity row", async ({ page }) => {
  const { workspace, channel } = await createGeneralChannel(page, "Home Dismiss");
  const posted = await page.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body: "dismiss this channel" },
  });
  expect(posted.ok()).toBe(true);

  await page.goto(`/app/${workspace.route_id}/${channel.route_id}`);
  await expect(page.getByRole("heading", { name: "#general" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace views" })
    .getByRole("link", { name: "home" })
    .click();

  const row = page.getByRole("button", { name: /^Open #general/ }).first();
  await expect(row).toBeVisible();
  await row.click({ button: "right" });

  const menu = page.getByRole("menu", { name: "#general options" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Dismiss from view" }).click();
  await expect(row).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "recent activity" })).toBeVisible();
  await expect(row).toHaveCount(0);
});

test("home conversation popup resend fills its composer without sending", async ({ page }) => {
  const { workspace, channel } = await createGeneralChannel(page, "Home Resend");
  const body = "resend from the home popup";
  const posted = await page.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body },
  });
  expect(posted.ok()).toBe(true);

  await page.goto(`/app/${workspace.route_id}/${channel.route_id}`);
  await expect(page.getByRole("heading", { name: "#general" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace views" })
    .getByRole("link", { name: "home" })
    .click();
  await page
    .getByRole("button", { name: /^Open #general/ })
    .first()
    .click();

  const modal = page.getByRole("dialog", { name: "#general conversation" });
  await expect(modal.getByText(body, { exact: true })).toBeVisible();
  await modal.getByText(body, { exact: true }).hover();

  const sentBodies: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "POST" ||
      !request.url().endsWith(`/api/channels/${channel.id}/messages`)
    )
      return;
    const payload = request.postDataJSON() as { body?: string } | null;
    if (payload?.body) sentBodies.push(payload.body);
  });

  await modal.getByRole("button", { name: "Resend message" }).click();
  await expect(modal.getByLabel("Message #general")).toHaveText(body);
  expect(sentBodies).toEqual([]);
});

test("home conversation popup pastes and sends attachments", async ({ page }) => {
  const { workspace, channel } = await createGeneralChannel(page, "Home Attachment");
  const posted = await page.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body: "open the attachment popup" },
  });
  expect(posted.ok()).toBe(true);

  await page.goto(`/app/${workspace.route_id}/${channel.route_id}`);
  await expect(page.getByRole("heading", { name: "#general" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace views" })
    .getByRole("link", { name: "home" })
    .click();
  await page
    .getByRole("button", { name: /^Open #general/ })
    .first()
    .click();

  const modal = page.getByRole("dialog", { name: "#general conversation" });
  const composer = modal.getByLabel("Message #general");
  await composer.evaluate((node) => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      ),
      (character) => character.charCodeAt(0),
    );
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([bytes], "popup-pasted-image.png", { type: "image/png" }));
    node.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }),
    );
  });

  await expect(
    modal.getByLabel("Pending attachments").getByText("popup-pasted-image.png"),
  ).toBeVisible();
  await composer.fill("message with popup attachment");
  await modal.getByRole("button", { name: "Send", exact: true }).click();

  await expect(modal.getByText("message with popup attachment", { exact: true })).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Open image popup-pasted-image.png" }),
  ).toBeVisible();
});

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
