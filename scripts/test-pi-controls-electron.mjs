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
  root: fileURLToPath(new URL("../apps/web/tests/electron/pi-controls", import.meta.url)),
  plugins: [svelte({ configFile: false })],
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
});
await server.listen();
let app;
try {
  app = await electron.launch({
    executablePath: desktopRequire("electron"),
    args: [
      "--no-sandbox",
      fileURLToPath(
        new URL("../apps/web/tests/electron/bot-avatar-packs/main.cjs", import.meta.url),
      ),
    ],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let status = {
    workspace_id: "w",
    channel_id: "test",
    direct_conversation_id: "test",
    bot_user_id: "pi",
    runtime: "pi",
    model_provider: "openai-codex",
    model_id: "gpt-6-sol",
    reasoning: "high",
    fast_mode: false,
    updated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  };
  const requests = [];
  let fail = false;
  let delayNextStatus = false;
  let previousStatus = null;
  let staleReads = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("bot-runtime-status"))
      return route.fulfill({ json: { statuses: [staleReads-- > 0 ? previousStatus : status] } });
    if (path.endsWith("bot-commands"))
      return route.fulfill({
        json: {
          bot_commands: ["model", "thinking", "fast"].map((command) => ({
            id: `pi-${command}`,
            command,
            bot: { id: "pi" },
          })),
        },
      });
    if (path.endsWith("messages")) {
      const body = route.request().postDataJSON();
      requests.push({ path, ...body });
      if (fail) return route.fulfill({ status: 500, json: { error: "test send failed" } });
      if (delayNextStatus) {
        previousStatus = { ...status };
        staleReads = 2;
        delayNextStatus = false;
      }
      const [command, value] = body.body.split(" ");
      if (command === "/model") {
        const parts = value.split("/");
        status = {
          ...status,
          model_provider: parts.length > 1 ? parts[0] : "anthropic",
          model_id: parts.at(-1),
        };
      }
      if (command === "/thinking") status = { ...status, reasoning: value };
      if (command === "/fast") status = { ...status, fast_mode: !status.fast_mode };
      status.updated_at = new Date().toISOString();
      return route.fulfill({ json: { message: {} } });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto(server.resolvedUrls.local[0]);
  const model = () => page.getByRole("button", { name: /^model:/ });
  const effort = () => page.getByRole("button", { name: /^effort:/ });
  const fast = () => page.getByRole("button", { name: "fast mode" });
  await expect(model()).toHaveText("gpt 6 sol");
  await expect(fast()).toHaveText("normal");
  await model().click();
  const menuBox = await page.getByRole("menu").boundingBox();
  const pillBox = await model().boundingBox();
  assert.ok(menuBox.y + menuBox.height < pillBox.y, "selector opens upward");
  await page.getByRole("menuitemradio", { name: "gpt 6 sol openai-codex/gpt-6-sol" }).click();
  assert.equal(requests.length, 0);
  await model().click();
  await page.getByRole("menuitemradio", { name: "gpt 6 luna openai-codex/gpt-6-luna" }).click();
  await expect(model()).toHaveText("gpt 6 luna");
  assert.equal(requests.at(-1).body, "/model openai-codex/gpt-6-luna");
  assert.equal(requests.at(-1).bot_command_id, "pi-model");
  await effort().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(effort()).toHaveText("xhigh");
  assert.equal(requests.at(-1).body, "/thinking xhigh");
  delayNextStatus = true;
  await fast().click();
  await expect(fast()).toBeDisabled();
  await expect(fast()).toHaveText("fast");
  await expect(fast()).toBeEnabled();
  await fast().click();
  await expect(fast()).toHaveText("normal");
  await model().click();
  await page.keyboard.press("Escape");
  await expect(model()).toBeFocused();
  await expect(page.getByRole("menu")).toBeHidden();
  await model().click();
  await page.getByRole("textbox", { name: "draft", exact: true }).click();
  await expect(page.getByRole("menu")).toBeHidden();
  await model().click();
  await page.getByRole("menuitemradio", { name: "opus 5.5 claude-opus-5-5" }).click();
  await expect(model()).toHaveText("opus 5.5");
  await expect(fast()).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "draft", exact: true })).toHaveValue(
    "keep this draft",
  );
  await page.getByRole("textbox", { name: "model 1 label", exact: true }).fill("my opus");
  await page.getByRole("button", { name: "save models", exact: true }).click();
  await expect(model()).toHaveText("my opus");
  await page.reload();
  await expect(model()).toHaveText("my opus");
  fail = true;
  await effort().click();
  await page.getByRole("menuitemradio", { name: "low", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("test send failed");
  await expect(effort()).toHaveText("xhigh");
  fail = false;
  await page.getByRole("button", { name: "switch conversation" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await effort().click();
  await page.getByRole("menuitemradio", { name: "low", exact: true }).click();
  await expect(effort()).toHaveText("low");
  assert.equal(requests.at(-1).path, "/api/dms/test/messages");
  assert.equal(requests.at(-1).bot_command_id, undefined);
  status = { ...status, runtime: "openclaw" };
  await page.reload();
  await expect(page.getByLabel("Bot runtime status")).toBeVisible();
  await expect(model()).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    "Pi controls Electron checks passed: menus, keyboard, command routing, no-op, fast, Claude, settings, errors, DMs, OpenClaw.",
  );
} finally {
  await app?.close();
  await server.close();
}
