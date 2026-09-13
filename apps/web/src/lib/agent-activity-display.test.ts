import assert from "node:assert/strict";
import test from "node:test";
import { coalesceAgentActivity } from "./chat/agent-activity.ts";
import type { Message } from "./types.ts";

const visible = { hideCommentary: false, hideToolCalls: false };
const now = Date.parse("2026-08-28T21:31:10.000Z");

// Expand compact tools back to source IDs to check chronology without depending
// on how many adjacent rows the presentation combines.
function sourceIDs(rows: Message[]): string[] {
  return rows.flatMap((row) =>
    row.preamble_block ? row.preamble_block.items.map((item) => item.id) : [row.id],
  );
}

for (const [label, interrupt] of [
  ["human message", { kind: "message", author_id: "usr_human" }],
  ["another bot", { author_id: "usr_other_bot" }],
  ["another turn", { turn_id: "turn_2" }],
  ["ordinary final answer", { kind: "message" }],
] as const) {
  test(`keeps activity around ${label} in supplied order`, () => {
    const rows = [
      message("msg_01", "**read**"),
      { ...message("msg_02", "interruption"), ...interrupt },
      message("msg_03", "**exec**"),
    ];
    const before = structuredClone(rows);
    const result = coalesceAgentActivity(rows, visible, now);
    assert.deepEqual(
      sourceIDs(result),
      rows.map((row) => row.id),
    );
    assert.equal(result.length, 3);
    assert.equal(result[0]?.preamble_block?.final, true);
    assert.equal(result[2]?.preamble_block?.final, label === "ordinary final answer");
    assert.deepEqual(rows, before);
  });
}

test("late commentary stays after the final answer and prior rows stay put", () => {
  const rows = [message("msg_01", "**read**"), message("msg_02", "done", "message")];
  const before = coalesceAgentActivity(rows, visible, now);
  const after = coalesceAgentActivity(
    [...rows, message("msg_03", " late narration ", "agent_commentary")],
    visible,
    now,
  );
  assert.deepEqual(after.slice(0, 2), before);
  assert.equal(after[2]?.body, "late narration");
});

test("visibility flags never combine tools across hidden commentary or ordinary rows", () => {
  const rows = [
    message("msg_01", "**read**"),
    message("msg_02", "narration", "agent_commentary"),
    message("msg_03", "**exec**"),
    { ...message("msg_04", "human", "message"), author_id: "usr_human" },
    message("msg_05", "**grep**"),
  ];
  for (const hideCommentary of [false, true]) {
    for (const hideToolCalls of [false, true]) {
      const result = coalesceAgentActivity(rows, { hideCommentary, hideToolCalls }, now);
      assert.deepEqual(
        sourceIDs(result),
        rows
          .filter(
            (row) =>
              !(hideCommentary && row.kind === "agent_commentary") &&
              !(hideToolCalls && row.kind === "agent_tool"),
          )
          .map((row) => row.id),
      );
    }
  }
});

for (const [label, scope] of [
  ["author", { author_id: "usr_other" }],
  ["channel", { channel_id: "chn_2" }],
  ["direct conversation", { channel_id: undefined, direct_conversation_id: "dm_2" }],
  ["missing turn", { turn_id: undefined }],
] as const) {
  test(`does not combine tools across ${label} boundaries`, () => {
    const rows = [message("msg_01", "**read**"), { ...message("msg_02", "**read**"), ...scope }];
    if (label === "missing turn") rows[0].turn_id = undefined;
    const result = coalesceAgentActivity(rows, visible, now);
    assert.deepEqual(sourceIDs(result), ["msg_01", "msg_02"]);
    assert.equal(result.length, 2);
  });
}

test("supplied order wins over timestamps and stale trailing tools stay final", () => {
  const rows = [message("msg_02", "narration", "agent_commentary"), message("msg_01", "**read**")];
  const result = coalesceAgentActivity(rows, visible, now + 180_000);
  assert.deepEqual(sourceIDs(result), ["msg_02", "msg_01"]);
  assert.equal(result[1]?.preamble_block?.final, true);
});

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
