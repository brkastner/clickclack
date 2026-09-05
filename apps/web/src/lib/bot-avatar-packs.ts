import { sha256 } from "@noble/hashes/sha2.js";
import { get, writable } from "svelte/store";
import { api } from "./api.ts";

export const BOT_AVATAR_PACK_STORAGE_KEY = "clickclack:bot-avatar-pack:v1";
export type BotAvatarPreference = { enabled: boolean; pack: string };

export function normalizeAvatarPack(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.trim();
  return [...name].length <= 128 && !/[/\\\0]/u.test(name) && !name.includes("..") ? name : "";
}

export function loadBotAvatarPreference(): BotAvatarPreference {
  try {
    const value = JSON.parse(localStorage.getItem(BOT_AVATAR_PACK_STORAGE_KEY) || "null");
    return { enabled: value?.enabled === true, pack: normalizeAvatarPack(value?.pack) };
  } catch {
    return { enabled: false, pack: "" };
  }
}

export const botAvatarPreference = writable(loadBotAvatarPreference());
export const botAvatarPacks = writable<{
  packs: string[];
  directory: string;
  loading: boolean;
  failed: boolean;
}>({
  packs: [],
  directory: "",
  loading: true,
  failed: false,
});
export const botAvatarFiles = writable<string[]>([]);
let listingRequest = 0;
let initialized = false;

export async function refreshBotAvatarFiles(): Promise<void> {
  const request = ++listingRequest;
  const { enabled, pack } = get(botAvatarPreference);
  botAvatarFiles.set([]);
  if (!enabled || !pack) return;
  try {
    const result = await api<{ files: string[] }>(`/api/avatar-packs/${encodeURIComponent(pack)}`);
    // Keep URLs on the existing API origin, even if a response is malformed.
    const prefix = "/api/avatar-packs/";
    const files = result.files.filter((file) => {
      if (!file.startsWith(prefix)) return false;
      try {
        const parts = file.slice(prefix.length).split("/");
        if (parts.length !== 2 || decodeURIComponent(parts[0]!) !== pack) return false;
        const name = decodeURIComponent(parts[1]!);
        return (
          name !== "" &&
          !/[/\\\0]/u.test(name) &&
          !name.includes("..") &&
          /\.(png|jpe?g|gif|webp|avif)$/iu.test(name)
        );
      } catch {
        return false;
      }
    });
    if (request === listingRequest) botAvatarFiles.set(files.slice(0, 1000));
  } catch {
    // Empty and failed listings intentionally preserve normal avatars.
  }
}

export function setBotAvatarPreference(value: BotAvatarPreference): void {
  const preference = { enabled: value.enabled === true, pack: normalizeAvatarPack(value.pack) };
  botAvatarPreference.set(preference);
  try {
    localStorage.setItem(BOT_AVATAR_PACK_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    /* Storage may be disabled. */
  }
  void refreshBotAvatarFiles();
}

export async function loadBotAvatarPacks(refresh = false): Promise<void> {
  if (initialized && !refresh) return;
  initialized = true;
  botAvatarPacks.update((state) => ({ ...state, loading: true }));
  try {
    const result = await api<{ packs: string[]; directory: string }>("/api/avatar-packs");
    botAvatarPacks.set({ ...result, loading: false, failed: false });
    await refreshBotAvatarFiles();
  } catch {
    initialized = false;
    botAvatarPacks.set({ packs: [], directory: "", loading: false, failed: true });
    ++listingRequest;
    botAvatarFiles.set([]);
  }
}

// Byte-wise reduction is the unsigned big-endian SHA-256 digest modulo length.
// Pure JS SHA-256 also supports self-hosted HTTP origins without Web Crypto.
export function botAvatarIndex(id: string, length: number): number {
  if (length <= 0) return 0;
  let index = 0;
  for (const byte of sha256(new TextEncoder().encode(id))) index = (index * 256 + byte) % length;
  return index;
}

export function botAvatarCandidates(
  id: string | null | undefined,
  isBot: boolean,
  files: string[],
  stored: string,
): string[] {
  if (!isBot || !id || !files.length) return stored ? [stored] : [];
  const index = botAvatarIndex(id, files.length);
  const assigned = files[index]!;
  const alternate = files[(index + 1) % files.length]!;
  return [...new Set([assigned, alternate, stored].filter(Boolean))];
}

export function nextAvatarSource(candidates: string[], failed: readonly string[]): string {
  return candidates.find((source) => !failed.includes(source)) || "";
}
