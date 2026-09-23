import assert from "node:assert/strict";
import test from "node:test";
import { channelTitleAvailable } from "./channels.ts";

test("channel rename checks visible titles within the workspace, excluding itself", () => {
  const channels = [
    { id: "one", name: "first", display_title: "Current name" },
    { id: "two", name: "second", display_title: undefined },
  ];
  assert.equal(channelTitleAvailable(channels, "one", " current NAME "), true);
  assert.equal(channelTitleAvailable(channels, "one", " SECOND "), false);
  assert.equal(channelTitleAvailable(channels, "one", "  "), false);
  assert.equal(channelTitleAvailable(channels, "one", "New name"), true);
});
