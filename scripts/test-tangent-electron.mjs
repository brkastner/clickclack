import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { _electron as electron, expect } from "@playwright/test";
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { createServer } = await import(webRequire.resolve("vite"));
const { svelte } = await import(webRequire.resolve("@sveltejs/vite-plugin-svelte"));
const root = fileURLToPath(new URL("../apps/web/tests/electron/tangent", import.meta.url));
const user = { id: "owner", kind: "human", display_name: "кас", handle: "kas" };
const bots = ["clickclack", "matchfi"].map((id) => ({
  id: `bot-${id}`,
  kind: "bot",
  display_name: id,
  handle: id,
}));
const workspace = { id: "workspace", route_id: "w", name: "tangent proof" };
const channels = bots.map((bot) => ({
  id: bot.handle,
  route_id: bot.handle,
  name: bot.handle,
  workspace_id: workspace.id,
  bot_assignments: [{ bot_user_id: bot.id, channel_id: bot.handle }],
}));
const direct = {
  id: "matchfi-dm",
  route_id: "matchfi-dm",
  workspace_id: workspace.id,
  members: [user, bots[1]],
};
const server = await createServer({
  configFile: false,
  root,
  plugins: [
    svelte({ configFile: false }),
    {
      name: "tangent-test-api",
      configureServer(server) {
        server.middlewares.use(tangentHandler);
      },
    },
  ],
  resolve: {
    alias: [
      { find: "$lib", replacement: fileURLToPath(new URL("../apps/web/src/lib", import.meta.url)) },
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
const opened = [],
  deleted = [];
const tangents = new Map();
let serial = 0;
// Real HTTP endpoints let keepalive unload requests bypass Playwright interception.
async function tangentHandler(req, res, next) {
  if (!req.url?.startsWith("/api/tangents")) return next();
  const path = req.url.split("?")[0];
  if (req.method === "DELETE") {
    const id = path.split("/")[3];
    deleted.push(id);
    tangents.delete(id);
    res.statusCode = 204;
    res.end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const data = JSON.parse(body || "{}");
  let json;
  if (path === "/api/tangents") {
    const tangent = {
      ...data,
      id: `tng_${++serial}`,
      owner_user_id: user.id,
      created_at: new Date().toISOString(),
    };
    opened.push(tangent);
    tangents.set(tangent.id, tangent);
    json = { tangent };
  } else {
    const id = path.split("/")[3];
    json = {
      message: {
        ...data,
        id: `tgm_${++serial}`,
        tangent_id: id,
        author_id: user.id,
        created_at: new Date().toISOString(),
      },
    };
  }
  res.statusCode = 201;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(json));
}
let app;
try {
  await server.listen();
  app = await electron.launch({
    executablePath: desktopRequire("electron"),
    args: ["--no-sandbox", "--ozone-platform=x11", `${root}/main.cjs`],
    env: { ...process.env, WAYLAND_DISPLAY: "", ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  });
  const page = await app.firstWindow();
  const errors = [];
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/\/api\/(?!tangents(?:\/|$))/, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json = {};
    if (path === "/api/me") json = { user };
    else if (path === "/api/workspaces") json = { workspaces: [workspace] };
    else if (path.startsWith("/api/routes/w/")) {
      const id = path.split("/").at(-1);
      json = {
        route: {
          workspace_id: workspace.id,
          workspace_route_id: "w",
          target_id: id,
          target_route_id: id,
          target_type: id === direct.id ? "direct" : "channel",
          canonical_path: `/app/w/${id}`,
        },
      };
    } else if (path.endsWith("/channels")) json = { channels };
    else if (path === "/api/dms") json = { conversations: [direct] };
    else if (path.endsWith("/members"))
      json = {
        members: [user, ...bots].map((user) => ({
          user,
          role: user.kind === "bot" ? "bot" : "owner",
        })),
        has_more: false,
      };
    else if (path.endsWith("/topics")) json = { topics: [] };
    else if (path.endsWith("/slash-commands")) json = { slash_commands: [] };
    else if (path.endsWith("/bot-commands")) json = { commands: [] };
    else if (path.includes("/messages")) {
      const bot = path.includes("matchfi") ? bots[1] : bots[0];
      json = {
        messages: [
          {
            id: `msg-${bot.id}`,
            workspace_id: workspace.id,
            channel_id: bot.handle,
            author_id: bot.id,
            author: bot,
            body: "conversation context",
            body_format: "markdown",
            kind: "message",
            created_at: new Date().toISOString(),
            channel_seq: 1,
          },
        ],
        oldest_seq: 1,
        newest_seq: 1,
        has_older: false,
        has_newer: false,
      };
    } else if (path.includes("/realtime")) json = { events: [], next_cursor: "0" };
    return route.fulfill({ json });
  });
  const navigate = async (target) => {
    await page.evaluate(
      (target) =>
        window.dispatchEvent(
          new CustomEvent("tangent-test-navigation", { detail: `/app/w/${target}` }),
        ),
      target,
    );
    await expect(page.getByLabel("Message body")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: target === direct.id ? "@matchfi" : `#${target}`,
        exact: true,
      }),
    ).toBeVisible();
  };
  const panel = page.getByRole("complementary", { name: "Tangent", exact: true });
  await page.goto(server.resolvedUrls.local[0]);
  await expect(page.getByLabel("Message body")).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("heading", { name: "#clickclack", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View profile for clickclack" }).first(),
  ).toBeVisible();
  await page.keyboard.press("Control+l");
  await expect(panel).toBeVisible();
  await expect.poll(() => opened.length).toBe(1);
  assert.equal(opened[0].bot_user_id, bots[0].id);
  await panel.getByLabel("Tangent message").fill("clickclack draft");
  await panel.getByLabel("Tangent message").press("Escape");
  await navigate("matchfi");
  await page.keyboard.press("Control+l");
  await expect
    .poll(() => opened.length, { message: "Ctrl+L in matchfi must not reuse clickclack's tangent" })
    .toBe(2);
  assert.equal(opened[1].bot_user_id, bots[1].id);
  assert.equal(opened[1].channel_id, "matchfi");
  await panel.getByLabel("Tangent message").fill("matchfi question");
  await panel.getByLabel("Tangent message").press("Enter");
  await expect(panel).toContainText("matchfi question");
  await panel.getByLabel("Tangent message").fill("matchfi draft");
  await navigate("clickclack");
  await expect(panel).toBeHidden();
  await page.evaluate(
    (tangent) =>
      window.dispatchEvent(
        new CustomEvent("tangent-test-event", {
          detail: {
            type: "tangent.message",
            payload: {
              tangent_id: tangent.id,
              message: {
                id: "late-matchfi",
                tangent_id: tangent.id,
                author_id: tangent.bot_user_id,
                body: "matchfi private answer",
                created_at: new Date().toISOString(),
              },
            },
          },
        }),
      ),
    opened[1],
  );
  await page.keyboard.press("Control+l");
  await expect(panel.getByLabel("Tangent message")).toHaveValue("clickclack draft");
  await expect(panel).not.toContainText("matchfi private answer");
  assert.equal(opened.length, 2);
  await navigate("matchfi");
  await expect(panel).toBeHidden();
  await page.keyboard.press("Control+l");
  await expect(panel.getByLabel("Tangent message")).toHaveValue("matchfi draft");
  await expect(panel).toContainText("matchfi private answer");
  await expect(panel.locator(".message-group > .avatar")).toHaveCount(2);
  await expect(panel.locator(".message-group time")).toHaveCount(2);
  await page.evaluate(() => window.dispatchEvent(new Event("tangent-test-remount")));
  await expect(page.getByRole("heading", { name: "#matchfi", exact: true })).toBeVisible();
  await expect(panel).toBeHidden();
  await page.keyboard.press("Control+l");
  await expect(panel).toContainText("matchfi private answer");
  await expect(panel.getByLabel("Tangent message")).toHaveValue("matchfi draft");
  assert.equal(opened.length, 2);
  assert.equal(deleted.length, 0, "navigation must not discard other contexts");
  await mkdir("test-results/tangent", { recursive: true });
  await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await page.evaluate(() => (document.documentElement.dataset.colorMode = "dark"));
  await page.screenshot({
    path: "test-results/tangent/electron-desktop.png",
    animations: "disabled",
  });
  const desktopBox = await panel.boundingBox();
  assert.ok(desktopBox.x + desktopBox.width <= (await page.evaluate(() => innerWidth)) + 1);
  await navigate("matchfi-dm");
  await expect(panel).toBeHidden();
  await page.keyboard.press("Control+l");
  await expect.poll(() => opened.length).toBe(3);
  assert.equal(opened[2].bot_user_id, bots[1].id);
  assert.equal(opened[2].direct_conversation_id, direct.id);
  await panel.getByLabel("Tangent message").fill("dm only");
  await panel.getByLabel("Tangent message").press("Enter");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(390, 844),
  );
  await expect(panel).toBeVisible();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(390);
  await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  const box = await panel.boundingBox();
  assert.ok(box.width >= 389);
  assert.ok(box.height > 700);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({
    path: "test-results/tangent/electron-phone.png",
    animations: "disabled",
  });
  await page.reload();
  await expect(page.getByLabel("Message body")).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect.poll(() => deleted.length).toBe(3);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Electron Ctrl+L context selection, channel/DM isolation, hidden replies, drafts, reload cleanup, desktop and phone",
  );
} finally {
  await app?.close();
  await server.close();
}
