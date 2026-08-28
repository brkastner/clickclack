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

    const railFooter = getComputedStyle(rail, "::after");
    const result = {
      topGap: firstSection.getBoundingClientRect().top - sidebarScroll.getBoundingClientRect().top,
      avatarX: {
        user: userAvatar.getBoundingClientRect().x,
        profile: profileAvatar.getBoundingClientRect().x,
        dm: dmAvatar.getBoundingClientRect().x,
      },
      workspaceTruncated: workspaceLabel.scrollWidth > workspaceLabel.clientWidth,
      channelTruncated: channelLabel.scrollWidth > channelLabel.clientWidth,
      searchWidth: search.getBoundingClientRect().width,
      railFooterContent: railFooter.content,
      railFooterHeight: Number.parseFloat(railFooter.height),
      userCardHeight: userCard.getBoundingClientRect().height,
    };
    probe.remove();
    return result;
  });

  expect(geometry.topGap).toBeLessThanOrEqual(4);
  expect(geometry.workspaceTruncated).toBe(false);
  expect(geometry.channelTruncated).toBe(false);
  expect(geometry.searchWidth).toBeGreaterThan(0);
  expect(geometry.searchWidth).toBeLessThanOrEqual(520);
  expect(geometry.avatarX.profile).toBeCloseTo(geometry.avatarX.user, 0);
  expect(geometry.avatarX.dm).toBeCloseTo(geometry.avatarX.user, 0);
  expect(geometry.railFooterContent).toBe('""');
  expect(geometry.railFooterHeight).toBeCloseTo(geometry.userCardHeight, 0);
});
