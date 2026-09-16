import assert from "node:assert/strict";
import test from "node:test";

import { readGitActivity, stripGitActivityBlock } from "./chat/git-activity.ts";
import type { Message } from "./types.ts";

const payload = {
  v: 1,
  action: "commit",
  outcome: "succeeded",
  repository: { name: "clickclack", url: "https://github.com/example/clickclack" },
  branch: "kas/main",
  commit: {
    sha: "0123456789abcdef",
    subject: "add git activity cards",
    url: "https://github.com/example/clickclack/commit/0123456789abcdef",
  },
  project: "clickclack",
  session: { id: "session_1", turnId: "turn_1" },
  occurredAt: "2026-03-20T12:00:00.000Z",
};

function message(body: string, kind: Message["kind"] = "message"): Message {
  return {
    id: "msg_1",
    workspace_id: "wsp_1",
    channel_id: "chn_git",
    author_id: "usr_bot",
    author: {
      id: "usr_bot",
      display_name: "pi",
      handle: "pi",
      kind: "bot",
      created_at: "2026-03-20T12:00:00.000Z",
    },
    body,
    kind,
    created_at: "2026-03-20T12:00:00.000Z",
  };
}

test("reads a versioned git activity block from a bot channel post", () => {
  const body = `**git commit succeeded**\n\n\`\`\`clickclack-git-activity\n${JSON.stringify(payload)}\n\`\`\``;
  assert.deepEqual(readGitActivity(message(body)), payload);
  assert.equal(stripGitActivityBlock(body), "**git commit succeeded**");
});

test("ignores malformed, unsafe, human, and agent-tool activity", () => {
  const validBody = `\`\`\`clickclack-git-activity\n${JSON.stringify(payload)}\n\`\`\``;
  assert.equal(
    readGitActivity({
      ...message(validBody),
      author: { ...message(validBody).author!, kind: "human" },
    }),
    null,
  );
  assert.equal(readGitActivity(message(validBody, "agent_tool")), null);
  assert.equal(readGitActivity(message("```clickclack-git-activity\n{}\n```")), null);
  assert.equal(
    readGitActivity(
      message(
        `\`\`\`clickclack-git-activity\n${JSON.stringify({ ...payload, repository: { name: "x", url: "javascript:alert(1)" } })}\n\`\`\``,
      ),
    ),
    null,
  );
});
