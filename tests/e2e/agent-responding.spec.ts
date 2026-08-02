import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { waitForAppReady } from "./app-ready";

type AgentTarget = {
  token: string;
  workspaceID: string;
  channelID: string;
};

async function publishProgress(
  request: APIRequestContext,
  target: AgentTarget,
  input: { turnID: string; lineID?: string; op: "append" | "finalize" | "clear" },
) {
  const payload: Record<string, unknown> = {
    turn_id: input.turnID,
    seq: 1,
    op: input.op,
  };
  if (input.lineID) {
    payload.line = {
      id: input.lineID,
      kind: "commentary",
      text: "Working on the response",
      status: input.op === "finalize" ? "done" : "running",
    };
  }
  const response = await request.post("/api/realtime/ephemeral", {
    headers: { Authorization: `Bearer ${target.token}` },
    data: {
      workspace_id: target.workspaceID,
      channel_id: target.channelID,
      type: "agent.progress",
      payload,
    },
  });
  expect(response.status()).toBe(202);
}

test("names concurrent responding agents beside channel and thread composers", async ({ page }) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const workspaceResponse = await page.request.post("/api/workspaces", {
    data: { name: `Responder Proof ${suffix}` },
  });
  const workspace = (await workspaceResponse.json()) as {
    workspace: { id: string; route_id: string };
  };
  const channelResponse = await page.request.post(
    `/api/workspaces/${workspace.workspace.id}/channels`,
    { data: { name: `responders-${suffix}`, kind: "public" } },
  );
  const channel = (await channelResponse.json()) as {
    channel: { id: string; route_id: string; name: string };
  };

  const createBot = async (displayName: string, handle: string) => {
    const response = await page.request.post(`/api/workspaces/${workspace.workspace.id}/bots`, {
      data: {
        display_name: displayName,
        handle,
        token_name: "e2e",
        scopes: ["bot:write"],
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()) as { bot_token: { token: string } };
  };
  const blackbird = await createBot("Blackbird", `blackbird-${suffix}`);
  const nighthawk = await createBot("Nighthawk", `nighthawk-${suffix}`);

  const rootResponse = await page.request.post(`/api/channels/${channel.channel.id}/messages`, {
    data: { body: `Responder thread root ${suffix}` },
  });
  const root = (await rootResponse.json()) as { message: { id: string } };

  await page.goto(`/app/${workspace.workspace.route_id}/${channel.channel.route_id}`);
  await waitForAppReady(page);

  const sharedTurnID = `shared-${suffix}`;
  await publishProgress(
    page.request,
    {
      token: blackbird.bot_token.token,
      workspaceID: workspace.workspace.id,
      channelID: channel.channel.id,
    },
    { turnID: sharedTurnID, lineID: "blackbird-line", op: "append" },
  );
  await publishProgress(
    page.request,
    {
      token: nighthawk.bot_token.token,
      workspaceID: workspace.workspace.id,
      channelID: channel.channel.id,
    },
    { turnID: sharedTurnID, lineID: "nighthawk-line", op: "append" },
  );

  const expectedLabel = "Blackbird and Nighthawk are responding…";
  await expect(page.locator("main .agent-responding .typing-indicator__label")).toHaveText(
    expectedLabel,
  );

  const rootRow = page.locator(`[data-message-id="${root.message.id}"]`);
  await rootRow.hover();
  await rootRow.getByRole("button", { name: "Open thread" }).click();
  const threadPane = page.getByRole("complementary", { name: "Thread pane" });
  await expect(threadPane).toBeVisible();
  await expect(threadPane.locator(".agent-responding .typing-indicator__label")).toHaveText(
    expectedLabel,
  );
  await expect(page.locator("main .agent-responding")).toHaveCount(0);

  await publishProgress(
    page.request,
    {
      token: blackbird.bot_token.token,
      workspaceID: workspace.workspace.id,
      channelID: channel.channel.id,
    },
    { turnID: sharedTurnID, lineID: "blackbird-line", op: "finalize" },
  );
  await expect(threadPane.locator(".agent-responding .typing-indicator__label")).toHaveText(
    "Nighthawk is responding…",
  );

  await publishProgress(
    page.request,
    {
      token: nighthawk.bot_token.token,
      workspaceID: workspace.workspace.id,
      channelID: channel.channel.id,
    },
    { turnID: sharedTurnID, op: "clear" },
  );
  await expect(page.locator(".agent-responding")).toHaveCount(0);
});
