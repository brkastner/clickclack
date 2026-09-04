export type DesktopNotification = {
  body: string;
  route?: string;
  tag?: string;
  title: string;
};

export type DesktopClipboardFile = {
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
  type: string;
};

export type DesktopPasteTarget = "composer" | "profile-dark" | "profile-light";

export type ClickClackDesktopBridge = {
  integratedTitleBar: boolean;
  notify(notification: DesktopNotification): Promise<boolean>;
  onNavigate(callback: (route: string) => void): () => void;
  onPasteFiles(
    target: DesktopPasteTarget,
    callback: (files: DesktopClipboardFile[]) => void,
  ): () => void;
  onPasteText(callback: (text: string) => void): () => void;
  onQuickCompose(callback: () => void): () => void;
  openSettings(): void;
  platform: "darwin" | "linux" | "win32" | string;
  setActiveRoute(route: string): void;
  setUnreadCount(count: number): void;
  signInWithGitHub(): Promise<boolean>;
  toggleTerminal(): void;
  writeClipboardImage(png: ArrayBuffer): Promise<boolean>;
  writeClipboardText(text: string): Promise<boolean>;
};

export const desktop: ClickClackDesktopBridge | undefined =
  typeof window === "undefined" ? undefined : window.clickclackDesktop;

export function browserFilesFromDesktop(files: DesktopClipboardFile[]): File[] {
  return files.slice(0, 10).flatMap((file) => {
    if (
      !file ||
      typeof file.name !== "string" ||
      !file.name ||
      /[/\\]/.test(file.name) ||
      typeof file.type !== "string" ||
      !file.type.startsWith("image/") ||
      !(file.bytes instanceof Uint8Array)
    ) {
      return [];
    }
    return [new File([file.bytes], file.name, { type: file.type })];
  });
}
