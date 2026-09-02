import test from "node:test";
import assert from "node:assert/strict";
import { groupMessages } from "./chat/messages.ts";
import type { Channel, Message, User } from "./types.ts";

const author: User = {
  id: "bot-career",
  kind: "bot",
  display_name: "Recruiter",
  handle: "career",
  avatar_url: "https://example.com/career.png",
  created_at: "2026-09-01T00:00:00Z",
};
const channel: Channel = {
  id: "channel-prep",
  route_id: "prep",
  workspace_id: "workspace",
  name: "prep",
  kind: "public",
  created_at: "2026-09-01T00:00:00Z",
  external_managed: false,
  bot_assignments: [{ channel_id: "channel-prep", bot_user_id: author.id }],
};
const message: Message = {
  id: "message",
  workspace_id: "workspace",
  channel_id: channel.id,
  author_id: author.id,
  body: "hello",
  body_format: "markdown",
  created_at: "2026-09-01T00:00:00Z",
  author,
};

test("groupMessages preserves canonical author objects", () => {
  const groups = groupMessages([message], channel, [channel], [author]);
  assert.equal(groups[0]?.messages[0]?.author, author);
});
