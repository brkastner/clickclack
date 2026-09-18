import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildHomePersonaGroups,
  buildHomeRecentItems,
  latestUsefulMessage,
  messagePreview,
  resolveHomePersona,
  type HomeRecentSource,
} from "./home-recent.ts";
import type { Message, User } from "./types.ts";

function user(id: string, kind: User["kind"] = "bot"): User {
  return {
    id,
    kind,
    display_name: id,
    handle: id,
    avatar_url: "",
    created_at: "2026-01-01T00:00:00Z",
  };
}

function message(id: string, createdAt: string, body = id, author = user("bot-a")): Message {
  return {
    id,
    workspace_id: "wsp-1",
    channel_id: "chn-1",
    author_id: author.id,
    thread_root_id: id,
    body,
    body_format: "markdown",
    created_at: createdAt,
    author,
  };
}

function source(id: string, messages: Message[]): HomeRecentSource {
  return {
    id,
    routeID: `route-${id}`,
    kind: "channel",
    title: `#${id}`,
    unreadCount: 0,
    messages,
  };
}

describe("Home recent-message projection", () => {
  it("orders conversations by their latest useful message with a stable tie-break", () => {
    const sameTime = "2026-09-17T12:00:00Z";
    const items = buildHomeRecentItems([
      source("b", [message("old", "2026-09-17T11:00:00Z")]),
      source("c", [message("c-new", sameTime)]),
      source("a", [message("a-new", sameTime)]),
    ], [user("bot-a")]);

    assert.deepEqual(items.map((item) => item.id), ["a", "c", "b"]);
  });

  it("groups recent conversations by persona and rolls up unread and working state", () => {
    const personaA = user("bot-a");
    const personaB = user("bot-b");
    const items = buildHomeRecentItems([
      source("alpha", [message("alpha-new", "2026-09-17T12:00:00Z", "alpha", personaA)]),
      { ...source("beta", [message("beta-new", "2026-09-17T11:00:00Z", "beta", personaA)]), unreadCount: 3 },
      source("gamma", [message("gamma-new", "2026-09-17T10:00:00Z", "gamma", personaB)]),
    ], [personaA, personaB]);

    const groups = buildHomePersonaGroups(items, new Set(["beta"]));

    assert.deepEqual(groups.map((group) => group.id), ["bot-a", "bot-b"]);
    assert.deepEqual(groups[0]?.items.map((item) => item.id), ["alpha", "beta"]);
    assert.equal(groups[0]?.unreadCount, 3);
    assert.equal(groups[0]?.working, true);
  });

  it("uses the message author persona before a deterministic assigned fallback", () => {
    const author = user("bot-z");
    const assignedA = user("bot-a");
    const assignedB = user("bot-b");
    const humanMessage = message("human", "2026-09-17T12:00:00Z", "hello", user("human", "human"));

    assert.equal(
      resolveHomePersona({ assignedBotIDs: [assignedB.id, assignedA.id] }, humanMessage, new Map([
        [assignedA.id, assignedA],
        [assignedB.id, assignedB],
      ]))?.id,
      assignedA.id,
    );
    assert.equal(
      resolveHomePersona({ assignedBotIDs: [assignedA.id] }, message("bot", "2026-09-17T12:00:00Z", "done", author), new Map([
        [assignedA.id, assignedA],
        [author.id, author],
      ]))?.id,
      author.id,
    );
  });

  it("skips deleted rows and turns markdown into a bounded plain-text preview", () => {
    const deleted = { ...message("deleted", "2026-09-17T12:01:00Z"), deleted_at: "2026-09-17T12:02:00Z" };
    const visible = message(
      "visible",
      "2026-09-17T12:00:00Z",
      "**Shipped** [the fix](https://example.com) with `tests` " + "x".repeat(200),
    );

    assert.equal(latestUsefulMessage([visible, deleted])?.id, visible.id);
    const preview = messagePreview(visible, 50);
    assert.match(preview, /^Shipped the fix with tests/u);
    assert.equal(Array.from(preview).length, 50);
    assert.ok(preview.endsWith("…"));
  });

  it("keeps an attachment-only conversation visible", () => {
    const attachment = {
      ...message("media", "2026-09-17T12:00:00Z", ""),
      attachments: [{
        id: "upl-1",
        workspace_id: "wsp-1",
        owner_id: "bot-a",
        filename: "image.png",
        content_type: "image/png",
        byte_size: 100,
        created_at: "2026-09-17T12:00:00Z",
      }],
    };

    assert.equal(messagePreview(attachment), "Shared an attachment");
    assert.equal(buildHomeRecentItems([source("media", [attachment])], [user("bot-a")]).length, 1);
  });
});
