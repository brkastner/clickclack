import { expect, test, type Route } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { waitForAppReady } from "./app-ready";

test("keeps the DM sidebar spinner live until the agent's final response", async ({ page }) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const workspaceResponse = await page.request.post("/api/workspaces", {
    data: { name: `Working Indicator ${suffix}` },
  });
  const { workspace } = (await workspaceResponse.json()) as {
    workspace: { id: string; route_id: string };
  };
  const botResponse = await page.request.post(`/api/workspaces/${workspace.id}/bots`, {
    data: {
      display_name: `Worker ${suffix}`,
      handle: `worker-${suffix}`,
      token_name: "e2e",
      scopes: ["bot:write"],
    },
  });
  expect(botResponse.status()).toBe(201);
  const { bot, bot_token: botToken } = (await botResponse.json()) as {
    bot: { id: string; display_name: string };
    bot_token: { token: string };
  };
  const directResponse = await page.request.post("/api/dms", {
    data: { workspace_id: workspace.id, member_ids: [bot.id] },
  });
  expect(directResponse.ok()).toBe(true);
  const { conversation } = (await directResponse.json()) as {
    conversation: { id: string; route_id: string };
  };

  await page.goto(`/app/${workspace.route_id}/${conversation.route_id}`);
  await waitForAppReady(page);

  let blockedSend: Route | undefined;
  let releaseSend: (() => void) | undefined;
  let resolveSendRequested: (() => void) | undefined;
  const sendBlocked = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });
  const sendRequested = new Promise<void>((resolve) => {
    resolveSendRequested = resolve;
  });
  await page.route(`**/api/dms/${conversation.id}/messages`, async (route) => {
    if (route.request().method() !== "POST" || blockedSend) {
      await route.continue();
      return;
    }
    blockedSend = route;
    resolveSendRequested?.();
    await sendBlocked;
    await route.continue();
  });

  const dmRow = page.locator(".sidebar .dm-row", { hasText: bot.display_name });
  const working = dmRow.getByRole("status", { name: `Agent is working in ${bot.display_name}` });
  await page.getByLabel("Message body").fill("Please work on this");
  await page.getByRole("button", { name: "Send" }).click();
  await sendRequested;
  await expect(working).toBeVisible();

  const sentResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/dms/${conversation.id}/messages`),
  );
  releaseSend?.();
  const sentHTTPResponse = await sentResponse;
  expect(sentHTTPResponse.ok()).toBe(true);
  const { message: sentMessage } = (await sentHTTPResponse.json()) as {
    message: { id: string };
  };

  const progressResponse = await page.request.post("/api/realtime/ephemeral", {
    headers: { Authorization: `Bearer ${botToken.token}` },
    data: {
      workspace_id: workspace.id,
      direct_conversation_id: conversation.id,
      type: "agent.progress",
      payload: {
        turn_id: sentMessage.id,
        op: "finalize",
        line: {
          id: "thinking",
          kind: "thinking",
          text: "Finished thinking",
          status: "done",
        },
      },
    },
  });
  expect(progressResponse.status()).toBe(202);
  await expect(working).toBeVisible();

  const finalResponse = await page.request.post(`/api/dms/${conversation.id}/messages`, {
    headers: { Authorization: `Bearer ${botToken.token}` },
    data: { body: "The final response", turn_id: sentMessage.id },
  });
  expect(finalResponse.status()).toBe(201);
  await expect(working).toHaveCount(0);
});
