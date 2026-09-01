import assert from "node:assert/strict";
import test from "node:test";
import type { Channel, DirectConversation, Message, User } from "./types.ts";
import {
  type ChannelProfileShortcut,
  collectBotPersonaLanes,
  collectChannelProfileShortcuts,
  collectSidebarPeopleShelf,
  moveChannelInOrder,
  orderProfileShortcuts,
  profileAvatarURL,
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

test("canonical channel history follows the current bot avatar", () => {
  const staleBot = { ...bot, avatar_url: "https://example.com/kai-old.webp" };
  const updatedBot = { ...bot, avatar_url: "https://example.com/kai-new.webp" };
  const canonicalChannel: Channel = {
    ...channel,
    id: "chn_kai",
    bot_presentations: [
      {
        ...channel.bot_presentations![0]!,
        channel_id: "chn_kai",
        display_name: "кай",
        avatar_url: "https://example.com/kai-old.webp",
      },
    ],
  };

  assert.equal(
    presentChannelUser(staleBot, canonicalChannel, [], [updatedBot])?.avatar_url,
    updatedBot.avatar_url,
  );
});

test("assigned channel history follows its source profile avatar", () => {
  const source: Channel = {
    ...channel,
    id: "chn_recruiter",
    bot_presentations: [
      {
        ...channel.bot_presentations![0]!,
        channel_id: "chn_recruiter",
        display_name: "рекрутер",
        avatar_url: "https://example.com/recruiter-new.webp",
      },
    ],
  };
  const assigned: Channel = {
    ...channel,
    id: "chn_interview",
    sidebar_section: `profile:${source.id}`,
    bot_presentations: [
      {
        ...source.bot_presentations![0]!,
        channel_id: "chn_interview",
        avatar_url: "https://example.com/recruiter-old.webp",
      },
    ],
  };

  const presented = presentChannelUser(bot, assigned, [source, assigned], [bot]);
  assert.equal(presented?.display_name, "рекрутер");
  assert.equal(presented?.avatar_url, "https://example.com/recruiter-new.webp");
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

test("persona lanes collect every profile wrapping one bot, in channel order", () => {
  const lanes = collectBotPersonaLanes(
    [shortcut("chn_liz", "лиза"), shortcut("chn_kai", "кай"), shortcut("chn_rec", "рекрутер")],
    bot.id,
    [bot],
    ["chn_kai", "chn_rec", "chn_liz"],
  );
  assert.deepEqual(
    lanes.map((lane) => lane.display_name),
    ["кай", "рекрутер", "лиза"],
  );
  // Only the lane matching the bot's own display name is canonical.
  assert.deepEqual(
    lanes.map((lane) => lane.is_canonical),
    [true, false, false],
  );
  // Lanes carry the bot id so a caller can resolve a DM target from one.
  assert.deepEqual(new Set(lanes.map((lane) => lane.bot_user_id)), new Set([bot.id]));
});

test("a canonical persona lane resolves to the bot's DM, personas to their channel", () => {
  const lanes = collectBotPersonaLanes(
    [shortcut("chn_kai", "кай"), shortcut("chn_rec", "рекрутер")],
    bot.id,
    [bot],
  );
  const conversations: DirectConversation[] = [
    {
      id: "dm_kai",
      workspace_id: "wsp_1",
      created_at: "2026-01-01T00:00:00Z",
      members: [bot],
    },
  ];
  assert.deepEqual(profileHeaderTarget(lanes[0]!, [bot], conversations), {
    kind: "direct",
    id: "dm_kai",
  });
  assert.deepEqual(profileHeaderTarget(lanes[1]!, [bot], conversations), {
    kind: "channel",
    id: "chn_rec",
  });
  // Without a DM the canonical lane falls back to its own channel.
  assert.deepEqual(profileHeaderTarget(lanes[0]!, [bot], []), {
    kind: "channel",
    id: "chn_kai",
  });
});

test("persona lanes ignore other bots and an empty bot id", () => {
  const other: ChannelProfileShortcut = {
    ...shortcut("chn_other", "другой"),
    bot_user_id: "usr_other",
  };
  assert.deepEqual(
    collectBotPersonaLanes([shortcut("chn_liz", "лиза"), other], bot.id, [bot]).map(
      (lane) => lane.channel_id,
    ),
    ["chn_liz"],
  );
  assert.deepEqual(collectBotPersonaLanes([shortcut("chn_liz", "лиза")], "", [bot]), []);
});

test("a deleted bot has no canonical persona lane", () => {
  const lanes = collectBotPersonaLanes([shortcut("chn_kai", "кай")], bot.id, [
    { ...bot, deleted_at: "2026-01-02T00:00:00Z" },
  ]);
  assert.deepEqual(
    lanes.map((lane) => lane.is_canonical),
    [false],
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

test("the sidebar shelf can replace a recent person with a profile shortcut", () => {
  const people = [
    { ...bot, id: "usr_pi", display_name: "пи" },
    { ...bot, id: "usr_claw", display_name: "клешня" },
    { ...bot, id: "usr_nudz", display_name: "нудз" },
    { ...bot, id: "usr_kai", display_name: "кай" },
  ];
  const recruiter = shortcut("chn_career", "рекрутер");
  const shelf = collectSidebarPeopleShelf(
    people,
    [recruiter],
    [
      {
        personName: "нудз",
        profileName: "рекрутер",
      },
    ],
  );

  assert.deepEqual(
    shelf.map((entry) =>
      entry.kind === "person" ? entry.person.display_name : entry.profile.display_name,
    ),
    ["клешня", "рекрутер", "кай", "пи"],
  );
  assert.equal(shelf[1]?.kind, "profile");
  assert.equal(shelf[1]?.kind === "profile" ? shelf[1].profile.channel_id : "", "chn_career");
});

test("an explicit display order arranges the two-by-two shelf", () => {
  const people = [
    { ...bot, id: "usr_pi", display_name: "пи" },
    { ...bot, id: "usr_claw", display_name: "клешня" },
    { ...bot, id: "usr_nudz", display_name: "нудз" },
    { ...bot, id: "usr_kai", display_name: "кай" },
  ];
  const recruiter = shortcut("chn_career", "рекрутер");
  const lisa = shortcut("chn_liz", "лиза");

  const shelf = collectSidebarPeopleShelf(
    people,
    [recruiter, lisa],
    [
      { personName: "клешня", profileName: "лиза" },
      { personName: "нудз", profileName: "рекрутер" },
    ],
    ["кай", "лиза", "рекрутер", "пи"],
  );

  // Top row is the first two entries, bottom row the last two.
  assert.deepEqual(
    shelf.map((entry) =>
      entry.kind === "person" ? entry.person.display_name : entry.profile.display_name,
    ),
    ["кай", "лиза", "рекрутер", "пи"],
  );
  // The replaced profile keeps its channel target after reordering.
  const recruiterEntry = shelf[2];
  assert.equal(recruiterEntry?.kind, "profile");
  assert.equal(
    recruiterEntry?.kind === "profile" ? recruiterEntry.profile.channel_id : "",
    "chn_career",
  );
});

test("curated shelf entries win even when they are older than the shelf limit", () => {
  const people = [
    { ...bot, id: "usr_pi", display_name: "пи" },
    { ...bot, id: "usr_claw", display_name: "клешня" },
    { ...bot, id: "usr_kai", display_name: "кай" },
    { ...bot, id: "usr_other", display_name: "другой" },
    { ...bot, id: "usr_nudz", display_name: "нудз" },
    { ...bot, id: "usr_russian", display_name: "училка" },
  ];
  const lisa = shortcut("chn_liz", "лиза");

  const shelf = collectSidebarPeopleShelf(
    people,
    [lisa],
    [{ personName: "клешня", profileName: "лиза" }],
    ["кай", "лиза", "нудз", "училка"],
  );

  assert.deepEqual(
    shelf.map((entry) =>
      entry.kind === "person" ? entry.person.display_name : entry.profile.display_name,
    ),
    ["кай", "лиза", "нудз", "училка"],
  );
});

test("curated shelf entries stay stable when navigation changes recency", () => {
  const availablePeople = [
    { ...bot, id: "usr_pi", display_name: "пи" },
    { ...bot, id: "usr_claw", display_name: "клешня" },
    { ...bot, id: "usr_kai", display_name: "кай" },
    { ...bot, id: "usr_nudz", display_name: "нудз" },
    { ...bot, id: "usr_russian", display_name: "училка" },
  ];
  const lisa = shortcut("chn_liz", "лиза");
  const order = ["кай", "лиза", "нудз", "училка"];

  const shelf = collectSidebarPeopleShelf(
    availablePeople.slice(0, 3),
    [lisa],
    [{ personName: "клешня", profileName: "лиза" }],
    order,
    4,
    availablePeople,
  );

  assert.deepEqual(
    shelf.map((entry) =>
      entry.kind === "person" ? entry.person.display_name : entry.profile.display_name,
    ),
    order,
  );
});

test("curated shelf uses a matching profile when the person is unavailable", () => {
  const availablePeople = [
    { ...bot, id: "usr_pi", display_name: "пи" },
    { ...bot, id: "usr_claw", display_name: "клешня" },
    { ...bot, id: "usr_kai", display_name: "кай" },
    { ...bot, id: "usr_nudz", display_name: "нудз" },
  ];
  const profiles = [shortcut("chn_liz", "лиза"), shortcut("chn_teacher", "училка")];
  const order = ["кай", "лиза", "нудз", "училка"];

  const shelf = collectSidebarPeopleShelf(
    availablePeople,
    profiles,
    [{ personName: "клешня", profileName: "лиза" }],
    order,
    4,
    availablePeople,
  );

  assert.deepEqual(
    shelf.map((entry) =>
      entry.kind === "person" ? entry.person.display_name : entry.profile.display_name,
    ),
    order,
  );
  assert.equal(shelf[3]?.kind, "profile");
  assert.equal(shelf[3]?.kind === "profile" ? shelf[3].profile.channel_id : "", "chn_teacher");
});

test("builds a stable six-profile shelf and keeps пи as a profile", () => {
  const availablePeople = [
    { ...bot, id: "usr_pi", display_name: "пи" },
    { ...bot, id: "usr_claw", display_name: "клешня" },
    { ...bot, id: "usr_kai", display_name: "кай" },
    { ...bot, id: "usr_nudz", display_name: "нудз" },
  ];
  const profiles = [
    shortcut("chn_liz", "лиза"),
    shortcut("chn_teacher", "училка"),
    shortcut("chn_career", "рекрутер"),
    shortcut("chn_pi", "пи"),
  ];
  const order = ["кай", "лиза", "рекрутер", "нудз", "училка", "пи"];

  const shelf = collectSidebarPeopleShelf(
    availablePeople,
    profiles,
    [
      { personName: "клешня", profileName: "лиза" },
      { personName: "пи", profileName: "пи" },
    ],
    order,
    6,
    availablePeople,
  );

  assert.deepEqual(
    shelf.map((entry) =>
      entry.kind === "person" ? entry.person.display_name : entry.profile.display_name,
    ),
    order,
  );
  assert.equal(shelf[4]?.kind, "profile");
  assert.equal(shelf[5]?.kind, "profile");
});

test("profile groups follow the viewer channel order with пи pinned last", () => {
  const profiles = [
    shortcut("chn_career", "рекрутер"),
    shortcut("chn_kai", "кай"),
    shortcut("chn_pi", "пи"),
  ];
  const ordered = orderProfileShortcuts(profiles, ["chn_pi", "chn_career", "chn_kai"]);
  assert.deepEqual(
    ordered.map((profile) => profile.display_name),
    ["рекрутер", "кай", "пи"],
  );
});

test("profiles missing from the viewer order keep their relative tail position before пи", () => {
  const profiles = [
    shortcut("chn_career", "рекрутер"),
    shortcut("chn_kai", "кай"),
    shortcut("chn_pi", "пи"),
  ];
  const ordered = orderProfileShortcuts(profiles, ["chn_pi"]);
  assert.deepEqual(
    ordered.map((profile) => profile.display_name),
    ["рекрутер", "кай", "пи"],
  );
});

test("canonical profile avatars follow the current bot avatar", () => {
  const canonical = { ...shortcut("chn_kai", "кай"), avatar_url: "https://example.com/stale.webp" };
  const updatedBot = { ...bot, avatar_url: "https://example.com/current.webp" };
  assert.equal(profileAvatarURL(canonical, [updatedBot]), updatedBot.avatar_url);

  const persona = { ...canonical, display_name: "девушки" };
  assert.equal(profileAvatarURL(persona, [updatedBot]), persona.avatar_url);
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
