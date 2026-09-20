import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { createServer } = await import(webRequire.resolve("vite"));
const { svelte } = await import(webRequire.resolve("@sveltejs/vite-plugin-svelte"));
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../apps/web/tests/electron/conversation-peek", import.meta.url)),
  resolve: { alias: { $lib: fileURLToPath(new URL("../apps/web/src/lib", import.meta.url)) } },
  plugins: [svelte({ configFile: false })],
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
    args: [
      "--no-sandbox",
      fileURLToPath(
        new URL("../apps/web/tests/electron/bot-avatar-packs/main.cjs", import.meta.url),
      ),
    ],
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1020, height: 1800 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let sends = 0;
  const message = {
    id: "tool",
    workspace_id: "fixture",
    channel_id: "channel",
    author_id: "bot",
    thread_root_id: "tool",
    turn_id: "turn",
    body: "**bash**\n\n```sh\nprintf 'hello'\n```",
    body_format: "markdown",
    kind: "agent_tool",
    seq: 1,
    created_at: new Date().toISOString(),
  };
  await page.route("**/api/**", (route) => {
    if (route.request().method() === "POST" && route.request().url().includes("/messages")) {
      sends++;
      return route.fulfill({
        json: {
          message: { ...message, id: "sent", kind: "message", body: "keyboard send", seq: 2 },
        },
      });
    }
    return route.fulfill({
      json: {
        messages: [message],
        has_older: false,
        has_newer: false,
        oldest_seq: 1,
        newest_seq: 1,
      },
    });
  });
  await page.goto(server.resolvedUrls.local[0]);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const failures = [];
  const height = await dialog.evaluate((el) => el.getBoundingClientRect().height);
  if (height < 1600) failures.push(`modal wastes height: ${height}/1800`);
  const plus = page.getByRole("button", { name: "Create channel for Alpha", exact: true });
  const covered = await plus.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return (
      document
        .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        ?.closest(".conversation-peek-scrim") !== null
    );
  });
  if (!covered) failures.push("sidebar plus paints above modal scrim");
  if ((await dialog.locator(".preamble-toggle").count()) === 0)
    failures.push("tool rows lack production disclosure");
  const background = await dialog
    .locator(".composer")
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  if (background !== "none") failures.push(`composer has backdrop gradient: ${background}`);
  const input = dialog.getByLabel("Message #fixture");
  await input.fill("keyboard send");
  await input.press("Shift+Enter");
  assert.equal(sends, 0, "Shift+Enter must not send");
  await input.press("Enter");
  await page.waitForTimeout(300);
  if (sends !== 1) failures.push(`Enter sent ${sends} messages`);
  await page.screenshot({ path: "/tmp/conversation-peek-electron.png" });
  assert.deepEqual([...failures, ...errors], []);
  console.log(
    "PASS: Electron modal covers sidebar, uses viewport height, renders tool disclosure, removes composer gradient, and sends on Enter.",
  );
} finally {
  await app?.close();
  await server.close();
}
