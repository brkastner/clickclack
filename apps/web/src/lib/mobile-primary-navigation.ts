export const MOBILE_CHAT_ROUTE_STORAGE_PREFIX = "clickclack:mobile-chat-route:v1:";

export type MobilePrimaryDestination = "home" | "gallery" | "chat";

function routeSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

function workspaceSegments(pathname: string, workspaceID: string): string[] | null {
  const segments = routeSegments(pathname);
  if (segments[0] !== "app" || segments[1] !== workspaceID) return null;
  return segments.slice(2);
}

export function mobilePrimaryDestination(
  pathname: string,
  workspaceID: string,
): MobilePrimaryDestination | null {
  const rest = workspaceSegments(pathname, workspaceID);
  if (!rest) return null;
  if (rest.length === 0) return "chat";
  if (rest.length === 1 && rest[0] !== "settings" && rest[0] !== "views") return "chat";
  if (rest.length !== 2 || rest[0] !== "views") return null;
  if (rest[1] === "home") return "home";
  if (rest[1] === "vai-gallery") return "gallery";
  return null;
}

export function conversationPath(pathname: string, workspaceID: string): string | null {
  const rest = workspaceSegments(pathname, workspaceID);
  return rest?.length === 1 && rest[0] !== "settings" && rest[0] !== "views" ? pathname : null;
}

export function mobileChatRouteStorageKey(workspaceID: string): string {
  return `${MOBILE_CHAT_ROUTE_STORAGE_PREFIX}${workspaceID}`;
}

export function storedConversationPath(value: string | null, workspaceID: string): string | null {
  if (!value) return null;
  return conversationPath(value, workspaceID);
}

const MOBILE_KEYBOARD_MIN_OCCLUSION = 120;

export function mobileKeyboardOpen(
  layoutViewportHeight: number,
  visibleViewportHeight: number,
  editableFocused: boolean,
): boolean {
  if (!editableFocused) return false;
  return layoutViewportHeight - visibleViewportHeight >= MOBILE_KEYBOARD_MIN_OCCLUSION;
}
