import { applyDefaultFetchTimeout } from "./api.ts";

type ClipboardWriter = Pick<Clipboard, "write">;
type ClipboardItemConstructor = new (items: Record<string, Blob>) => ClipboardItem;

type ImageClipboardDependencies = {
  clipboard?: ClipboardWriter;
  clipboardItem?: ClipboardItemConstructor;
  fetcher?: typeof fetch;
  toPNG?: (image: Blob) => Promise<Blob>;
};

function browserClipboard(): ClipboardWriter {
  if (!navigator.clipboard) throw new Error("Clipboard access is unavailable");
  return navigator.clipboard;
}

export function absoluteAttachmentURL(url: string, baseURL = globalThis.location?.href): string {
  return new URL(url, baseURL).href;
}

export async function copyAttachmentLink(
  url: string,
  writeText: (text: string) => Promise<void>,
  baseURL = globalThis.location?.href,
): Promise<void> {
  await writeText(absoluteAttachmentURL(url, baseURL));
}

async function convertImageToPNG(image: Blob): Promise<Blob> {
  if (image.type.toLowerCase() === "image/png") return image;
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare image clipboard data");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png);
        else reject(new Error("Could not convert image clipboard data to PNG"));
      }, "image/png");
    });
  } finally {
    bitmap.close();
  }
}

export async function copyViewerImage(
  url: string,
  dependencies: ImageClipboardDependencies = {},
): Promise<void> {
  const clipboard = dependencies.clipboard ?? browserClipboard();
  const ClipboardItemClass = dependencies.clipboardItem ?? globalThis.ClipboardItem;
  if (!ClipboardItemClass) throw new Error("Image clipboard access is unavailable");

  const response = await (dependencies.fetcher ?? fetch)(
    url,
    applyDefaultFetchTimeout({ credentials: "include" }),
  );
  if (!response.ok) throw new Error(`Could not load image (${response.status})`);
  const image = await response.blob();
  if (!image.type.toLowerCase().startsWith("image/")) {
    throw new Error(`Expected an image, received ${image.type || "an unknown content type"}`);
  }
  const png = await (dependencies.toPNG ?? convertImageToPNG)(image);
  if (png.type.toLowerCase() !== "image/png") {
    throw new Error(
      `Expected PNG clipboard data, received ${png.type || "an unknown content type"}`,
    );
  }
  await clipboard.write([new ClipboardItemClass({ "image/png": png })]);
}
