import test from "node:test";
import assert from "node:assert/strict";
import { channelProfileMentionText } from "./chat/people.ts";
import type { ChannelProfileShortcut } from "./chat/people.ts";
import type { User } from "./types.ts";

const profile: ChannelProfileShortcut = {
  id: "profile-career",
  channel_id: "channel-career",
  channel_name: "career",
  bot_user_id: "bot-career",
  display_name: "рекрутер",
  avatar_url: "",
  handle: "kai",
  unread_count: 0,
};
const bot: User = {
  id: "bot-career",
  kind: "bot",
  display_name: "рекрутер",
  handle: "career",
  avatar_url: "",
  created_at: "2026-09-01T00:00:00Z",
};

test("profile suggestion inserts the selected bot's canonical handle", () => {
  assert.equal(channelProfileMentionText(profile, [bot]), "@career ");
});
