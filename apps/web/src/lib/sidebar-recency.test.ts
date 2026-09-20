import assert from "node:assert/strict";
import { test } from "node:test";
import { channelsByRecency, personaActivityTime } from "./sidebar-recency.ts";
import type { Channel } from "./types";
const channel = (id: string, time: string, persona = "alpha", archived = false) =>
  ({
    id,
    last_message_at: time,
    last_seq: id === "old" ? 999 : 1,
    bot_assignments: [{ bot_user_id: persona }],
    archived_at: archived ? "2026-01-01" : undefined,
  }) as Channel;
test("channel recency uses timestamps, not message counts, with stable empty ties", () => {
  const rows = [
    channel("old", "2026-01-01"),
    channel("empty", ""),
    channel("new", "2026-09-01"),
    channel("bad", "bad"),
  ];
  assert.deepEqual(
    channelsByRecency(rows).map((c) => c.id),
    ["new", "old", "empty", "bad"],
  );
  assert.equal(rows[0].id, "old");
});
test("persona recency uses only assigned active channels", () => {
  const rows = [
    channel("old", "2026-01-01"),
    channel("new", "2026-09-01", "beta"),
    channel("archived", "2026-10-01", "alpha", true),
  ];
  assert.ok(personaActivityTime(rows, "beta") > personaActivityTime(rows, "alpha"));
  assert.equal(personaActivityTime(rows, "empty"), 0);
});
