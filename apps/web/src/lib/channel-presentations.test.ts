import assert from "node:assert/strict";
import test from "node:test";
import type { Channel, DirectConversation, Message, User } from "./types.ts";
import {
  type ChannelProfileShortcut,
  collectChannelProfileShortcuts,
  moveChannelInOrder,
  orderProfileShortcuts,
  profileHeaderTarget,
  profileIsCanonicalIdentity,
  presentChannelMessage,
  presentChannelUser,
} from "./chat/people.ts";

const bot: User = {
  id: "usr_kai",
  kind: "bot",
  display_name: "кай",
  handle: "kai",
  avatar_url: "https://example.com/kai.webp",
  created_at: "2026-01-01T00:00:00Z",
};

const channel: Channel = {
  id: "chn_liz",
  route_id: "C1",
  workspace_id: "wsp_1",
  name: "liz",
  kind: "public",
  created_at: "2026-01-01T00:00:00Z",
  external_managed: false,
  bot_presentations: [
    {
      channel_id: "chn_liz",
      bot_user_id: bot.id,
      display_name: "лиза",
      avatar_url: "https://example.com/liz.webp",
      updated_by: "usr_owner",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
};

test("channel bot presentation overrides only visual bot fields", () => {
  assert.deepEqual(presentChannelUser(bot, channel), {
    ...bot,
    display_name: "лиза",
    avatar_url: "https://example.com/liz.webp",
  });
});

test("channel bot presentation preserves identity and applies to quoted authors", () => {
  const message: Message = {
    id: "msg_1",
    workspace_id: channel.workspace_id,
    channel_id: channel.id,
    author_id: bot.id,
    author: bot,
    quoted_author: bot,
    thread_root_id: "msg_1",
    body: "hello",
    body_format: "markdown",
    created_at: "2026-01-01T00:00:00Z",
    kind: "message",
  };
  const presented = presentChannelMessage(message, channel);
  assert.equal(presented.author?.id, bot.id);
  assert.equal(presented.author?.handle, "kai");
  assert.equal(presented.author?.display_name, "лиза");
  assert.equal(presented.quoted_author?.display_name, "лиза");
  assert.equal(message.author?.display_name, "кай");
});

test("channel bot presentation does not alias humans or deleted bots", () => {
  assert.equal(presentChannelUser({ ...bot, kind: "human" }, channel)?.display_name, "кай");
  assert.equal(
    presentChannelUser({ ...bot, deleted_at: "2026-01-02T00:00:00Z" }, channel)?.display_name,
    "кай",
  );
});

test("channel presentations become profile shortcuts backed by the bot handle", () => {
  assert.deepEqual(collectChannelProfileShortcuts([channel], [bot]), [
    {
      id: `${channel.id}:${bot.id}`,
      channel_id: channel.id,
      channel_name: channel.name,
      bot_user_id: bot.id,
      display_name: "лиза",
      avatar_url: "https://example.com/liz.webp",
      handle: "kai",
      unread_count: 0,
    },
  ]);
});

test("copied profile presentations do not create duplicate profile shortcuts", () => {
  const copied = {
    ...channel,
    id: "chn_mock_interview",
    name: "mock-interview",
    sidebar_section: `profile:${channel.id}`,
    bot_presentations: channel.bot_presentations?.map((presentation) => ({
      ...presentation,
      channel_id: "chn_mock_interview",
    })),
  };
  assert.deepEqual(collectChannelProfileShortcuts([channel, copied], [bot]), [
    {
      id: `${channel.id}:${bot.id}`,
      channel_id: channel.id,
      channel_name: channel.name,
      bot_user_id: bot.id,
      display_name: "лиза",
      avatar_url: "https://example.com/liz.webp",
      handle: "kai",
      unread_count: 0,
    },
  ]);
});

test("profile shortcuts omit missing and deleted bot identities", () => {
  assert.deepEqual(collectChannelProfileShortcuts([channel], []), []);
  assert.deepEqual(
    collectChannelProfileShortcuts([channel], [{ ...bot, deleted_at: "2026-01-02T00:00:00Z" }]),
    [],
  );
});

function shortcut(channelID: string, name: string): ChannelProfileShortcut {
  return {
    id: `${channelID}:${bot.id}`,
    channel_id: channelID,
    channel_name: channelID,
    bot_user_id: bot.id,
    display_name: name,
    avatar_url: "",
    handle: "kai",
    unread_count: 0,
  };
}

test("profile groups follow the viewer channel order", () => {
  const profiles = [
    shortcut("chn_career", "рекрутер"),
    shortcut("chn_kai", "кай"),
    shortcut("chn_pi", "пи"),
  ];
  const ordered = orderProfileShortcuts(profiles, ["chn_pi", "chn_career", "chn_kai"]);
  assert.deepEqual(
    ordered.map((profile) => profile.display_name),
    ["пи", "рекрутер", "кай"],
  );
});

test("profiles missing from the viewer order keep their relative tail position", () => {
  const profiles = [
    shortcut("chn_career", "рекрутер"),
    shortcut("chn_kai", "кай"),
    shortcut("chn_pi", "пи"),
  ];
  const ordered = orderProfileShortcuts(profiles, ["chn_pi"]);
  assert.deepEqual(
    ordered.map((profile) => profile.display_name),
    ["пи", "рекрутер", "кай"],
  );
});

test("moving a channel in the viewer order lands before or after the target", () => {
  const order = ["a", "b", "c", "d"];
  assert.deepEqual(moveChannelInOrder(order, "d", "a", true), ["d", "a", "b", "c"]);
  assert.deepEqual(moveChannelInOrder(order, "a", "c", false), ["b", "c", "a", "d"]);
});

test("moving a channel is a no-op for unknown or self targets", () => {
  const order = ["a", "b"];
  assert.equal(moveChannelInOrder(order, "a", "a", true), order);
  assert.equal(moveChannelInOrder(order, "z", "a", true), order);
  assert.equal(moveChannelInOrder(order, "a", "z", true), order);
});

const kaiDM = {
  id: "dm_kai",
  workspace_id: "wsp_1",
  members: [{ ...bot }, { id: "usr_kas", kind: "human", display_name: "kas", created_at: "" }],
  created_at: "2026-01-01T00:00:00Z",
} as unknown as DirectConversation;

test("a canonical profile header opens the bot direct conversation", () => {
  const canonical = { ...shortcut("chn_kai", "кай"), bot_user_id: bot.id };
  assert.equal(profileIsCanonicalIdentity(canonical, [bot]), true);
  assert.deepEqual(profileHeaderTarget(canonical, [bot], [kaiDM]), {
    kind: "direct",
    id: "dm_kai",
  });
});

test("persona profiles over one bot keep their own source channel", () => {
  for (const label of ["лиза", "рекрутер", "казначей", "девушки"]) {
    const persona = { ...shortcut(`chn_${label}`, label), bot_user_id: bot.id };
    assert.equal(profileIsCanonicalIdentity(persona, [bot]), false);
    assert.deepEqual(profileHeaderTarget(persona, [bot], [kaiDM]), {
      kind: "channel",
      id: `chn_${label}`,
    });
  }
});

test("a canonical profile falls back to its channel when no direct conversation exists", () => {
  const canonical = { ...shortcut("chn_kai", "кай"), bot_user_id: bot.id };
  assert.deepEqual(profileHeaderTarget(canonical, [bot], []), {
    kind: "channel",
    id: "chn_kai",
  });
});

test("a missing or deleted bot is never canonical", () => {
  const canonical = { ...shortcut("chn_kai", "кай"), bot_user_id: bot.id };
  assert.equal(profileIsCanonicalIdentity(canonical, []), false);
  assert.equal(
    profileIsCanonicalIdentity(canonical, [{ ...bot, deleted_at: "2026-01-02T00:00:00Z" }]),
    false,
  );
});
