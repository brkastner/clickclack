import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { get } from "svelte/store";
import {
  BOT_AVATAR_PACK_STORAGE_KEY,
  botAvatarCandidates,
  botAvatarFiles,
  botAvatarIndex,
  botAvatarPreference,
  loadBotAvatarPreference,
  nextAvatarSource,
  normalizeAvatarPack,
  refreshBotAvatarFiles,
  setBotAvatarPreference,
} from "./bot-avatar-packs.ts";

test("botAvatarIndex implements UTF-8 SHA-256 unsigned big-endian modulo", () => {
  for (const id of ["usr_bot", "бот🦞", "", "usr_other"]) {
    for (const length of [1, 2, 7, 1000]) {
      const digest = createHash("sha256").update(id, "utf8").digest("hex");
      assert.equal(botAvatarIndex(id, length), Number(BigInt(`0x${digest}`) % BigInt(length)));
      assert.equal(botAvatarIndex(id, length), botAvatarIndex(id, length));
    }
  }
  assert.equal(botAvatarIndex("bot", 0), 0);
});

test("botAvatarCandidates preserves humans and bounds alternate, stored, initials fallback", () => {
  const files = ["a.png", "b.png", "c.png"];
  const candidates = botAvatarCandidates("bot", true, files, "light.png");
  assert.equal(candidates[0], files[botAvatarIndex("bot", files.length)]);
  assert.equal(candidates[1], files[(botAvatarIndex("bot", files.length) + 1) % files.length]);
  assert.equal(candidates[2], "light.png");
  const failed: string[] = [];
  for (const expected of candidates) {
    assert.equal(nextAvatarSource(candidates, failed), expected);
    failed.push(expected);
  }
  assert.equal(nextAvatarSource(candidates, failed), "");
  assert.deepEqual(botAvatarCandidates("human", false, files, "human.png"), ["human.png"]);
  assert.deepEqual(botAvatarCandidates("bot", true, ["one.png"], "stored.png"), [
    "one.png",
    "stored.png",
  ]);
  assert.deepEqual(botAvatarCandidates("bot", true, [], "stored.png"), ["stored.png"]);
  assert.deepEqual(botAvatarCandidates("bot", true, [], ""), []);
  assert.deepEqual(botAvatarCandidates("bot", true, files, "light.png"), candidates);
  assert.notDeepEqual(
    botAvatarCandidates("bot", true, ["new.png", ...files], "light.png"),
    candidates,
  );
});

test("local preferences default off, sanitize and persist without roaming; stale listings cannot win", async () => {
  const storage = new Map<string, string>();
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const oldFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  const calls: string[] = [];
  let resolveOld: (value: Response) => void = () => {};
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    assert.ok(!init?.method || init.method === "GET");
    if (String(input).endsWith("/old"))
      return new Promise<Response>((resolve) => {
        resolveOld = resolve;
      });
    return Response.json({
      files: [
        "/api/avatar-packs/new/a.png",
        "https://evil.test/a.png",
        "/api/avatar-packs/new/%2e%2e.png",
      ],
    });
  };
  try {
    assert.deepEqual(loadBotAvatarPreference(), { enabled: false, pack: "" });
    for (const name of ["../a", "a/b", "a\\b", "a\0b", "x".repeat(129)])
      assert.equal(normalizeAvatarPack(name), "");
    assert.equal(normalizeAvatarPack("  neutral  "), "neutral");
    setBotAvatarPreference({ enabled: false, pack: " new " });
    assert.deepEqual(loadBotAvatarPreference(), { enabled: false, pack: "new" });
    assert.equal(calls.length, 0);
    assert.ok(storage.has(BOT_AVATAR_PACK_STORAGE_KEY));
    botAvatarPreference.set({ enabled: true, pack: "old" });
    const old = refreshBotAvatarFiles();
    botAvatarPreference.set({ enabled: true, pack: "new" });
    await refreshBotAvatarFiles();
    resolveOld(Response.json({ files: ["/api/avatar-packs/old/a.png"] }));
    await old;
    assert.deepEqual(get(botAvatarFiles), ["/api/avatar-packs/new/a.png"]);
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    await refreshBotAvatarFiles();
    assert.deepEqual(get(botAvatarFiles), []);
    assert.ok(calls.every((path) => path.startsWith("/api/avatar-packs/")));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    botAvatarPreference.set({ enabled: false, pack: "" });
  }
});

test("appearance preference remains outside account schema and avatar override never writes identities", () => {
  const state = readFileSync(new URL("./bot-avatar-packs.ts", import.meta.url), "utf8");
  assert.doesNotMatch(state, /\/api\/me|avatar_url\s*=/u);
  const avatar = readFileSync(
    new URL("../components/avatar/Avatar.svelte", import.meta.url),
    "utf8",
  );
  assert.match(avatar, /isBot = false/u);
  assert.match(avatar, /avatarURLForColorMode\(src, lightSrc/u);
  const settings = readFileSync(
    new URL("../components/settings/BotAvatarPacksSection.svelte", import.meta.url),
    "utf8",
  );
  assert.match(settings, /disabled=\{/u);
  assert.match(settings, /on this device only/u);
});

test("pinned React island receives candidates from Svelte without fetching or subscribing", () => {
  const island = readFileSync(
    new URL("../components/avatar/BotAvatarImage.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(island, /useSyncExternalStore|fetch\(|loadBotAvatarPacks|\.subscribe/u);
  const host = readFileSync(
    new URL("../components/pins/PinnedPanel.svelte", import.meta.url),
    "utf8",
  );
  assert.match(host, /avatarCandidates/u);
  assert.match(host, /author\?\.kind === "bot" && !author.deleted_at/u);
});

test("ProfileEditor identity and crop previews bypass packs while retaining editable sources", () => {
  const editor = readFileSync(
    new URL("../components/profile/ProfileEditor.svelte", import.meta.url),
    "utf8",
  );
  const previews = editor.match(/<Avatar\b[\s\S]*?\/>/gu) ?? [];
  assert.equal(previews.length, 2);
  for (const preview of previews) {
    assert.match(preview, /isBot=\{false\}/u);
    assert.match(preview, /src=\{avatarURL\}/u);
    assert.match(preview, /lightSrc=\{avatarURLLight\}/u);
  }
  assert.match(previews[1], /imagePosition=\{`50% \$\{heroPosition.y\}%`\}/u);
  assert.match(previews[1], /imageOffsetX=\{50 - heroPosition.x\}/u);
  assert.match(previews[1], /imageScale=\{heroPosition.zoom \/ 100\}/u);
});
