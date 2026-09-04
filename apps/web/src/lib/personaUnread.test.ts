import assert from "node:assert/strict";
import test from "node:test";

import { personaUnreadSummary } from "./personaUnread.ts";

test("persona unread summary stacks direct and assigned-channel activity", () => {
  assert.deepEqual(
    personaUnreadSummary({ id: "dm-1", unread_count: 2 }, [
      { id: "channel-1", unread_count: 3 },
      { id: "channel-2", unread_count: 4 },
    ]),
    { direct: 2, channels: 7, total: 9 },
  );
});

test("persona unread summary excludes the conversations currently being read", () => {
  assert.deepEqual(
    personaUnreadSummary(
      { id: "dm-1", unread_count: 2 },
      [
        { id: "channel-1", unread_count: 3 },
        { id: "channel-2", unread_count: 4 },
      ],
      "dm-1",
      "channel-2",
    ),
    { direct: 0, channels: 3, total: 3 },
  );
});

test("persona unread summary normalizes absent or invalid counts", () => {
  assert.deepEqual(
    personaUnreadSummary({ id: "dm-1", unread_count: -2 }, [
      { id: "channel-1" },
      { id: "channel-2", unread_count: Number.NaN },
    ]),
    { direct: 0, channels: 0, total: 0 },
  );
});
