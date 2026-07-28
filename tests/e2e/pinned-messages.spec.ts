import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { waitForAppReady } from "./app-ready";

function clickclack(args: string[]): string {
  return execFileSync("go", ["run", "./apps/api/cmd/clickclack", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
}

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

async function createDirectConversation(page: Page, label: string) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const workspaceResponse = await page.request.post("/api/workspaces", {
    data: { name: `${label} ${suffix}` },
  });
  expect(workspaceResponse.ok()).toBe(true);
  const { workspace } = (await workspaceResponse.json()) as {
    workspace: { id: string; route_id: string };
  };
  const otherUserID = clickclack([
    "admin",
    "user",
    "create",
    "--data",
    "./data/e2e",
    "--workspace",
    workspace.id,
    "--name",
    `${label} User ${suffix}`,
    "--email",
    `pin-direct-${suffix}@example.com`,
  ]);
  const directResponse = await page.request.post("/api/dms", {
    data: { workspace_id: workspace.id, member_ids: [otherUserID] },
  });
  expect(directResponse.ok()).toBe(true);
  const { conversation } = (await directResponse.json()) as {
    conversation: { route_id: string };
  };
  return { workspace, conversation };
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

test("local edits and deletes reconcile the open pinned panel", async ({ page }) => {
  const { suffix, channel } = await openPinChannel(page);
  const body = `Local pin reconciliation ${suffix}`;
  await page.getByLabel("Message body").fill(body);
  await page.getByRole("button", { name: "Send" }).click();
  const row = page.locator(".message-row:not(.is-pending)", { hasText: body });
  await expect(row).toBeVisible();
  const messageID = await row.getAttribute("data-message-id");
  if (!messageID) {
    throw new Error("created message is missing its data-message-id");
  }
  const messageRow = page.locator(`[data-message-id="${messageID}"]`);

  await messageRow.getByRole("button", { name: "More actions" }).focus();
  await page.keyboard.press("Enter");
  await messageRow.getByRole("menuitem", { name: "Pin message" }).click();
  await page.getByRole("button", { name: "Pinned items" }).click();
  const panel = page.getByRole("complementary", { name: "Pinned messages pane" });
  await expect(panel.getByText(body)).toBeVisible();

  const editedBody = `${body} edited locally`;
  await messageRow.getByRole("button", { name: "More actions" }).focus();
  await page.keyboard.press("Enter");
  await messageRow.getByRole("menuitem", { name: "Edit message" }).click();
  await messageRow.getByLabel("Edit message").fill(editedBody);
  await messageRow.getByRole("button", { name: "Save" }).click();
  await expect(panel.getByText(editedBody)).toBeVisible();
  await expect(panel.getByText(body, { exact: true })).toHaveCount(0);

  await messageRow.getByRole("button", { name: "More actions" }).focus();
  await page.keyboard.press("Enter");
  await messageRow.getByRole("menuitem", { name: "Delete message" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete message" });
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText(editedBody)).toHaveCount(0);
  await expect(panel.getByText("No pinned messages")).toBeVisible();

  const persistedResponse = await page.request.get(`/api/channels/${channel.id}/pins`);
  expect(persistedResponse.ok()).toBe(true);
  expect(await persistedResponse.json()).toEqual({ messages: [] });
});

test("thread pin failures remain visible without unhandled errors", async ({ page }) => {
  const { suffix, channel } = await openPinChannel(page);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  const body = `Thread pin failure ${suffix}`;
  await page.getByLabel("Message body").fill(body);
  await page.getByRole("button", { name: "Send" }).click();
  const row = page.locator(".message-row:not(.is-pending)", { hasText: body });
  await expect(row).toBeVisible();
  await row.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await row.hover();
  await row.getByRole("button", { name: "Open thread" }).click();
  const threadPane = page.getByRole("complementary", { name: "Thread pane" });
  await expect(threadPane).toBeVisible();

  await page.route(`**/api/channels/${channel.id}/pins`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Pin limit reached" }),
    });
  });
  const pinButton = threadPane.locator(".thread-root").getByRole("button", {
    name: "Pin message",
  });
  await pinButton.click();
  await expect(threadPane.locator(".thread-pin-error")).toHaveText("Pin limit reached");
  await expect(pinButton).toBeEnabled();
  if (process.env.PIN_THREAD_ERROR_PROOF_PATH) {
    await page.screenshot({ path: process.env.PIN_THREAD_ERROR_PROOF_PATH, fullPage: true });
  }
  expect(pageErrors).toEqual([]);
});

test("pinned-items controls are absent from browser direct conversations", async ({ page }) => {
  const { workspace, conversation } = await createDirectConversation(page, "Browser Pin Direct");
  await page.goto(`/app/${workspace.route_id}/${conversation.route_id}`);
  await waitForAppReady(page);
  await expect(page.getByRole("button", { name: "Pinned items" })).toHaveCount(0);
});

test("pinned-items controls are absent from desktop direct conversations", async ({ page }) => {
  const { workspace, conversation } = await createDirectConversation(page, "Desktop Pin Direct");
  await page.addInitScript(() => {
    Object.assign(window, {
      clickclackDesktop: {
        integratedTitleBar: true,
        platform: "darwin",
        notify: async () => true,
        onNavigate: () => () => {},
        onQuickCompose: () => () => {},
        openSettings: () => {},
        setActiveRoute: () => {},
        setUnreadCount: () => {},
        signInWithGitHub: async () => true,
      },
    });
  });
  await page.goto(`/app/${workspace.route_id}/${conversation.route_id}`);
  await waitForAppReady(page);
  await expect(page.locator(".desktop-titlebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pinned items" })).toHaveCount(0);
  if (process.env.PIN_DESKTOP_DM_PROOF_PATH) {
    await page.screenshot({ path: process.env.PIN_DESKTOP_DM_PROOF_PATH, fullPage: true });
  }
});
