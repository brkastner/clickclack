import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTangentMessage,
  isTangentShortcut,
  parseTangentEndReason,
  tangentAgentCandidates,
  type TangentMessage,
} from "./tangent.ts";
import type { Channel, DirectConversation, User } from "./types.ts";

const person = (id: string, kind: User["kind"] = "human", extra: Partial<User> = {}): User => ({
  id,
  kind,
  display_name: id,
  handle: id,
  avatar_url: "",
  created_at: "2026-01-01T00:00:00Z",
  ...extra,
});

test("DM candidates are its live bot members, never the viewer", () => {
  const direct = {
    id: "dm_1",
    members: [
      person("me"),
      person("kai", "bot"),
      person("gone", "bot", { deleted_at: "x" }),
      person("pal"),
    ],
  } as DirectConversation;
  const bots = tangentAgentCandidates({ direct, currentUserID: "me", lookupUser: () => undefined });
  assert.deepEqual(
    bots.map((bot) => bot.id),
    ["kai"],
  );
});

test("channel candidates are its assigned bots, in assignment order, deduplicated", () => {
  const users = new Map([
    ["kai", person("kai", "bot")],
    ["main", person("main", "bot")],
    ["human", person("human")],
  ]);
  const channel = {
    id: "chn_1",
    bot_assignments: [
      { channel_id: "chn_1", bot_user_id: "main" },
      { channel_id: "chn_1", bot_user_id: "kai" },
      { channel_id: "chn_1", bot_user_id: "main" },
      { channel_id: "chn_1", bot_user_id: "human" },
      { channel_id: "chn_1", bot_user_id: "unknown" },
    ],
  } as Channel;
  const bots = tangentAgentCandidates({
    channel,
    currentUserID: "me",
    lookupUser: (id) => users.get(id),
  });
  assert.deepEqual(
    bots.map((bot) => bot.id),
    ["main", "kai"],
  );
});

test("a channel without assigned bots offers no tangent", () => {
  const channel = { id: "chn_1" } as Channel;
  assert.deepEqual(
    tangentAgentCandidates({ channel, currentUserID: "me", lookupUser: () => undefined }),
    [],
  );
});

test("Ctrl+L opens tangents, Cmd+L on macOS, and modified chords are left alone", () => {
  const key = (overrides: Partial<Parameters<typeof isTangentShortcut>[0]>) => ({
    key: "l",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  });
  assert.equal(isTangentShortcut(key({ ctrlKey: true }), false), true);
  assert.equal(isTangentShortcut(key({ ctrlKey: true, key: "L" }), false), true);
  assert.equal(isTangentShortcut(key({ metaKey: true }), true), true);
  assert.equal(isTangentShortcut(key({ ctrlKey: true }), true), false);
  assert.equal(isTangentShortcut(key({ metaKey: true }), false), false);
  assert.equal(isTangentShortcut(key({ ctrlKey: true, shiftKey: true }), false), false);
  assert.equal(isTangentShortcut(key({ ctrlKey: true, altKey: true }), false), false);
  assert.equal(isTangentShortcut(key({ ctrlKey: true, isComposing: true }), false), false);
  assert.equal(isTangentShortcut(key({ ctrlKey: true, key: "k" }), false), false);
});

const message = (id: string, extra: Partial<TangentMessage> = {}): TangentMessage => ({
  id,
  tangent_id: "tng_1",
  author_id: "me",
  body: id,
  created_at: "2026-01-01T00:00:00Z",
  ...extra,
});

test("a confirmed send replaces its optimistic row in place", () => {
  const list = [
    message("local:c1", { client_id: "c1", pending: true }),
    message("tgm_bot", { author_id: "kai" }),
  ];
  const next = applyTangentMessage(list, message("tgm_1", { client_id: "c1" }));
  assert.deepEqual(
    next.map((row) => [row.id, Boolean(row.pending)]),
    [
      ["tgm_1", false],
      ["tgm_bot", false],
    ],
  );
});

test("the realtime echo of a message already applied is ignored", () => {
  const list = [message("tgm_1", { client_id: "c1" })];
  assert.equal(applyTangentMessage(list, message("tgm_1", { client_id: "c1" })), list);
});

test("a confirmed row is never overwritten by a later message reusing its client id", () => {
  const list = [message("tgm_1", { client_id: "c1" })];
  const next = applyTangentMessage(list, message("tgm_2", { client_id: "c1" }));
  assert.deepEqual(
    next.map((row) => row.id),
    ["tgm_1", "tgm_2"],
  );
});

test("bot replies append", () => {
  const next = applyTangentMessage([message("tgm_1")], message("tgm_2", { author_id: "kai" }));
  assert.deepEqual(
    next.map((row) => row.id),
    ["tgm_1", "tgm_2"],
  );
});

test("unknown close reasons read as expired", () => {
  assert.equal(parseTangentEndReason("closed"), "closed");
  assert.equal(parseTangentEndReason("replaced"), "replaced");
  assert.equal(parseTangentEndReason("access_lost"), "access_lost");
  assert.equal(parseTangentEndReason("anything"), "expired");
  assert.equal(parseTangentEndReason(undefined), "expired");
});
