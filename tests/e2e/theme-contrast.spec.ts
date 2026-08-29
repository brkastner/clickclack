import { expect, test } from "@playwright/test";
import { waitForAppReady } from "./app-ready";

type RGB = [number, number, number];

function parseColor(value: string): RGB {
  const color = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return [1, 2, 3].map((index) => Number.parseInt(`${color[index]}${color[index]}`, 16)) as RGB;
  }
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return [
      Number.parseInt(color.slice(1, 3), 16),
      Number.parseInt(color.slice(3, 5), 16),
      Number.parseInt(color.slice(5, 7), 16),
    ];
  }
  const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) throw new Error(`unsupported color: ${value}`);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

function relativeLuminance(color: RGB): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const values = [
    relativeLuminance(parseColor(foreground)),
    relativeLuminance(parseColor(background)),
  ];
  const lighter = Math.max(...values);
  const darker = Math.min(...values);
  return (lighter + 0.05) / (darker + 0.05);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`workspace switcher text meets WCAG contrast in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/app");
    await waitForAppReady(page);

    const trigger = page.getByRole("button", { name: "Switch workspace" });
    const label = trigger.locator(".workspace-switcher-label strong");
    const sidebar = page.locator(".sidebar");
    await expect(label).toBeVisible();

    const resting = await label.evaluate((element) => ({
      background: getComputedStyle(element.closest(".sidebar") as Element).backgroundColor,
      foreground: getComputedStyle(element).color,
    }));
    expect(contrastRatio(resting.foreground, resting.background)).toBeGreaterThanOrEqual(4.5);

    await trigger.hover();
    const hovered = await label.evaluate((element) => ({
      background: getComputedStyle(element.closest(".workspace-switcher-trigger") as Element)
        .backgroundColor,
      foreground: getComputedStyle(element).color,
    }));
    expect(parseColor(hovered.foreground)).toEqual(parseColor(resting.foreground));
    expect(hovered.background.trim()).not.toBe("");
    await expect(sidebar).toBeVisible();
  });
}
