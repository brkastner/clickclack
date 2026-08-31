import { expect, test, type Page } from "@playwright/test";
import { waitForAppReady } from "./app-ready";

async function installDesktopBridge(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, {
      clickclackDesktop: {
        integratedTitleBar: true,
        platform: "linux",
        notify: async () => false,
        onNavigate: () => () => {},
        onPasteText: () => () => {},
        onQuickCompose: () => () => {},
        openSettings: () => {},
        setActiveRoute: () => {},
        setUnreadCount: () => {},
        signInWithGitHub: async () => false,
        writeClipboardText: async () => true,
      },
    });
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
    const sidebar = document.querySelector<HTMLElement>(".sidebar");
    const sidebarScroll = document.querySelector<HTMLElement>(".sidebar-scroll");
    const peopleShelf = sidebarScroll?.querySelector<HTMLElement>(".sidebar-people-row");
    const firstSection = sidebarScroll?.querySelector<HTMLElement>(".nav-section");
    const userCard = document.querySelector<HTMLElement>(".user-card");
    const workspaceSwitcher = document.querySelector<HTMLElement>(".workspace-switcher--titlebar");
    const workspaceLabel = workspaceSwitcher?.querySelector<HTMLElement>(
      ".workspace-switcher-label strong",
    );
    const channelLabel = document.querySelector<HTMLElement>(".desktop-titlebar-channel");
    const channelGlyph = channelLabel?.querySelector<HTMLElement>(".title-glyph");
    const search = document.querySelector<HTMLElement>(".desktop-titlebar-search");
    const actions = document.querySelector<HTMLElement>(".desktop-titlebar-actions");
    const safeArea = document.querySelector<HTMLElement>(".desktop-titlebar-safe-area");

    if (
      !sidebar ||
      !sidebarScroll ||
      !peopleShelf ||
      !firstSection ||
      !userCard ||
      !workspaceSwitcher ||
      !workspaceLabel ||
      !channelLabel ||
      !channelGlyph ||
      !search ||
      !safeArea
    ) {
      throw new Error("desktop layout fixture did not render");
    }

    peopleShelf.replaceChildren(
      ...Array.from({ length: 4 }, () => {
        const person = document.createElement("a");
        person.className = "sidebar-person";
        return person;
      }),
    );

    const sidebarRect = sidebar.getBoundingClientRect();
    const shelfRect = peopleShelf.getBoundingClientRect();
    const people = [...peopleShelf.querySelectorAll<HTMLElement>(".sidebar-person")].map((person) =>
      person.getBoundingClientRect(),
    );
    const userCardRect = userCard.getBoundingClientRect();
    const switcherRect = workspaceSwitcher.getBoundingClientRect();
    const channelRect = channelLabel.getBoundingClientRect();
    const searchRect = search.getBoundingClientRect();
    const safeAreaRect = safeArea.getBoundingClientRect();
    const peopleShelfStyle = getComputedStyle(peopleShelf);
    return {
      topGap: firstSection.getBoundingClientRect().top - sidebarScroll.getBoundingClientRect().top,
      peopleShelf: {
        display: peopleShelfStyle.display,
        columns: peopleShelfStyle.gridTemplateColumns,
        rows: peopleShelfStyle.gridTemplateRows,
        horizontal: [
          people[0].left - shelfRect.left,
          people[1].left - people[0].right,
          shelfRect.right - people[1].right,
        ],
        vertical: [
          people[0].top - shelfRect.top,
          people[2].top - people[0].bottom,
          shelfRect.bottom -
            Number.parseFloat(peopleShelfStyle.borderBottomWidth) -
            people[2].bottom,
        ],
      },
      channelWidth: channelRect.width,
      channelGlyph: {
        text: channelGlyph.textContent,
        color: getComputedStyle(channelGlyph).color,
        titleColor: getComputedStyle(channelLabel).color,
      },
      search: {
        width: searchRect.width,
        rightGap: (actions?.getBoundingClientRect().left ?? safeAreaRect.right) - searchRect.right,
      },
      titlebarOverlap: searchRect.left - Math.max(switcherRect.right, channelRect.right),
      workspaceLabel: workspaceLabel.textContent,
      workspaceLabelCenterOffset: Math.abs(
        workspaceLabel.getBoundingClientRect().top +
          workspaceLabel.getBoundingClientRect().height / 2 -
          (switcherRect.top + switcherRect.height / 2),
      ),
      footer: {
        x: userCardRect.x,
        width: userCardRect.width,
        sidebarX: sidebarRect.x,
        sidebarWidth: sidebarRect.width,
      },
    };
  });

  // The recent-people shelf forms a true 2×2 grid: every row/column gap is
  // distributed evenly with the corresponding outer edges.
  expect(geometry.topGap).toBeGreaterThanOrEqual(216);
  expect(geometry.topGap).toBeLessThanOrEqual(230);
  expect(geometry.peopleShelf.display).toBe("grid");
  expect(geometry.peopleShelf.columns).toBe("92px 92px");
  expect(geometry.peopleShelf.rows).toBe("92px 92px");
  for (const spacing of [geometry.peopleShelf.horizontal, geometry.peopleShelf.vertical]) {
    expect(Math.abs(spacing[0] - spacing[1])).toBeLessThanOrEqual(1);
    expect(Math.abs(spacing[1] - spacing[2])).toBeLessThanOrEqual(1);
  }
  expect(geometry.workspaceLabel).toContain("Workspace");
  expect(geometry.channelWidth).toBeGreaterThan(0);
  expect(geometry.channelGlyph.text).toBe("#");
  expect(geometry.channelGlyph.color).not.toBe(geometry.channelGlyph.titleColor);
  expect(geometry.search.width).toBeGreaterThanOrEqual(200);
  expect(geometry.search.width).toBeLessThanOrEqual(520);
  expect(geometry.search.rightGap).toBeGreaterThanOrEqual(0);
  expect(geometry.titlebarOverlap).toBeGreaterThanOrEqual(0);
  expect(geometry.workspaceLabelCenterOffset).toBeLessThanOrEqual(1);
  expect(geometry.footer.x).toBeCloseTo(geometry.footer.sidebarX, 0);
  expect(geometry.footer.width).toBeCloseTo(geometry.footer.sidebarWidth, 0);
});

test("resizes and persists the desktop sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await installDesktopBridge(page);

  const workspace = await createWorkspace(page, Date.now());
  const channel = await createChannel(page, workspace.id);
  await page.goto(`/app/${workspace.route_id}/${channel.id}`);
  await waitForAppReady(page);

  const sidebar = page.locator(".sidebar");
  const resizeHandle = page.locator(".sidebar-resize-handle");
  await expect(resizeHandle).toBeVisible();
  await expect.poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(280);

  const handleBox = await resizeHandle.boundingBox();
  if (!handleBox) throw new Error("sidebar resize handle did not render");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 60, handleBox.y + 120);
  await page.mouse.up();

  await expect.poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(340);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("clickclack:sidebar-width:v1")))
    .toBe("340");

  await page.reload();
  await waitForAppReady(page);
  await expect.poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(340);

  await resizeHandle.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(222);
});

test("accents only the explicit glyph in the web channel title", async ({ page }) => {
  const workspace = await createWorkspace(page, Date.now());
  const channel = await createChannel(page, workspace.id);
  await page.goto(`/app/${workspace.route_id}/${channel.id}`);
  await waitForAppReady(page);

  const title = page.locator(".topbar-title h1.channel");
  const glyph = title.locator(".title-glyph");
  await expect(title).toHaveText("#channel-layout");
  await expect(glyph).toHaveText("#");
  const colors = await title.evaluate((element) => {
    const titleGlyph = element.querySelector<HTMLElement>(".title-glyph");
    if (!titleGlyph) throw new Error("channel glyph did not render");
    return {
      glyph: getComputedStyle(titleGlyph).color,
      title: getComputedStyle(element).color,
    };
  });
  expect(colors.glyph).not.toBe(colors.title);
});

test("opens threads only from the explicit thread action", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installDesktopBridge(page);
  const workspace = await createWorkspace(page, Date.now());
  const channel = await createChannel(page, workspace.id);
  const response = await page.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body: "The entire message surface stays selectable without opening a thread." },
  });
  expect(response.ok()).toBe(true);
  const { message } = (await response.json()) as { message: { id: string } };

  await page.goto(`/app/${workspace.route_id}/${channel.id}`);
  await waitForAppReady(page);
  const row = page.locator(`.message-row[data-message-id="${message.id}"]`);
  const closeThread = page.getByRole("button", { name: "Close thread" });

  await row.locator(".message-content").click({ position: { x: 24, y: 12 } });
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
    (element as HTMLElement).click();
    return selection?.toString() || "";
  });
  expect(selectedText).toContain("entire message surface");
  await expect(closeThread).toBeHidden();

  await row.hover();
  await row.getByRole("button", { name: "Open thread" }).click();
  await expect(closeThread).toBeVisible();
});

test("reserves message actions without extending connectors through them", async ({ page }) => {
  await installDesktopBridge(page);
  const workspace = await createWorkspace(page, Date.now());
  const channel = await createChannel(page, workspace.id);
  const firstResponse = await page.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body: "Earlier message controls should not move anything below them." },
  });
  const lastResponse = await page.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body: "Connector geometry should stop exactly where this message ends." },
  });
  expect(firstResponse.ok()).toBe(true);
  expect(lastResponse.ok()).toBe(true);
  const { message: firstMessage } = (await firstResponse.json()) as { message: { id: string } };
  const { message: lastMessage } = (await lastResponse.json()) as { message: { id: string } };

  await page.goto(`/app/${workspace.route_id}/${channel.id}`);
  await waitForAppReady(page);
  const earlierRow = page.locator(`.message-row[data-message-id="${firstMessage.id}"]`);
  const lastRow = page.locator(`.message-row[data-message-id="${lastMessage.id}"]`);
  const group = lastRow.locator("xpath=ancestor::article[contains(@class, 'message-group')]");

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
        lineBottom: groupRect.bottom - connectorBottom,
      };
    }, lastMessage.id);

  const resting = await connectorGeometry();
  const lastRowTop = await lastRow.evaluate((element) => element.getBoundingClientRect().top);
  expect(resting.actionsHeight).toBeGreaterThanOrEqual(38);
  expect(resting.lineBottom).toBeCloseTo(resting.contentBottom, 0);

  await earlierRow.hover();
  await expect(earlierRow.getByRole("button", { name: "Copy message" })).toBeVisible();
  const hovered = await connectorGeometry();
  const lastRowTopAfterHover = await lastRow.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(lastRowTopAfterHover).toBeCloseTo(lastRowTop, 0);
  expect(hovered.actionsHeight).toBeGreaterThanOrEqual(38);
  expect(hovered.lineBottom).toBeCloseTo(hovered.contentBottom, 0);
});
