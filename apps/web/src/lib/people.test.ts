import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { collectChannelProfileShortcuts } from "./chat/people.ts";
import type { User } from "./types.ts";

const bots: User[] = [
  { id: "bot-career", kind: "bot", display_name: "Recruiter", handle: "career", avatar_url: "career.png", created_at: "2026-09-01T00:00:00Z" },
  { id: "bot-liz", kind: "bot", display_name: "Liz", handle: "liz", avatar_url: "liz.png", created_at: "2026-09-01T00:00:00Z" },
];

test("collectChannelProfileShortcuts emits one canonical shortcut per bot", () => {
  assert.deepEqual(collectChannelProfileShortcuts([], bots), [
    { id: "bot-career", bot_user_id: "bot-career", display_name: "Recruiter", handle: "career", avatar_url: "career.png", unread_count: 0 },
    { id: "bot-liz", bot_user_id: "bot-liz", display_name: "Liz", handle: "liz", avatar_url: "liz.png", unread_count: 0 },
  ]);
});

test("people module does not compare bot display names", async () => {
  const source = await readFile(new URL("./chat/people.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /display_name\s*(?:===|!==)/u);
});
