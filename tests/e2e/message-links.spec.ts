import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { waitForAppReady } from "./app-ready";

test("channel message links allocate lazily, copy, and resolve before and after replies", async ({
  browser,
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const highlightedMessageIDs: string[] = [];
      Object.assign(window, { highlightedMessageIDs });
      new MutationObserver(() => {
        for (const row of document.querySelectorAll<HTMLElement>("[data-message-id].highlight")) {
          const id = row.dataset.messageId;
          if (id && !highlightedMessageIDs.includes(id)) highlightedMessageIDs.push(id);
        }
      }).observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
        subtree: true,
      });
    });
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const workspaceResponse = await page.request.post("/api/workspaces", {
    data: { name: `Message links ${suffix}` },
  });
  expect(workspaceResponse.ok()).toBe(true);
  const { workspace } = (await workspaceResponse.json()) as {
    workspace: { id: string; route_id: string };
  };
  const channelResponse = await page.request.post(`/api/workspaces/${workspace.id}/channels`, {
    data: { name: `message-links-${suffix}`, kind: "public" },
  });
  expect(channelResponse.ok()).toBe(true);
  const { channel } = (await channelResponse.json()) as {
    channel: { id: string; route_id: string };
  };
  const body = `Stable message link ${suffix}`;
  const messageResponse = await page.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body },
  });
  expect(messageResponse.ok()).toBe(true);
  const { message } = (await messageResponse.json()) as {
    message: { id: string; route_id?: string };
  };
  expect(message.route_id ?? "").toBe("");

  await page.goto(`/app/${workspace.route_id}/${channel.route_id}`);
  await waitForAppReady(page);
  const frontendBaseURL = new URL(page.url()).origin;
  await page.evaluate((value) => {
    const config = Reflect.get(window, "__CLICKCLACK_CONFIG__") ?? {};
    Object.assign(config, { frontendBaseUrl: value });
    Object.assign(window, { __CLICKCLACK_CONFIG__: config });
  }, frontendBaseURL);
  expect(
    await page.evaluate(() => Reflect.get(window, "__CLICKCLACK_CONFIG__")?.frontendBaseUrl),
  ).toBe(frontendBaseURL);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => Object.assign(window, { copiedMessageLink: value }),
      },
    });
  });
  const row = page.locator(`[data-message-id="${message.id}"]`);
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  const copyLinkMenuItem = row.getByRole("menuitem", { name: "Copy link" });
  if (process.env.MESSAGE_LINK_BEFORE_PATH) {
    const copyLinkElement = await copyLinkMenuItem.elementHandle();
    if (!copyLinkElement) throw new Error("Copy link menu item did not render");
    await copyLinkElement.evaluate((element) => {
      element.style.display = "none";
    });
    await page.screenshot({ path: process.env.MESSAGE_LINK_BEFORE_PATH, fullPage: true });
    await copyLinkElement.evaluate((element) => {
      element.style.removeProperty("display");
    });
  }
  if (process.env.MESSAGE_LINK_AFTER_PATH) {
    await page.screenshot({ path: process.env.MESSAGE_LINK_AFTER_PATH, fullPage: true });
  }

  let releaseRouteRequest: (() => void) | undefined;
  const routeRequestBlocked = new Promise<void>((resolve) => {
    releaseRouteRequest = resolve;
  });
  await page.route(`**/api/messages/${message.id}/route`, async (route) => {
    await routeRequestBlocked;
    await route.continue();
  });
  await row.getByRole("menuitem", { name: "Copy link" }).click();
  await expect(row.getByRole("menuitem", { name: "Creating link…" })).toBeDisabled();
  releaseRouteRequest?.();

  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/messages/${message.id}`);
      const payload = (await response.json()) as { message: { route_id?: string } };
      return payload.message.route_id ?? "";
    })
    .toMatch(/^M[A-Z0-9]{16}$/);
  const routed = await page.request.get(`/api/messages/${message.id}`);
  const { message: routedMessage } = (await routed.json()) as {
    message: { route_id: string };
  };
  const expectedPath = `/app/${workspace.route_id}/${routedMessage.route_id}`;
  const expectedURL = new URL(expectedPath, page.url()).toString();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "copiedMessageLink")))
    .toBe(expectedURL);

  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  await row.getByRole("menuitem", { name: "Copy link" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "copiedMessageLink")))
    .toBe(expectedURL);

  await page.goto(expectedURL);
  await waitForAppReady(page);
  await expect(page).toHaveURL(expectedURL);
  await expect(page.locator(".thread.open")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "highlightedMessageIDs")))
    .toContain(message.id);

  const replyResponse = await page.request.post(`/api/messages/${message.id}/thread/replies`, {
    data: { body: `First reply ${suffix}` },
  });
  expect(replyResponse.ok()).toBe(true);
  const { message: reply } = (await replyResponse.json()) as {
    message: { route_id?: string };
  };
  expect(reply.route_id ?? "").toBe("");
  await page.reload();
  await waitForAppReady(page);
  await expect(page).toHaveURL(expectedURL);
  await expect(page.locator(".thread.open")).toBeVisible();
  await expect(page.locator(".thread-root", { hasText: body })).toBeVisible();
  await expect(page.locator(".reply", { hasText: `First reply ${suffix}` })).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error("clipboard denied")) },
    });
  });
  await page.locator(".thread-root").getByRole("button", { name: "Copy link" }).click();
  const fallback = page.getByRole("dialog", { name: "Copy message link" });
  await expect(fallback).toBeVisible();
  const fallbackInput = fallback.getByLabel("Message link");
  await expect(fallbackInput).toHaveValue(expectedURL);
  await expect(fallbackInput).toBeFocused();
  await expect(fallbackInput).toHaveJSProperty("selectionStart", 0);
  await expect(fallbackInput).toHaveJSProperty("selectionEnd", expectedURL.length);

  const outsiderWorkspaceResponse = await page.request.post("/api/workspaces", {
    data: { name: `Outsider home ${suffix}` },
  });
  expect(outsiderWorkspaceResponse.ok()).toBe(true);
  const { workspace: outsiderWorkspace } = (await outsiderWorkspaceResponse.json()) as {
    workspace: { id: string };
  };
  const outsiderID = execFileSync(
    "go",
    [
      "run",
      "./apps/api/cmd/clickclack",
      "admin",
      "user",
      "create",
      "--data",
      "./data/e2e",
      "--workspace",
      outsiderWorkspace.id,
      "--name",
      `Message Link Outsider ${suffix}`,
      "--email",
      `message-link-outsider-${suffix}@example.com`,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  ).trim();
  const outsiderContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    extraHTTPHeaders: { "X-ClickClack-User": outsiderID },
  });
  const denied = await outsiderContext.request.get(
    `/api/routes/${workspace.route_id}/${routedMessage.route_id}`,
  );
  expect(denied.status()).toBe(404);
  const outsiderPage = await outsiderContext.newPage();
  await outsiderPage.goto(expectedURL);
  await waitForAppReady(outsiderPage);
  await expect(outsiderPage.getByText(body)).toHaveCount(0);
  await expect(outsiderPage).not.toHaveURL(expectedURL);
  await outsiderContext.close();
});
