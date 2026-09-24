import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { waitForAppReady } from "./app-ready";

type Fixture = {
  workspace: { id: string; route_id: string };
  conversation: { id: string; route_id: string };
  bot: { id: string; display_name: string };
  botToken: string;
};

async function createDirectWithBot(page: Page): Promise<Fixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const workspaceResponse = await page.request.post("/api/workspaces", {
    data: { name: `Tangent Proof ${suffix}` },
  });
  const { workspace } = (await workspaceResponse.json()) as Fixture;
  const botResponse = await page.request.post(`/api/workspaces/${workspace.id}/bots`, {
    data: {
      display_name: `Sidekick ${suffix}`,
      handle: `sidekick-${suffix}`,
      token_name: "e2e",
      scopes: ["bot:write"],
    },
  });
  expect(botResponse.status()).toBe(201);
  const { bot, bot_token } = (await botResponse.json()) as {
    bot: Fixture["bot"];
    bot_token: { token: string };
  };
  const directResponse = await page.request.post("/api/dms", {
    data: { workspace_id: workspace.id, member_ids: [bot.id] },
  });
  expect(directResponse.ok()).toBe(true);
  const { conversation } = (await directResponse.json()) as Fixture;
  return { workspace, conversation, bot, botToken: bot_token.token };
}

function botPost(request: APIRequestContext, token: string, path: string, data: unknown) {
  return request.post(path, { headers: { Authorization: `Bearer ${token}` }, data });
}

async function openedTangentID(page: Page, open: () => Promise<void>): Promise<string> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === "/api/tangents" &&
        candidate.request().method() === "POST",
    ),
    open(),
  ]);
  expect(response.status()).toBe(201);
  const { tangent } = (await response.json()) as { tangent: { id: string } };
  return tangent.id;
}

test("ctrl+l opens a private tangent that survives hiding, asks before replacing, and ends on reload", async ({
  page,
}) => {
  const fixture = await createDirectWithBot(page);
  await page.goto(`/app/${fixture.workspace.route_id}/${fixture.conversation.route_id}`);
  await waitForAppReady(page);

  const panel = page.getByRole("complementary", { name: "Tangent" });
  const tangentInput = panel.getByLabel("Tangent message");

  // Ctrl+L from the main composer forks a tangent with the DM's agent.
  await page.getByLabel("Message body").click();
  const firstID = await openedTangentID(page, () => page.keyboard.press("Control+l"));
  await expect(panel).toBeVisible();
  await expect(panel.getByText(`Tangent with ${fixture.bot.display_name}`)).toBeVisible();
  await expect(tangentInput).toBeFocused();

  await tangentInput.fill("side question: what's the plan?");
  await tangentInput.press("Enter");
  await expect(panel.locator(".tangent-message.mine")).toContainText(
    "side question: what's the plan?",
  );
  await expect(panel.getByText(`${fixture.bot.display_name} is responding…`)).toBeVisible();

  const reply = await botPost(page.request, fixture.botToken, `/api/tangents/${firstID}/messages`, {
    body: "**side answer** from the fork",
  });
  expect(reply.status()).toBe(201);
  await expect(panel.locator(".tangent-message:not(.mine) strong")).toHaveText("side answer");
  await expect(panel.getByText(`${fixture.bot.display_name} is responding…`)).toHaveCount(0);

  // Nothing from the tangent lands in the conversation itself.
  await expect(page.locator(".timeline")).not.toContainText("side question");
  await expect(page.locator(".timeline")).not.toContainText("side answer");

  // Escape hides it and hands focus back to chat; Ctrl+L brings the same chat back.
  await tangentInput.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByLabel("Message body")).toBeFocused();
  await page.keyboard.press("Control+l");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".tangent-message")).toHaveCount(2);

  // Asking for another tangent while one exists asks first. Open keeps it.
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("new tangent");
  await page.keyboard.press("Enter");
  await expect(panel.getByText("You already have a tangent")).toBeVisible();
  await panel.getByRole("button", { name: "Open existing" }).click();
  await expect(panel.getByText("You already have a tangent")).toHaveCount(0);
  await expect(panel.locator(".tangent-message")).toHaveCount(2);

  // Replace starts a fresh fork and closes the old one on the server.
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("new tangent");
  await page.keyboard.press("Enter");
  const secondID = await openedTangentID(page, () =>
    panel.getByRole("button", { name: "Replace" }).click(),
  );
  expect(secondID).not.toBe(firstID);
  await expect(panel.locator(".tangent-message")).toHaveCount(0);
  const stale = await botPost(page.request, fixture.botToken, `/api/tangents/${firstID}/messages`, {
    body: "late",
  });
  expect(stale.status()).toBe(404);

  // A full reload discards the tangent, here and on the server.
  await page.reload();
  await waitForAppReady(page);
  await expect(panel).toHaveCount(0);
  await expect
    .poll(async () =>
      (
        await botPost(page.request, fixture.botToken, `/api/tangents/${secondID}/messages`, {
          body: "late",
        })
      ).status(),
    )
    .toBe(404);
});

test("the tangent is a full-height sheet on phones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createDirectWithBot(page);
  await page.goto(`/app/${fixture.workspace.route_id}/${fixture.conversation.route_id}`);
  await waitForAppReady(page);

  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("new tangent");
  const id = await openedTangentID(page, () => page.keyboard.press("Enter"));
  expect(id).toMatch(/^tng_/);
  const panel = page.getByRole("complementary", { name: "Tangent" });
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(389);
  expect(box?.height).toBeGreaterThanOrEqual(700);
  // The composer has to stay clear of the bottom navigation.
  const composer = await panel.locator(".tangent-panel__composer").boundingBox();
  const nav = await page.getByRole("navigation", { name: "Primary navigation" }).boundingBox();
  expect(composer).not.toBeNull();
  expect(nav).not.toBeNull();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(nav!.y + 1);
  const input = panel.getByLabel("Tangent message");
  await input.click();
  await expect(input).toBeFocused();

  await panel.getByRole("button", { name: "Hide tangent" }).click();
  await expect(panel).toBeHidden();
});
