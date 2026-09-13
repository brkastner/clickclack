import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { createServer } = await import(webRequire.resolve("vite"));
const { svelte } = await import(webRequire.resolve("@sveltejs/vite-plugin-svelte"));
const root = fileURLToPath(new URL("../apps/web/tests/electron/vai-gallery", import.meta.url));
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
  await server.listen();
  app = await electron.launch({
    executablePath: desktopRequire("electron"),
    args: ["--no-sandbox", `${root}/main.cjs`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const user = { id: "owner", kind: "human", display_name: "Owner", handle: "owner" };
  const bot = { id: "bot", kind: "bot", display_name: "VAI", handle: "vai" };
  const workspace = { id: "workspace", route_id: "w", name: "Synthetic workspace" };
  const messages = Array.from({ length: 35 }, (_, i) => ({
    id: `output-${i}`,
    workspace_id: workspace.id,
    channel_id: "channel",
    author_id: bot.id,
    author: bot,
    body: `Synthetic response ${i}`,
    body_format: "markdown",
    kind: "message",
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 35 - i)).toISOString(),
    thread_root_id: `output-${i}`,
    channel_seq: 35 - i,
    ...(i === 31
      ? { parent_message_id: "output-34", thread_root_id: "output-34", thread_seq: 2 }
      : {}),
    ...(i === 0
      ? {
          attachments: [
            {
              id: "image",
              filename: "image.png",
              content_type: "image/png",
              byte_size: 12,
              width: 1,
              height: 1,
            },
          ],
        }
      : {}),
  }));
  let olderFails = true;
  let deleted = false;
  const limits = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let json;
    if (path === "/api/me") json = { user };
    else if (path === "/api/workspaces") json = { workspaces: [workspace] };
    else if (path.endsWith("/members"))
      json = {
        members: [bot, { ...bot, id: "other", handle: "other" }].map((user) => ({
          user,
          role: "bot",
        })),
        has_more: false,
      };
    else if (path.endsWith("/channels")) json = { channels: [{ id: "channel", name: "outputs" }] };
    else if (path === "/api/dms") json = { conversations: [] };
    else if (path.endsWith("/outputs")) {
      limits.push(url.searchParams.get("limit"));
      const start = url.searchParams.has("cursor") ? 30 : 0;
      if (start && olderFails)
        return route.fulfill({ status: 503, json: { error: "Synthetic outage" } });
      const limit = Number(url.searchParams.get("limit"));
      json = {
        outputs: messages
          .slice(start, start + limit)
          .filter((m) => !deleted || m.id !== "output-0"),
        next_cursor: start + limit < messages.length ? "older" : null,
      };
    } else if (path.startsWith("/api/messages/"))
      json = { message: messages.find((m) => m.id === path.split("/").at(-1)) };
    else return route.fulfill({ status: 404 });
    return route.fulfill({ json });
  });
  await page.goto(server.resolvedUrls.local[0]);
  await expect(page.getByRole("combobox")).toBeEnabled();
  await expect(page.locator(".output-card")).toHaveCount(0);
  await page.getByRole("combobox").selectOption("bot");
  await expect(page.locator(".output-card")).toHaveCount(30);
  await page.getByRole("button", { name: "Load older responses" }).click();
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  await expect(page.locator(".output-card")).toHaveCount(30);
  olderFails = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".output-card")).toHaveCount(35);
  await page.locator('[data-output-focus="output-31"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-test-source="output-31"]')).toContainText(
    "/app/workspace/channel",
  );
  await page.getByRole("button", { name: "Return to gallery" }).click();
  await expect(page.locator(".output-card")).toHaveCount(35);
  await expect(page.locator('[data-output-focus="output-31"]')).toBeFocused();
  await page.getByRole("button", { name: "Latest response" }).click();
  await expect(page.locator('[data-test-source="output-0"]')).toBeVisible();
  assert.ok(limits.includes("1"));
  await page.getByRole("button", { name: "Return to gallery" }).click();
  await expect(page.locator(".output-card")).toHaveCount(35);
  deleted = true;
  await page.evaluate(() => window.dispatchEvent(new Event("gallery-test-invalidate")));
  await expect(page.locator('[data-output-id="output-0"]')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    "VAI gallery Electron synthetic check passed: selection, pagination retry, keyboard source, return focus, latest and deletion.",
  );
} finally {
  await app?.close();
  await server.close();
}
