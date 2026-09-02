import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  collectChannelProfileShortcuts,
  replaceConversationUsers,
  replaceMessageUsers,
} from "./chat/people.ts";
import type { DirectConversation, Message, User } from "./types.ts";

const bots: User[] = [
  {
    id: "bot-career",
    kind: "bot",
    display_name: "Recruiter",
    handle: "career",
    avatar_url: "career.png",
    created_at: "2026-09-01T00:00:00Z",
  },
  {
    id: "bot-liz",
    kind: "bot",
    display_name: "Liz",
    handle: "liz",
    avatar_url: "liz.png",
    avatar_url_light: "liz-light.png",
    created_at: "2026-09-01T00:00:00Z",
  },
];

test("collectChannelProfileShortcuts emits one canonical shortcut per bot", () => {
  assert.deepEqual(collectChannelProfileShortcuts([], bots), [
    {
      id: "bot-career",
      bot_user_id: "bot-career",
      display_name: "Recruiter",
      handle: "career",
      avatar_url: "career.png",
      unread_count: 0,
    },
    {
      id: "bot-liz",
      bot_user_id: "bot-liz",
      display_name: "Liz",
      handle: "liz",
      avatar_url: "liz.png",
      avatar_url_light: "liz-light.png",
      unread_count: 0,
    },
  ]);
});

test("replaces stale avatar variants in cached message and DM identities", () => {
  const stale = bots[1]!;
  const updated = { ...stale, avatar_url: "liz-v2.png", avatar_url_light: "liz-light-v2.png" };
  const message = {
    id: "msg-1",
    workspace_id: "wsp-1",
    author_id: stale.id,
    thread_root_id: "msg-1",
    body: "hello",
    body_format: "markdown",
    created_at: "2026-09-01T00:00:00Z",
    author: stale,
  } satisfies Message;
  const conversation = {
    id: "dm-1",
    route_id: "dm-1",
    workspace_id: "wsp-1",
    members: [stale],
    created_at: "2026-09-01T00:00:00Z",
    can_send: true,
  } satisfies DirectConversation;

  assert.equal(replaceMessageUsers(message, updated).author, updated);
  assert.equal(replaceConversationUsers(conversation, updated).members[0], updated);
});

test("people module does not compare bot display names", async () => {
  const source = await readFile(new URL("./chat/people.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /display_name\s*(?:===|!==)/u);
});
