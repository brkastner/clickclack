import assert from "node:assert/strict";
import test from "node:test";
import { tangentContextKey, tangentSourceKey } from "./tangent-context.ts";

test("tangents belong to a workspace, conversation and bot, not a display label", () => {
  const source = { workspaceID: "w", channelID: "matchfi", label: "#matchfi" };
  const key = tangentContextKey(source, "matchfi");
  assert.equal(tangentContextKey({ ...source, label: "renamed" }, "matchfi"), key);
  assert.notEqual(tangentContextKey(source, "clickclack"), key);
  assert.notEqual(tangentContextKey({ ...source, channelID: "clickclack" }, "matchfi"), key);
  assert.notEqual(tangentContextKey({ ...source, workspaceID: "other" }, "matchfi"), key);
  assert.notEqual(
    tangentContextKey({ workspaceID: "w", directID: "matchfi", label: "matchfi" }, "matchfi"),
    key,
  );
  assert.equal(tangentSourceKey(null), "");
});
