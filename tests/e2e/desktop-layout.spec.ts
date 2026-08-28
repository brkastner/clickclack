import { expect, test, type Page } from "@playwright/test";
import { waitForAppReady } from "./app-ready";

async function installDesktopBridge(page: Page) {
  await page.addInitScript(() => {
    window.clickclackDesktop = {
      integratedTitleBar: true,
      platform: "linux",
      notify: async () => false,
      onNavigate: () => () => {},
      onQuickCompose: () => () => {},
      openSettings: () => {},
      setActiveRoute: () => {},
      setUnreadCount: () => {},
      signInWithGitHub: async () => false,
    };
  });
}

async function createWorkspace(page: Page, stamp: number) {
  const response = await page.request.post("/api/workspaces", {
    data: {
      name: `Workspace ${stamp}`,
      slug: `desktop-layout-${stamp}`,
    },
  });
  expect(response.ok()).toBe(true);
  return (
    (await response.json()) as {
      workspace: { id: string; route_id: string };
    }
  ).workspace;
}

async function createChannel(page: Page, workspaceID: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceID}/channels`, {
    data: { name: "channel-layout", kind: "public" },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { channel: { id: string } }).channel;
}

test("keeps desktop navigation and titlebar geometry aligned at narrow widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 890, height: 700 });
  await installDesktopBridge(page);

  const workspace = await createWorkspace(page, Date.now());
  const channel = await createChannel(page, workspace.id);
  await page.goto(`/app/${workspace.route_id}/${channel.id}`);
  await waitForAppReady(page);
  await expect(page.locator(".desktop-shell")).toBeVisible();

  const geometry = await page.evaluate(() => {
    const sidebarScroll = document.querySelector<HTMLElement>(".sidebar-scroll");
    const firstSection = sidebarScroll?.querySelector<HTMLElement>(".nav-section");
    const userAvatar = document.querySelector<HTMLElement>(".user-card .dm-avatar");
    const rail = document.querySelector<HTMLElement>(".guild-rail");
    const userCard = document.querySelector<HTMLElement>(".user-card");
    const workspaceLabel = document.querySelector<HTMLElement>(".desktop-titlebar-workspace");
    const channelLabel = document.querySelector<HTMLElement>(".desktop-titlebar-channel");
    const search = document.querySelector<HTMLElement>(".desktop-titlebar-search");

    if (
      !sidebarScroll ||
      !firstSection ||
      !userAvatar ||
      !rail ||
      !userCard ||
      !workspaceLabel ||
      !channelLabel ||
      !search
    ) {
      throw new Error("desktop layout fixture did not render");
    }

    const probe = document.createElement("div");
    probe.innerHTML = `
      <section class="channel-subgroup profile-channel-group">
        <button class="channel-subgroup-toggle">
          <span class="caret">▾</span>
          <span class="channel-profile-avatar"></span>
          <span>Profile</span>
        </button>
      </section>
      <a class="nav-item dm"><span class="dm-avatar"></span><span class="nav-label">DM</span></a>
    `;
    sidebarScroll.append(probe);

    const profileAvatar = probe.querySelector<HTMLElement>(".channel-profile-avatar");
    const dmAvatar = probe.querySelector<HTMLElement>(".dm-avatar");
    if (!profileAvatar || !dmAvatar) throw new Error("alignment probes did not render");

    const railRect = rail.getBoundingClientRect();
    const sidebarRect = document.querySelector<HTMLElement>(".sidebar")?.getBoundingClientRect();
    if (!sidebarRect) throw new Error("desktop sidebar did not render");
    const userCardRect = userCard.getBoundingClientRect();
    const userAvatarRect = userAvatar.getBoundingClientRect();
    const result = {
      topGap: firstSection.getBoundingClientRect().top - sidebarScroll.getBoundingClientRect().top,
      avatarX: {
        profile: profileAvatar.getBoundingClientRect().x,
        dm: dmAvatar.getBoundingClientRect().x,
      },
      workspaceTruncated: workspaceLabel.scrollWidth > workspaceLabel.clientWidth,
      channelTruncated: channelLabel.scrollWidth > channelLabel.clientWidth,
      searchWidth: search.getBoundingClientRect().width,
      footer: {
        x: userCardRect.x,
        width: userCardRect.width,
        railX: railRect.x,
        combinedNavigationWidth: railRect.width + sidebarRect.width,
        avatarCenterX: userAvatarRect.x + userAvatarRect.width / 2,
        railCenterX: railRect.x + railRect.width / 2,
      },
    };
    probe.remove();
    return result;
  });

  expect(geometry.topGap).toBeLessThanOrEqual(4);
  expect(geometry.workspaceTruncated).toBe(false);
  expect(geometry.channelTruncated).toBe(false);
  expect(geometry.searchWidth).toBeGreaterThan(0);
  expect(geometry.searchWidth).toBeLessThanOrEqual(520);
  expect(geometry.avatarX.profile).toBeCloseTo(geometry.avatarX.dm, 0);
  expect(geometry.footer.x).toBeCloseTo(geometry.footer.railX, 0);
  expect(geometry.footer.width).toBeCloseTo(geometry.footer.combinedNavigationWidth, 0);
  expect(geometry.footer.avatarCenterX).toBeCloseTo(geometry.footer.railCenterX, 0);
});

test("opens threads from the message surface without hijacking copy or selection", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installDesktopBridge(page);
  const workspace = await createWorkspace(page, Date.now());
  const channel = await createChannel(page, workspace.id);
  const response = await page.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body: "The entire message surface opens this thread safely." },
  });
  expect(response.ok()).toBe(true);
  const { message } = (await response.json()) as { message: { id: string } };

  await page.goto(`/app/${workspace.route_id}/${channel.id}`);
  await waitForAppReady(page);
  const row = page.locator(`.message-row[data-message-id="${message.id}"]`);
  const closeThread = page.getByRole("button", { name: "Close thread" });

  await row.locator(".message-content").click({ position: { x: 24, y: 12 } });
  await expect(closeThread).toBeVisible();
  await closeThread.click();
  await expect(closeThread).toBeHidden();

  await row.hover();
  await row.getByRole("button", { name: "Copy message" }).click();
  await expect(row.getByRole("status")).toHaveText("Copied");
  await expect(closeThread).toBeHidden();

  const selectedText = await row.evaluate((element) => {
    const messageBody = element.querySelector(".markdown");
    if (!messageBody) throw new Error("message body did not render");
    const range = document.createRange();
    range.selectNodeContents(messageBody);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const text = selection?.toString() || "";
    element.click();
    return text;
  });
  expect(selectedText).toContain("entire message surface");
  await expect(closeThread).toBeHidden();
});

test("ends message connectors at content and visible action controls", async ({ page }) => {
  await installDesktopBridge(page);
  const workspace = await createWorkspace(page, Date.now());
  const channel = await createChannel(page, workspace.id);
  const response = await page.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body: "Connector geometry should stop exactly where this message ends." },
  });
  expect(response.ok()).toBe(true);
  const { message } = (await response.json()) as { message: { id: string } };

  await page.goto(`/app/${workspace.route_id}/${channel.id}`);
  await waitForAppReady(page);
  const row = page.locator(`.message-row[data-message-id="${message.id}"]`);
  const group = row.locator("xpath=ancestor::article[contains(@class, 'message-group')]");

  const connectorGeometry = () =>
    group.evaluate((element, messageID) => {
      const targetRow = element.querySelector<HTMLElement>(
        `.message-row[data-message-id="${messageID}"]`,
      );
      const content = targetRow?.querySelector<HTMLElement>(".message-content");
      const actions = targetRow?.querySelector<HTMLElement>(".message-actions");
      if (!targetRow || !content || !actions) throw new Error("message geometry did not render");
      const groupRect = element.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const connectorBottom = Number.parseFloat(getComputedStyle(element, "::after").bottom);
      return {
        actionsHeight: actionsRect.height,
        contentBottom: contentRect.bottom,
        actionsBottom: actionsRect.bottom,
        lineBottom: groupRect.bottom - connectorBottom,
      };
    }, message.id);

  const resting = await connectorGeometry();
  expect(resting.actionsHeight).toBe(0);
  expect(resting.lineBottom).toBeCloseTo(resting.contentBottom, 0);

  await row.hover();
  await expect(row.getByRole("button", { name: "Copy message" })).toBeVisible();
  const hovered = await connectorGeometry();
  expect(hovered.actionsHeight).toBeGreaterThanOrEqual(38);
  expect(hovered.lineBottom).toBeCloseTo(hovered.actionsBottom, 0);
});
