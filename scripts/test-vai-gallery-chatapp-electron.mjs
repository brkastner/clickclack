import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { _electron as electron, expect } from "@playwright/test";

const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { createServer } = await import(webRequire.resolve("vite"));
const { svelte } = await import(webRequire.resolve("@sveltejs/vite-plugin-svelte"));
const root = fileURLToPath(new URL("../apps/web/tests/electron/vai-gallery", import.meta.url));
const screenshotDir = process.env.GALLERY_SCREENSHOT_DIR || "/tmp/clickclack-gallery-chatapp";
const user = { id: "owner", kind: "human", display_name: "Owner", handle: "owner" };
const bot = { id: "bot", kind: "bot", display_name: "VAI", handle: "vai" };
const workspace = { id: "workspace", route_id: "w", name: "Synthetic workspace" };
const channel = { id: "channel", route_id: "channel", name: "destination" };
const dm = { id: "dm", route_id: "dm", workspace_id: workspace.id, members: [user, bot] };
const galleryUploads = [
  {
    id: "gallery-image",
    workspace_id: workspace.id,
    filename: "gallery-image.png",
    content_type: "image/png",
    byte_size: 12,
    width: 20,
    height: 20,
  },
  {
    id: "gallery-video",
    workspace_id: workspace.id,
    filename: "gallery-video.mp4",
    content_type: "video/mp4",
    byte_size: 12,
    width: 20,
    height: 20,
  },
];
const outputMessages = galleryUploads.map((upload, index) => ({
  id: `output-${index}`,
  workspace_id: workspace.id,
  channel_id: channel.id,
  author_id: bot.id,
  author: bot,
  body: "Synthetic output",
  body_format: "markdown",
  kind: "message",
  created_at: new Date().toISOString(),
  channel_seq: index + 1,
  attachments: [upload],
}));
const routeFor = (target) => ({
  workspace_id: workspace.id,
  workspace_route_id: "w",
  target_id: target,
  target_route_id: target,
  target_type: target === dm.id ? "direct" : "channel",
  canonical_path: `/app/w/${target}`,
});
const server = await createServer({
  configFile: false,
  root,
  plugins: [svelte({ configFile: false })],
  resolve: {
    alias: [
      { find: "$app/navigation", replacement: `${root}/navigation.ts` },
      { find: /.*\/lib\/realtime\.svelte$/, replacement: `${root}/realtime.ts` },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
});
let app;
try {
  await mkdir(screenshotDir, { recursive: true });
  await server.listen();
  app = await electron.launch({
    executablePath: desktopRequire("electron"),
    args: ["--no-sandbox", "--ozone-platform=x11", `${root}/main.cjs`],
    env: { ...process.env, WAYLAND_DISPLAY: "", ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  });
  const page = await app.firstWindow();
  const messageRequests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const emptyPage = {
      messages: [],
      oldest_seq: 0,
      newest_seq: 0,
      has_older: false,
      has_newer: false,
    };
    let json;
    if (path === "/api/me") json = { user };
    else if (path === "/api/workspaces") json = { workspaces: [workspace] };
    else if (path === `/api/routes/w/${channel.id}` || path === `/api/routes/w/${dm.id}`)
      json = { route: routeFor(path.endsWith(dm.id) ? dm.id : channel.id) };
    else if (path === `/api/workspaces/${workspace.id}/channels`) json = { channels: [channel] };
    else if (path === "/api/dms") json = { conversations: [dm] };
    else if (path.endsWith("/members"))
      json = { members: [{ user: bot, role: "bot" }], has_more: false };
    else if (path.endsWith("/topics")) json = { topics: [] };
    else if (path.endsWith("/slash-commands")) json = { slash_commands: [] };
    else if (path.endsWith("/bot-commands")) json = { commands: [] };
    else if (path.endsWith("/moderation/members")) json = { members: [] };
    else if (path.includes("/messages")) {
      messageRequests.push({ path, method: route.request().method() });
      json = emptyPage;
    } else if (path.endsWith("/outputs")) json = { outputs: outputMessages, next_cursor: null };
    else if (path.startsWith("/api/uploads/"))
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from("89504e470d0a1a0a", "hex"),
      });
    else if (path === "/api/uploads" && route.request().method() === "POST")
      json = {
        upload: {
          id: "draft-upload",
          workspace_id: workspace.id,
          filename: "draft.txt",
          content_type: "text/plain",
          byte_size: 5,
        },
      };
    else if (path.includes("/realtime")) json = { events: [], next_cursor: "0" };
    else json = {};
    return route.fulfill({ json });
  });
  await page.goto(`${server.resolvedUrls.local[0]}chatapp.html`);
  await expect(page.getByRole("textbox", { name: "Message body" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("textbox", { name: "Message body" }).fill("preserved draft");
  await page
    .getByLabel("Upload file")
    .setInputFiles({ name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("draft") });
  await expect(page.getByLabel("Pending attachments")).toContainText("draft.txt");
  await page.getByRole("heading", { name: "#destination" }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("gallery-test-navigation", { detail: "/app/w/views/vai-gallery" }),
    ),
  );
  await expect(page.getByLabel("gallery source account")).toBeEnabled();
  await page.getByLabel("gallery source account").selectOption(bot.id);
  await page.getByLabel("Open image from #destination").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to pending message" }).click();
  await page.locator("video").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to pending message" }).click();
  await page.getByRole("button", { name: "add to message…" }).click();
  await expect(page.getByRole("dialog", { name: "Choose destination" })).toBeVisible();
  await page
    .getByRole("dialog", { name: "Choose destination" })
    .getByRole("button", { name: "#destination" })
    .click();
  await expect(page.getByRole("textbox", { name: "Message body" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("textbox", { name: "Message body" })).toContainText(
    "preserved draft",
  );
  await expect(page.getByLabel("Pending attachments")).toContainText("draft.txt");
  await expect(page.getByLabel("Pending attachments")).toContainText("gallery-image.png");
  await expect(page.getByLabel("Pending attachments")).toContainText("gallery-video.mp4");
  await page.screenshot({
    path: `${screenshotDir}/chatapp-channel-handoff.png`,
    animations: "disabled",
  });
  assert.equal(
    messageRequests.filter((request) => request.method === "POST").length,
    0,
    "handoff must not create a message",
  );
  await page.getByRole("heading", { name: "#destination" }).click();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("gallery-test-navigation", { detail: "/app/w/dm" })),
  );
  await expect(page.getByRole("textbox", { name: "Message body" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByLabel("Pending attachments")).toHaveCount(0);
  await page.getByRole("heading", { name: "VAI" }).click();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("gallery-test-navigation", { detail: "/app/w/channel" })),
  );
  await expect(page.getByLabel("Pending attachments")).toContainText("gallery-video.mp4", {
    timeout: 15_000,
  });
  await expect(page.getByLabel("Pending attachments")).toHaveText(/3\/50/);
  assert.deepEqual(errors, []);
  console.log(
    `ChatApp gallery handoff Electron check passed. Screenshot: ${screenshotDir}/chatapp-channel-handoff.png`,
  );
} finally {
  await app?.close();
  await server.close();
}
