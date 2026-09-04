import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForAppReady } from "./app-ready";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function pasteImages(input: Locator, names: string[]) {
  await input.evaluate(
    (node, payload) => {
      const transfer = new DataTransfer();
      for (const { bytes, name } of payload) {
        transfer.items.add(new File([Uint8Array.from(bytes)], name, { type: "image/png" }));
      }
      node.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
    },
    names.map((name) => ({ bytes: [...png], name })),
  );
}

async function openProfileSettings(page: Page) {
  await page.goto("/app");
  await waitForAppReady(page);
  await page.getByRole("button", { name: /Account settings for/ }).click({ button: "right" });
  await expect(page.getByRole("heading", { name: "Profile settings" })).toBeVisible();
}

test("profile image paste targets each avatar field and rolls back failed uploads", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const revoke = URL.revokeObjectURL.bind(URL);
    (window as unknown as { __revokedObjectURLs: string[] }).__revokedObjectURLs = [];
    URL.revokeObjectURL = (url) => {
      (window as unknown as { __revokedObjectURLs: string[] }).__revokedObjectURLs.push(url);
      revoke(url);
    };
  });
  await openProfileSettings(page);

  const dark = page.getByLabel("Default or dark avatar URL");
  const light = page.getByLabel("Light mode avatar URL");
  await dark.fill("https://example.com/prior-dark.png");

  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>((resolve) => (releaseUpload = resolve));
  await page.route("**/api/uploads?**", async (route) => {
    await uploadGate;
    await route.continue();
  });
  await pasteImages(dark, ["dark.png"]);
  const darkPreview = page.locator('[data-avatar-preview="dark"]');
  await expect(darkPreview).toHaveAttribute("src", /^blob:/);
  const darkPreviewURL = await darkPreview.getAttribute("src");
  releaseUpload();
  await expect(dark).toHaveValue(/^\/api\/uploads\/upl_/);
  await expect
    .poll(() =>
      page.evaluate(
        (url) =>
          (window as unknown as { __revokedObjectURLs: string[] }).__revokedObjectURLs.includes(
            url ?? "",
          ),
        darkPreviewURL,
      ),
    )
    .toBe(true);
  await page.unroute("**/api/uploads?**");

  await pasteImages(light, ["light.png"]);
  await expect(light).toHaveValue(/^\/api\/uploads\/upl_/);
  const hostedDark = await dark.inputValue();
  const hostedLight = await light.inputValue();
  expect(hostedLight).not.toBe(hostedDark);

  await dark.fill("https://example.com/keep-on-failure.png");
  await page.route("**/api/uploads?**", (route) => route.abort("failed"));
  await pasteImages(dark, ["failed.png"]);
  await expect(page.getByText(/Could not upload profile photo|Failed to fetch/)).toBeVisible();
  await expect(dark).toHaveValue("https://example.com/keep-on-failure.png");
  await page.unroute("**/api/uploads?**");

  await pasteImages(dark, ["one.png", "two.png"]);
  await expect(page.getByText("Paste exactly one image for this profile photo.")).toBeVisible();
  await expect(dark).toHaveValue("https://example.com/keep-on-failure.png");

  const plainTextPasteAllowed = await dark.evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "https://example.com/native.png");
    return node.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  });
  expect(plainTextPasteAllowed).toBe(true);

  await dark.fill(hostedDark);
  await light.fill(hostedLight);
  await page.getByRole("button", { name: "Save profile" }).click();
  const response = await page.request.get("/api/me");
  const body = (await response.json()) as {
    user: { avatar_url: string; avatar_url_light: string };
  };
  expect(body.user.avatar_url).toBe(hostedDark);
  expect(body.user.avatar_url_light).toBe(hostedLight);
});

test("composer shows a local image thumbnail until upload completes", async ({ page }) => {
  await page.addInitScript(() => {
    const revoke = URL.revokeObjectURL.bind(URL);
    (window as unknown as { __revokedObjectURLs: string[] }).__revokedObjectURLs = [];
    URL.revokeObjectURL = (url) => {
      (window as unknown as { __revokedObjectURLs: string[] }).__revokedObjectURLs.push(url);
      revoke(url);
    };
  });
  await page.goto("/app");
  await waitForAppReady(page);

  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>((resolve) => (releaseUpload = resolve));
  await page.route("**/api/uploads?**", async (route) => {
    await uploadGate;
    await route.continue();
  });
  await page.getByLabel("Upload file").setInputFiles({
    name: "composer.png",
    mimeType: "image/png",
    buffer: png,
  });

  const thumbnail = page.getByLabel("Pending attachments").locator(".pending-image");
  await expect(thumbnail).toHaveAttribute("src", /^blob:/);
  const previewURL = await thumbnail.getAttribute("src");
  await expect(
    page.getByLabel("Pending attachments").getByText("Uploading", { exact: false }),
  ).toBeVisible();
  releaseUpload();
  await expect(
    page.getByLabel("Pending attachments").getByText("Ready", { exact: false }),
  ).toBeVisible();
  await expect(thumbnail).toHaveAttribute("src", /\/api\/uploads\/upl_/);
  await expect
    .poll(() =>
      page.evaluate(
        (url) =>
          (window as unknown as { __revokedObjectURLs: string[] }).__revokedObjectURLs.includes(
            url ?? "",
          ),
        previewURL,
      ),
    )
    .toBe(true);
});
