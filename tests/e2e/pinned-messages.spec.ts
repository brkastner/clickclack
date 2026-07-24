import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { waitForAppReady } from "./app-ready";

async function openPinChannel(page: Page) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const workspaceResponse = await page.request.post("/api/workspaces", {
    data: { name: `Pin Proof ${suffix}` },
  });
  expect(workspaceResponse.ok()).toBe(true);
  const { workspace } = (await workspaceResponse.json()) as {
    workspace: { id: string; route_id: string };
  };
  const channelResponse = await page.request.post(`/api/workspaces/${workspace.id}/channels`, {
    data: { name: `pin-proof-${suffix}`, kind: "public" },
  });
  expect(channelResponse.ok()).toBe(true);
  const { channel } = (await channelResponse.json()) as {
    channel: { id: string; route_id: string; name: string };
  };
  await page.goto(`/app/${workspace.route_id}/${channel.route_id}`);
  await waitForAppReady(page);
  return { suffix, channel };
}

test("pins are shared, persistent, and removable through ClickClack", async ({ page }) => {
  const { suffix, channel } = await openPinChannel(page);
  const body = `Pinned behavior proof ${suffix}`;
  await page.getByLabel("Message body").fill(body);
  await page.getByRole("button", { name: "Send" }).click();
  const row = page.locator(".message-row:not(.is-pending)", { hasText: body });
  await expect(row).toBeVisible();
  const messageID = await row.getAttribute("data-message-id");
  expect(messageID).toBeTruthy();

  const pinResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/channels/${channel.id}/pins`),
  );
  await row.getByRole("button", { name: "More actions" }).focus();
  await page.keyboard.press("Enter");
  await row.getByRole("menuitem", { name: "Pin message" }).click();
  const pinResponse = await pinResponsePromise;
  expect(pinResponse.status()).toBe(201);
  const pinResult = (await pinResponse.json()) as {
    pinned_message: { message_id: string };
    event: { type: string; payload: { message_id?: string } };
  };
  expect(pinResult.pinned_message.message_id).toBe(messageID);
  expect(pinResult.event).toMatchObject({
    type: "pin.added",
    payload: { message_id: messageID },
  });

  await page.getByRole("button", { name: "Pinned items" }).click();
  const panel = page.getByRole("complementary", { name: "Pinned messages pane" });
  await expect(panel.getByText(body)).toBeVisible();

  const editedBody = `${body} edited`;
  const editResponse = await page.request.patch(`/api/messages/${messageID}`, {
    data: { body: editedBody },
  });
  expect(editResponse.ok()).toBe(true);
  await expect(panel.getByText(editedBody)).toBeVisible();
  await expect(panel.getByText(body, { exact: true })).toHaveCount(0);

  await page.reload();
  await waitForAppReady(page);
  const persistedRow = page.locator(`[data-message-id="${messageID}"]`);
  await persistedRow.getByRole("button", { name: "More actions" }).focus();
  await page.keyboard.press("Enter");
  await expect(persistedRow.getByRole("menuitem", { name: "Unpin message" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Pinned items" }).click();
  await expect(panel.getByText(editedBody)).toBeVisible();

  const channelURL = page.url();
  await panel.getByRole("button", { name: "Open thread" }).click();
  await expect(page).not.toHaveURL(channelURL);
  await expect(page.getByRole("complementary", { name: "Thread pane" })).toBeVisible();
  const replyBody = `Pinned thread reply ${suffix}`;
  const threadPane = page.getByRole("complementary", { name: "Thread pane" });
  await threadPane.getByLabel("Reply body").fill(replyBody);
  await threadPane.locator(".reply-composer").getByRole("button", { name: "Reply" }).click();
  const reply = threadPane.locator(".reply", { hasText: replyBody });
  await expect(reply).toBeVisible();
  await reply.getByRole("button", { name: "Pin message" }).click();
  await page.getByRole("button", { name: "Pinned items" }).click();
  await expect(page).toHaveURL(channelURL);
  await expect(panel.getByText(editedBody)).toBeVisible();
  await expect(panel.getByText(replyBody)).toBeVisible();
  await page.reload();
  await waitForAppReady(page);
  await expect(page).toHaveURL(channelURL);
  await expect(
    page.getByRole("complementary", { name: "Thread pane" }).getByText("No thread open"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pinned items" }).click();
  await expect(panel.getByText(editedBody)).toBeVisible();
  await expect(panel.getByText(replyBody)).toBeVisible();

  const unpinResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().endsWith(`/api/channels/${channel.id}/pins/${messageID}`),
  );
  await panel
    .locator(".pinned-panel__item", { hasText: editedBody })
    .getByRole("button", { name: "Unpin message" })
    .click();
  const unpinResponse = await unpinResponsePromise;
  expect(unpinResponse.ok()).toBe(true);
  const unpinResult = (await unpinResponse.json()) as { event: { type: string } };
  expect(unpinResult.event.type).toBe("pin.removed");
  await expect(panel.getByText(editedBody)).toHaveCount(0);
  await panel
    .locator(".pinned-panel__item", { hasText: replyBody })
    .getByRole("button", { name: "Unpin message" })
    .click();
  await expect(panel.getByText(replyBody)).toHaveCount(0);
  await expect(panel.getByText("No pinned messages")).toBeVisible();

  const persistedResponse = await page.request.get(`/api/channels/${channel.id}/pins`);
  expect(persistedResponse.ok()).toBe(true);
  expect(await persistedResponse.json()).toEqual({ messages: [] });
});
