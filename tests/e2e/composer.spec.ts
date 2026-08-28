import { expect, test, type Page } from "@playwright/test";
import { waitForAppReady } from "./app-ready";

async function createWorkspace(page: Page, stamp: number) {
  const response = await page.request.post("/api/workspaces", {
    data: {
      name: `Composer ${stamp}`,
      slug: `composer-${stamp}`,
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
    data: { name: "editor", kind: "public" },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { channel: { id: string; name: string } }).channel;
}

async function openChannel(page: Page, routeID: string) {
  await page.goto(`/app/${routeID}`);
  await waitForAppReady(page);
  await page.getByRole("link", { name: "# editor" }).click();
  await expect(page.getByRole("heading", { name: "#editor" })).toBeVisible();
}

test("offers rich formatting controls and a functional voice control", async ({ page }) => {
  const stamp = Date.now();
  const workspace = await createWorkspace(page, stamp);
  const channel = await createChannel(page, workspace.id);
  await openChannel(page, workspace.route_id);

  const editor = page.getByLabel("Message body");
  await editor.fill("polished composer");
  await editor.press(process.platform === "darwin" ? "Meta+A" : "Control+A");

  await page.getByRole("button", { name: "Toggle formatting tools" }).click();
  const bold = page.getByRole("button", { name: "Bold" });
  await bold.click();
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await expect(editor.locator("strong")).toHaveText("polished composer");

  await editor.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  const heading = page.getByRole("button", { name: "Heading 2" });
  await heading.click();
  await expect(editor.locator("h2")).toContainText("polished composer");

  const voice = page.getByRole("button", { name: "Start live voice conversation" });
  await expect(voice).toBeVisible();
  await expect(editor).toContainText("polished composer");

  const created = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith(`/api/channels/${channel.id}/messages`),
  );
  await page.getByRole("button", { name: "Send" }).click();
  const payload = (await created).postDataJSON() as { body: string };
  expect(payload.body).toContain("##");
  expect(payload.body).toContain("**polished composer**");
});

test("keeps multi-character mobile input in one stable draft", async ({ page }) => {
  const stamp = Date.now();
  const workspace = await createWorkspace(page, stamp);
  const channel = await createChannel(page, workspace.id);
  await openChannel(page, workspace.route_id);

  const editor = page.getByLabel("Message body");
  await editor.focus();
  const chunks = ["update ", "script ", "and ", "rescue ", "sheet ", "with ", "Gboard"];
  for (const chunk of chunks) {
    await editor.evaluate((node, data) => {
      node.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data,
          inputType: "insertText",
        }),
      );
    }, chunk);
  }

  const body = chunks.join("");
  await expect(editor).toHaveText(body);
  await expect(editor.locator("p")).toHaveCount(1);

  const created = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith(`/api/channels/${channel.id}/messages`),
  );
  await page.getByRole("button", { name: "Send" }).click();
  const payload = (await created).postDataJSON() as { body: string };
  expect(payload.body).toBe(body);
});

test("keeps quotes compact and converts language-tagged code fences", async ({ page }) => {
  const stamp = Date.now();
  const workspace = await createWorkspace(page, stamp);
  await createChannel(page, workspace.id);
  await openChannel(page, workspace.route_id);

  const editor = page.getByLabel("Message body");
  await page.getByRole("button", { name: "Blockquote" }).click();
  await editor.pressSequentially("this is a test");

  const quote = editor.locator("blockquote");
  await expect(quote).toContainText("this is a test");
  const editorBox = await editor.boundingBox();
  const quoteBox = await quote.boundingBox();
  expect(editorBox).not.toBeNull();
  expect(quoteBox).not.toBeNull();
  expect(Math.abs(quoteBox!.x - editorBox!.x)).toBeLessThanOrEqual(4);

  await editor.fill("");
  await editor.pressSequentially("```sh");
  await editor.press("Shift+Enter");
  await editor.pressSequentially("printf hello");
  await editor.press("Shift+Enter");
  await editor.pressSequentially("```");
  await editor.press("Shift+Enter");
  await editor.pressSequentially("after code");

  const codeBlock = editor.locator("pre code");
  await expect(codeBlock).toContainText("printf hello");
  await expect(codeBlock).not.toContainText("```");
  await expect(editor.locator("p").filter({ hasText: "after code" })).toBeVisible();
  await expect(editor).not.toContainText("```sh");

  await editor.fill("");
  await editor.evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "> pasted quote\nplain text\n```sh\nprintf pasted\n```");
    node.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  });
  await expect(editor.locator("blockquote")).toContainText("pasted quote");
  await expect(editor.locator("pre code").filter({ hasText: "printf pasted" })).toBeVisible();
  await expect(editor).not.toContainText("```sh");
});
