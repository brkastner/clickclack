import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { createServer } = await import(webRequire.resolve("vite"));
const { svelte } = await import(webRequire.resolve("@sveltejs/vite-plugin-svelte"));
const fixture = fileURLToPath(
  new URL("../apps/web/tests/electron/rename-channel", import.meta.url),
);
const tangent = fileURLToPath(new URL("../apps/web/tests/electron/tangent", import.meta.url));
const server = await createServer({
  configFile: false,
  root: fixture,
  plugins: [svelte({ configFile: false })],
  resolve: {
    alias: [
      { find: "$lib", replacement: fileURLToPath(new URL("../apps/web/src/lib", import.meta.url)) },
      { find: "$app/navigation", replacement: `${tangent}/navigation.ts` },
      { find: /.*\/lib\/realtime\.svelte$/, replacement: `${tangent}/realtime.ts` },
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
  await server.listen();
  app = await electron.launch({
    executablePath: desktopRequire("electron"),
    args: ["--no-sandbox", `${tangent}/main.cjs`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const user = { id: "owner", kind: "human", display_name: "kas", handle: "kas" };
  const bot = { id: "bot", kind: "bot", display_name: "agent", handle: "agent" };
  let role = "owner";
  let channel = {
    id: "general",
    route_id: "general",
    workspace_id: "workspace",
    name: "general",
    kind: "public",
    created_at: "",
  };
  const workspace = { id: "workspace", route_id: "w", name: "test" };
  const direct = {
    id: "dm",
    route_id: "dm",
    workspace_id: "workspace",
    members: [user, bot],
    can_send: true,
  };
  const patches = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json = {};
    if (path === "/api/me") json = { user };
    else if (path === "/api/workspaces") json = { workspaces: [{ ...workspace, role }] };
    else if (path.startsWith("/api/routes/w/")) {
      const id = path.split("/").at(-1);
      json = {
        route: {
          workspace_id: workspace.id,
          workspace_route_id: "w",
          target_id: id,
          target_route_id: id,
          target_type: id === "dm" ? "direct" : "channel",
          canonical_path: `/app/w/${id}`,
        },
      };
    } else if (path === "/api/channels/general" && route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON();
      patches.push(patch);
      channel = { ...channel, ...patch };
      json = { channel };
    } else if (path.endsWith("/channels")) json = { channels: [channel] };
    else if (path === "/api/dms") json = { conversations: [direct] };
    else if (path.endsWith("/members"))
      json = {
        members: [
          { user, role },
          { user: bot, role: "bot" },
        ],
        has_more: false,
      };
    else if (path.endsWith("/messages"))
      json = { messages: [], has_older: false, has_newer: false };
    else if (path.endsWith("/topics")) json = { topics: [] };
    else if (path.endsWith("/slash-commands")) json = { slash_commands: [] };
    else if (path.endsWith("/bot-commands")) json = { bot_commands: [] };
    else if (path.includes("/realtime")) json = { events: [], next_cursor: "0" };
    return route.fulfill({ json });
  });
  await page.goto(server.resolvedUrls.local[0]);
  await expect(page.getByRole("heading", { name: "#general", exact: true })).toBeVisible({
    timeout: 20000,
  });
  await page.getByLabel("Message body").fill("keep my draft");
  const search = page.getByRole("combobox", { name: "Search commands" });
  await page.keyboard.press("Control+k");
  await search.fill("rename channel");
  await expect(page.getByRole("option", { name: /rename channel/ })).toBeVisible();
  await search.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Rename channel", exact: true });
  await expect(dialog).toBeVisible();
  const name = dialog.getByRole("textbox", { name: "Channel name" });
  await expect(name).toHaveValue("general");
  await expect(name).toBeFocused();
  await name.fill("renamed channel");
  await dialog.getByRole("button", { name: "Rename channel", exact: true }).click();
  await expect(dialog).toBeHidden();
  assert.deepEqual(patches, [{ display_title: "renamed channel" }]);
  await expect(page.getByRole("heading", { name: "#renamed channel", exact: true })).toBeVisible();
  await expect(page.getByLabel("Message body")).toHaveText("keep my draft");
  await page.keyboard.press("Control+k");
  await search.fill("rename channel");
  await search.press("Enter");
  await expect(name).toHaveValue("renamed channel");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(patches.length, 1);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("tangent-test-navigation", { detail: "/app/w/dm" })),
  );
  await expect(page.getByRole("heading", { name: "@agent", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  await search.fill("rename channel");
  await expect(page.getByRole("option", { name: /rename channel/ })).toHaveCount(0);
  await search.press("Escape");
  role = "member";
  await page.reload();
  await expect(page.getByRole("heading", { name: "#renamed channel", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  await search.fill("rename channel");
  await expect(page.getByRole("option", { name: /rename channel/ })).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    "channel rename Electron checks passed: palette, dialog focus, save, cancel, draft preservation, DMs, permissions.",
  );
} finally {
  await app?.close();
  await server.close();
}
