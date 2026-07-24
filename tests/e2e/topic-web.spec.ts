import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { waitForAppReady } from "./app-ready";

function clickclack(args: string[]): string {
  return execFileSync("go", ["run", "./apps/api/cmd/clickclack", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
}

test("topic selector, labels, filter, clear, and realtime stay coherent", async ({ page }) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const workspaceResponse = await page.request.post("/api/workspaces", {
    data: { name: `Topic UX ${suffix}` },
  });
  expect(workspaceResponse.ok()).toBe(true);
  const { workspace } = (await workspaceResponse.json()) as {
    workspace: { id: string; route_id: string };
  };
  const channelResponse = await page.request.post(`/api/workspaces/${workspace.id}/channels`, {
    data: { name: "topic-lab", kind: "public" },
  });
  expect(channelResponse.ok()).toBe(true);
  const { channel } = (await channelResponse.json()) as {
    channel: { id: string; route_id: string };
  };
  const secondChannelResponse = await page.request.post(
    `/api/workspaces/${workspace.id}/channels`,
    {
      data: { name: "topic-neighbor", kind: "public" },
    },
  );
  expect(secondChannelResponse.ok()).toBe(true);
  const { channel: secondChannel } = (await secondChannelResponse.json()) as {
    channel: { id: string; route_id: string; name: string };
  };
  const topicResponse = await page.request.post(`/api/workspaces/${workspace.id}/topics`, {
    data: { name: "Release", channel_id: channel.id },
  });
  expect(topicResponse.ok()).toBe(true);
  const { topic } = (await topicResponse.json()) as {
    topic: { id: string };
  };
  const otherTopicResponse = await page.request.post(`/api/workspaces/${workspace.id}/topics`, {
    data: { name: "Design" },
  });
  expect(otherTopicResponse.ok()).toBe(true);
  const { topic: otherTopic } = (await otherTopicResponse.json()) as {
    topic: { id: string };
  };

  async function currentChannelState(): Promise<{ last_read_seq?: number; unread_count?: number }> {
    const response = await page.request.get(`/api/workspaces/${workspace.id}/channels`);
    const data = (await response.json()) as {
      channels: { id: string; last_read_seq?: number; unread_count?: number }[];
    };
    const current = data.channels.find((candidate) => candidate.id === channel.id);
    if (!current) throw new Error("channel missing from list");
    return current;
  }

  await page.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body: "untagged baseline" },
  });
  await page.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body: "release baseline", topic_id: topic.id },
  });
  await page.request.post(`/api/channels/${secondChannel.id}/messages`, {
    data: { body: "neighbor untagged" },
  });
  const senderID = clickclack([
    "admin",
    "user",
    "create",
    "--data",
    "./data/e2e",
    "--workspace",
    workspace.id,
    "--name",
    `Topic Sender ${suffix}`,
    "--email",
    `topic-sender-${suffix}@example.com`,
  ]);

  await page.goto(`/app/${workspace.route_id}/${channel.route_id}`);
  await waitForAppReady(page);

  const topicSelect = page.getByLabel("Message topic");
  await expect(topicSelect).toBeVisible();
  await topicSelect.selectOption({ label: "Release" });
  await page.getByLabel("Message body").fill("release from composer");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("release from composer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Filter by topic Release" }).last()).toBeVisible();

  await page.getByRole("button", { name: "Filter by topic Release" }).first().click();
  await expect(page.getByText("Showing topic")).toContainText("Release");
  await expect(page.getByText("untagged baseline")).toHaveCount(0);
  await expect(page.getByText("release baseline")).toBeVisible();
  const filteredReadSeq = (await currentChannelState()).last_read_seq || 0;
  if (process.env.TOPIC_FILTER_PROOF_PATH) {
    await page.screenshot({ path: process.env.TOPIC_FILTER_PROOF_PATH, fullPage: true });
  }

  const nonmatchingResponse = await page.request.post(`/api/channels/${channel.id}/messages`, {
    headers: { "X-ClickClack-User": senderID },
    data: { body: "design realtime", topic_id: otherTopic.id },
  });
  expect(nonmatchingResponse.ok()).toBe(true);
  await page.waitForTimeout(250);
  await expect(page.getByText("design realtime")).toHaveCount(0);

  const matchingResponse = await page.request.post(`/api/channels/${channel.id}/messages`, {
    headers: { "X-ClickClack-User": senderID },
    data: { body: "release realtime", topic_id: topic.id },
  });
  expect(matchingResponse.ok()).toBe(true);
  await expect(page.getByText("release realtime")).toBeVisible();
  await page.getByLabel("Message body").fill("release while filtered");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("release while filtered")).toBeVisible();
  await page.waitForTimeout(400);
  expect((await currentChannelState()).last_read_seq || 0).toBe(filteredReadSeq);
  expect((await currentChannelState()).unread_count || 0).toBe(2);

  await page.getByRole("link", { name: `# ${secondChannel.name}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: `#${secondChannel.name}` })).toBeVisible();
  await expect(page.getByText("Showing topic")).toHaveCount(0);
  await expect(page.getByText("neighbor untagged")).toBeVisible();
  const originalChannelLink = page
    .locator("#sidebar-channels-list")
    .locator("a.nav-item.channel", { hasText: "topic-lab" });
  await expect(originalChannelLink.getByLabel("2 unread", { exact: true })).toBeVisible();

  await originalChannelLink.click();
  await expect(page.getByRole("heading", { name: "#topic-lab" })).toBeVisible();
  await page.getByRole("button", { name: "Filter by topic Release" }).first().click();
  await expect(page.getByText("Showing topic")).toContainText("Release");

  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(page.getByText("Showing topic")).toHaveCount(0);
  await expect(page.getByText("untagged baseline")).toBeVisible();
  await expect(page.getByText("design realtime")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 760 });
  const closeNavigation = page.getByLabel("Close navigation");
  if (await closeNavigation.isVisible()) await closeNavigation.click();
  await page.waitForTimeout(250);
  await expect(topicSelect).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  if (process.env.TOPIC_MOBILE_PROOF_PATH) {
    await page.screenshot({ path: process.env.TOPIC_MOBILE_PROOF_PATH, fullPage: true });
  }
});

test("switching topic filters discards delayed pagination from the previous filter", async ({
  page,
}) => {
  test.slow();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const workspaceResponse = await page.request.post("/api/workspaces", {
    data: { name: `Topic paging ${suffix}` },
  });
  expect(workspaceResponse.ok()).toBe(true);
  const { workspace } = (await workspaceResponse.json()) as {
    workspace: { id: string; route_id: string };
  };
  const channelResponse = await page.request.post(`/api/workspaces/${workspace.id}/channels`, {
    data: { name: "topic-paging", kind: "public" },
  });
  expect(channelResponse.ok()).toBe(true);
  const { channel } = (await channelResponse.json()) as {
    channel: { id: string; route_id: string };
  };
  const releaseResponse = await page.request.post(`/api/workspaces/${workspace.id}/topics`, {
    data: { name: "Release", channel_id: channel.id },
  });
  const designResponse = await page.request.post(`/api/workspaces/${workspace.id}/topics`, {
    data: { name: "Design", channel_id: channel.id },
  });
  expect(releaseResponse.ok()).toBe(true);
  expect(designResponse.ok()).toBe(true);
  const release = ((await releaseResponse.json()) as { topic: { id: string } }).topic;
  const design = ((await designResponse.json()) as { topic: { id: string } }).topic;

  for (let index = 0; index < 102; index += 1) {
    const response = await page.request.post(`/api/channels/${channel.id}/messages`, {
      data: { body: `release page ${index}`, topic_id: release.id },
    });
    expect(response.ok()).toBe(true);
  }
  for (let index = 0; index < 2; index += 1) {
    const response = await page.request.post(`/api/channels/${channel.id}/messages`, {
      data: { body: `design page ${index}`, topic_id: design.id },
    });
    expect(response.ok()).toBe(true);
  }

  let releaseDelayedPage: (() => void) | undefined;
  const releaseDelayed = new Promise<void>((resolve) => {
    releaseDelayedPage = resolve;
  });
  let releaseRequestSeen: (() => void) | undefined;
  const releaseRequested = new Promise<void>((resolve) => {
    releaseRequestSeen = resolve;
  });
  await page.route(`**/api/channels/${channel.id}/messages?*`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("before_seq") && url.searchParams.get("topic_id") === release.id) {
      releaseRequestSeen?.();
      await releaseDelayed;
    }
    await route.continue();
  });

  await page.goto(`/app/${workspace.route_id}/${channel.route_id}`);
  await waitForAppReady(page);
  await page.getByRole("button", { name: "Filter by topic Release" }).first().click();
  await expect(page.getByText("Showing topic")).toContainText("Release");

  const scrollport = page.locator(".messages-scroll");
  await scrollport.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await releaseRequested;

  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(page.getByText("Showing topic")).toHaveCount(0);
  await page.getByRole("button", { name: "Filter by topic Design" }).first().click();
  await expect(page.getByText("Showing topic")).toContainText("Design");
  await expect(page.getByText("design page 1")).toBeVisible();

  releaseDelayedPage?.();
  await page.waitForTimeout(300);
  await expect(page.getByText("release page 0")).toHaveCount(0);
  await expect(page.getByText("design page 0")).toBeVisible();
});
