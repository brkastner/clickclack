import { writable } from "svelte/store";

export type AvatarSize = "regular" | "double";

export const AVATAR_SIZE_STORAGE_KEY = "clickclack:avatar-size:v1";
export const DEFAULT_AVATAR_SIZE: AvatarSize = "regular";

function initialAvatarSize(): AvatarSize {
  if (typeof document === "undefined") return DEFAULT_AVATAR_SIZE;
  return document.documentElement.getAttribute("data-avatar-size") === "double"
    ? "double"
    : DEFAULT_AVATAR_SIZE;
}

export const avatarSize = writable<AvatarSize>(initialAvatarSize());

export function setAvatarSize(size: AvatarSize) {
  avatarSize.set(size);
  try {
    if (size === DEFAULT_AVATAR_SIZE) {
      document.documentElement.removeAttribute("data-avatar-size");
      window.localStorage.removeItem(AVATAR_SIZE_STORAGE_KEY);
    } else {
      document.documentElement.setAttribute("data-avatar-size", size);
      window.localStorage.setItem(AVATAR_SIZE_STORAGE_KEY, size);
    }
  } catch {
    // Non-DOM context or blocked storage. The in-memory preference still applies.
  }
}
