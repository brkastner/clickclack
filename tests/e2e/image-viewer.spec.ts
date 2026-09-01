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

test("pages through image attachments with controls and arrow keys", async ({ page }) => {
  const suffix = Date.now();
  const firstFilename = `gallery-first-${suffix}.png`;
  const secondFilename = `gallery-second-${suffix}.png`;
  const messageText = `image gallery ${suffix}`;
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  );

  await page.goto("/app");
  await waitForAppReady(page);
  await page.getByLabel("Upload file").setInputFiles([
    { name: firstFilename, mimeType: "image/png", buffer: pixel },
    { name: secondFilename, mimeType: "image/png", buffer: pixel },
  ]);
  await page.getByLabel("Message body").fill(messageText);
  await page.getByRole("button", { name: "Send" }).click();

  const imageRow = page.locator(".message-row").filter({ hasText: messageText });
  await imageRow.getByRole("button", { name: `Open image ${firstFilename}` }).click();

  let dialog = page.getByRole("dialog", { name: `Image viewer: ${firstFilename}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("1 / 2")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Previous image" })).toBeDisabled();

  await dialog.getByRole("button", { name: "Next image" }).click();
  dialog = page.getByRole("dialog", { name: `Image viewer: ${secondFilename}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("2 / 2")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open original" })).toHaveAttribute(
    "href",
    /\/api\/uploads\//,
  );

  await page.keyboard.press("ArrowLeft");
  dialog = page.getByRole("dialog", { name: `Image viewer: ${firstFilename}` });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: `Image viewer: ${secondFilename}` })).toBeVisible();
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

  // Wait out the open animation's scale transform before measuring geometry.
  await page
    .locator(".image-viewer")
    .evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );

  const geometry = await page.evaluate(() => {
    const viewer = document.querySelector(".image-viewer")!;
    const stage = document.querySelector(".image-viewer-stage")!;
    const image = stage.querySelector("img")! as HTMLImageElement;
    const viewerBox = viewer.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    const imageBox = image.getBoundingClientRect();
    return {
      viewerHeight: viewerBox.height,
      viewerBottom: viewerBox.bottom,
      viewerTop: viewerBox.top,
      stageHeight: stageBox.height,
      stageWidth: stageBox.width,
      imageHeight: imageBox.height,
      imageWidth: imageBox.width,
      imageBottom: imageBox.bottom,
      naturalWidth: image.naturalWidth,
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
  // A portrait image is never enlarged past its natural size.
  expect(geometry.imageWidth).toBeLessThanOrEqual(geometry.naturalWidth + 1);
  // The viewer uses the height available to it instead of a fixed cap, so a
  // tall image is limited by the viewport rather than by the frame.
  expect(geometry.viewerTop).toBeGreaterThanOrEqual(-1);
  expect(geometry.viewerBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.imageHeight).toBeGreaterThan(geometry.viewerHeight * 0.8);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("keeps a small image at its natural size without a stretched frame", async ({ page }) => {
  const suffix = Date.now();
  const filename = `small-${suffix}.png`;
  const messageText = `small lightbox ${suffix}`;

  await page.goto("/app");
  await waitForAppReady(page);
  await page.getByLabel("Upload file").setInputFiles({
    name: filename,
    mimeType: "image/png",
    buffer: solidPNG(320, 240),
  });
  await expect(page.getByText(filename)).toBeVisible();
  await page.getByLabel("Message body").fill(messageText);
  await page.getByRole("button", { name: "Send" }).click();

  const imageRow = page.locator(".message-row").filter({ hasText: messageText });
  await imageRow.getByRole("button", { name: `Open image ${filename}` }).click();

  const dialog = page.getByRole("dialog", { name: `Image viewer: ${filename}` });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog
        .getByRole("img", { name: filename })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(320);

  // The viewer animates in with a scale transform, so measure only after it
  // settles; a mid-animation rect reports the scaled size, not the laid-out one.
  await page
    .locator(".image-viewer")
    .evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );

  const geometry = await page.evaluate(() => {
    const viewer = document.querySelector(".image-viewer")!.getBoundingClientRect();
    const image = document.querySelector(".image-viewer-stage img")! as HTMLImageElement;
    const imageBox = image.getBoundingClientRect();
    return {
      viewerHeight: viewer.height,
      imageWidth: imageBox.width,
      imageHeight: imageBox.height,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      viewportHeight: window.innerHeight,
    };
  });

  // A small image renders at its natural size rather than being blown up.
  expect(geometry.imageWidth).toBeCloseTo(geometry.naturalWidth, 0);
  expect(geometry.imageHeight).toBeCloseTo(geometry.naturalHeight, 0);
  // The frame hugs that image instead of spanning the whole viewport.
  expect(geometry.viewerHeight).toBeLessThan(geometry.viewportHeight * 0.85);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
