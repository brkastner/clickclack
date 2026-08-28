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
