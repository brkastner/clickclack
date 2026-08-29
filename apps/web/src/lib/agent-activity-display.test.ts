import assert from "node:assert/strict";
import test from "node:test";
import { coalesceAgentActivity } from "./chat/agent-activity.ts";
import type { Message } from "./types.ts";

function message(id: string, body: string, kind: Message["kind"] = "agent_tool"): Message {
  return {
    id,
    workspace_id: "wsp_1",
    channel_id: "chn_1",
    author_id: "usr_agent",
    thread_root_id: id,
    body,
    body_format: "markdown",
    created_at: `2026-08-28T21:31:${id.slice(-2)}.000Z`,
    kind,
    turn_id: "turn_1",
  };
}

test("turns OpenClaw tool receipts into compact semantic activity", () => {
  const rows = [
    message("msg_01", "🛠️ Exec"),
    message("msg_02", "🛠️ Exec"),
    message("msg_03", "🛠️ Exec"),
    message("msg_04", "📖 Read: from /tmp/config.json"),
    message("msg_05", "🧰 Process: amber-fjord"),
    message("msg_06", "finished", "message"),
  ];

  const result = coalesceAgentActivity(rows, {
    hideCommentary: false,
    hideToolCalls: false,
  });
  const items = result[0]?.preamble_block?.items;

  assert.deepEqual(items, [
    {
      type: "tool",
      id: "msg_01",
      name: "exec",
      full: "🛠️ Exec",
      count: 3,
      expandable: false,
    },
    {
      type: "tool",
      id: "msg_04",
      name: "read",
      detail: "from /tmp/config.json",
      full: "📖 Read: from /tmp/config.json",
      count: 1,
      expandable: false,
    },
    {
      type: "tool",
      id: "msg_05",
      name: "process",
      detail: "amber-fjord",
      full: "🧰 Process: amber-fjord",
      count: 1,
      expandable: false,
    },
  ]);
});

test("keeps real tool output expandable", () => {
  const rows = [
    message("msg_01", "**exec run checks**\n\nvalidated local target"),
    message("msg_02", "finished", "message"),
  ];

  const [activity] = coalesceAgentActivity(rows, {
    hideCommentary: false,
    hideToolCalls: false,
  });

  assert.deepEqual(activity.preamble_block?.items[0], {
    type: "tool",
    id: "msg_01",
    name: "exec",
    detail: "run checks · validated local target",
    full: "**exec run checks**\n\nvalidated local target",
    count: 1,
    expandable: true,
  });
});

test("renders commentary between tools as normal text and starts a new tool block", () => {
  const rows = [
    message("msg_01", "I'll inspect the sidebar.", "agent_commentary"),
    message("msg_02", "**read**\n\nSidebar.svelte"),
    message("msg_03", "**grep**\n\nchannel order"),
    message("msg_04", "The order is stored in the channel list.", "agent_commentary"),
    message("msg_05", "**edit**\n\nChannelList.svelte"),
    message("msg_06", "done", "message"),
  ];

  const result = coalesceAgentActivity(rows, {
    hideCommentary: false,
    hideToolCalls: false,
  });

  assert.equal(result.length, 5);
  assert.equal(result[0]?.body, "I'll inspect the sidebar.");
  assert.equal(result[0]?.preamble_block, undefined);
  assert.deepEqual(
    result[1]?.preamble_block?.items.map((item) => item.id),
    ["msg_02", "msg_03"],
  );
  assert.equal(result[1]?.preamble_block?.final, true);
  assert.equal(result[2]?.body, "The order is stored in the channel list.");
  assert.equal(result[2]?.preamble_block, undefined);
  assert.deepEqual(
    result[3]?.preamble_block?.items.map((item) => item.id),
    ["msg_05"],
  );
  assert.equal(result[3]?.preamble_block?.final, true);
  assert.equal(result[4]?.body, "done");
});

test("keeps only the trailing tool block live while a turn is running", () => {
  const rows = [
    message("msg_01", "**read**\n\nfirst.ts"),
    message("msg_02", "I found the next seam.", "agent_commentary"),
    message("msg_03", "**read**\n\nsecond.ts"),
  ];

  const result = coalesceAgentActivity(
    rows,
    {
      hideCommentary: false,
      hideToolCalls: false,
    },
    Date.parse("2026-08-28T21:31:04.000Z"),
  );

  assert.equal(result[0]?.preamble_block?.final, true);
  assert.equal(result[1]?.body, "I found the next seam.");
  assert.equal(result[2]?.preamble_block?.final, false);
});

test("hidden commentary still separates collapsible tool groups", () => {
  const rows = [
    message("msg_01", "**read**\n\nfirst.ts"),
    message("msg_02", "I found the next seam.", "agent_commentary"),
    message("msg_03", "**read**\n\nsecond.ts"),
  ];

  const result = coalesceAgentActivity(
    rows,
    {
      hideCommentary: true,
      hideToolCalls: false,
    },
    Date.parse("2026-08-28T21:31:04.000Z"),
  );

  assert.equal(result.length, 2);
  assert.equal(result[0]?.preamble_block?.final, true);
  assert.equal(result[1]?.preamble_block?.final, false);
});
