import { expect, test } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { waitForAppReady } from "./app-ready";

// Builds a real PNG of the requested size. The viewer's containment behavior
// depends on the image's natural dimensions, so a 1x1 fixture cannot prove it.
function solidPNG(width: number, height: number): Buffer {
  const raw = Buffer.concat(
    Array.from({ length: height }, () =>
      Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x40)]),
    ),
  );
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buffer: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("opens conversation and thread images in an accessible lightbox", async ({ page }) => {
  const suffix = Date.now();
  const filename = `lightbox-${suffix}.png`;
  const messageText = `image lightbox ${suffix}`;

  await page.goto("/app");
  await waitForAppReady(page);
  await page.getByLabel("Upload file").setInputFiles({
    name: filename,
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByText(filename)).toBeVisible();
  await page.getByLabel("Message body").fill(messageText);
  await page.getByRole("button", { name: "Send" }).click();

  const imageRow = page.locator(".message-row").filter({ hasText: messageText });
  const conversationTrigger = imageRow.getByRole("button", { name: `Open image ${filename}` });
  await expect(conversationTrigger).toBeVisible();

  await page.getByRole("button", { name: /Account settings for/ }).click({ button: "right" });
  const settingsDialog = page.getByRole("dialog", { name: "Account settings" });
  await expect(settingsDialog).toBeVisible();
  await conversationTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: `Image viewer: ${filename}` })).toHaveCount(0);
  await settingsDialog.getByRole("button", { name: "Close" }).click();

  await conversationTrigger.click();

  const dialog = page.getByRole("dialog", { name: `Image viewer: ${filename}` });
  const closeButton = dialog.getByRole("button", { name: "Close image viewer" });
  const openOriginal = dialog.getByRole("link", { name: "Open original" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const displayedImage = dialog.getByRole("img", { name: filename });
  await expect(displayedImage).toBeVisible();
  await expect
    .poll(() => displayedImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  const uploadedImageURL = await displayedImage.getAttribute("src");
  expect(uploadedImageURL).toMatch(/\/api\/uploads\//);
  await expect(openOriginal).toHaveAttribute("href", uploadedImageURL!);
  await expect(page.locator(".shell")).toHaveAttribute("inert", "");
  await expect(closeButton).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(openOriginal).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(conversationTrigger).toBeFocused();
  await expect(page.locator(".shell")).not.toHaveAttribute("inert", "");

  await imageRow.getByRole("button", { name: "Open thread" }).click();
  const threadPane = page.getByLabel("Thread pane", { exact: true });
  const threadTrigger = threadPane.getByRole("button", { name: `Open image ${filename}` });
  await expect(threadTrigger).toBeVisible();
  await threadTrigger.click();
  await expect(dialog).toBeVisible();
  await expect(displayedImage).toHaveAttribute("src", uploadedImageURL!);
  await expect
    .poll(() => displayedImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(openOriginal).toHaveAttribute("href", uploadedImageURL!);

  await page.locator(".image-viewer-scrim > .modal-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
  await expect(threadTrigger).toBeFocused();
});

test("scales a tall image to fit instead of cropping it", async ({ page }) => {
  const suffix = Date.now();
  const filename = `portrait-${suffix}.png`;
  const messageText = `portrait lightbox ${suffix}`;

  await page.goto("/app");
  await waitForAppReady(page);
  await page.getByLabel("Upload file").setInputFiles({
    name: filename,
    mimeType: "image/png",
    buffer: solidPNG(600, 1600),
  });
  await expect(page.getByText(filename)).toBeVisible();
  await page.getByLabel("Message body").fill(messageText);
  await page.getByRole("button", { name: "Send" }).click();

  const imageRow = page.locator(".message-row").filter({ hasText: messageText });
  await imageRow.getByRole("button", { name: `Open image ${filename}` }).click();

  const dialog = page.getByRole("dialog", { name: `Image viewer: ${filename}` });
  await expect(dialog).toBeVisible();
  const displayedImage = dialog.getByRole("img", { name: filename });
  await expect
    .poll(() => displayedImage.evaluate((image: HTMLImageElement) => image.naturalHeight))
    .toBe(1600);

  const geometry = await page.evaluate(() => {
    const stage = document.querySelector(".image-viewer-stage")!;
    const image = stage.querySelector("img")! as HTMLImageElement;
    const stageBox = stage.getBoundingClientRect();
    const imageBox = image.getBoundingClientRect();
    return {
      stageHeight: stageBox.height,
      stageWidth: stageBox.width,
      imageHeight: imageBox.height,
      imageWidth: imageBox.width,
      imageBottom: imageBox.bottom,
      viewportHeight: window.innerHeight,
      naturalRatio: image.naturalWidth / image.naturalHeight,
    };
  });

  // The whole image fits inside the stage and the viewport, rather than
  // overflowing past the fold.
  expect(geometry.imageHeight).toBeLessThanOrEqual(geometry.stageHeight + 1);
  expect(geometry.imageWidth).toBeLessThanOrEqual(geometry.stageWidth + 1);
  expect(geometry.imageBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  // Scaling preserves the aspect ratio instead of squashing the image.
  expect(geometry.imageWidth / geometry.imageHeight).toBeCloseTo(geometry.naturalRatio, 2);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
