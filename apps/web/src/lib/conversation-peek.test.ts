import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyPeekMessage,
  conversationPeekPath,
  conversationReadPath,
  foldPeekPage,
  mergePeekMessages,
  peekReadThroughSeq,
} from "./conversation-peek.ts";
import type { Message, MessagePage } from "./types.ts";

function message(id: string, seq: number, createdAt = "2026-01-01T00:00:00Z"): Message {
  return {
    id,
    workspace_id: "wsp-1",
    channel_id: "chn-1",
    author_id: "usr-1",
    thread_root_id: id,
    channel_seq: seq,
    body: id,
    body_format: "markdown",
    created_at: createdAt,
  };
}

function page(messages: Message[], overrides: Partial<MessagePage> = {}): MessagePage {
  const seqs = messages.map((entry) => entry.channel_seq ?? 0);
  return {
    messages,
    oldest_seq: seqs.length ? Math.min(...seqs) : 0,
    newest_seq: seqs.length ? Math.max(...seqs) : 0,
    has_older: false,
    has_newer: false,
    ...overrides,
  };
}

describe("conversation peek paths", () => {
  it("builds channel and direct message paths", () => {
    assert.equal(
      conversationPeekPath("channel", "chn 1", "mode=latest"),
      "/api/channels/chn%201/messages?mode=latest",
    );
    assert.equal(conversationPeekPath("direct", "dm-1", ""), "/api/dms/dm-1/messages");
    assert.equal(conversationReadPath("direct", "dm-1"), "/api/dms/dm-1/read");
    assert.equal(conversationReadPath("channel", "chn-1"), "/api/channels/chn-1/read");
  });
});

describe("mergePeekMessages", () => {
  it("dedupes by id, prefers the later copy, and orders by sequence", () => {
    const merged = mergePeekMessages(
      [message("m-2", 2), message("m-1", 1)],
      [{ ...message("m-2", 2), body: "edited" }, message("m-3", 3)],
    );
    assert.deepEqual(
      merged.map((entry) => entry.id),
      ["m-1", "m-2", "m-3"],
    );
    assert.equal(merged[1].body, "edited");
  });

  it("falls back to timestamp when sequences are missing", () => {
    const first: Message = { ...message("m-a", 0, "2026-01-01T00:00:01Z"), channel_seq: undefined };
    const second: Message = {
      ...message("m-b", 0, "2026-01-01T00:00:00Z"),
      channel_seq: undefined,
    };
    assert.deepEqual(
      mergePeekMessages([first, second]).map((entry) => entry.id),
      ["m-b", "m-a"],
    );
  });
});

describe("foldPeekPage", () => {
  it("replaces the window when there is nothing to fold into", () => {
    const incoming = page([message("m-1", 1)]);
    assert.equal(foldPeekPage(undefined, incoming, "older"), incoming);
    assert.equal(foldPeekPage(page([message("m-9", 9)]), incoming, "replace"), incoming);
  });

  it("extends backwards for older pages and keeps the newest edge", () => {
    const current = page([message("m-5", 5)], { has_older: true, has_newer: false });
    const older = page([message("m-3", 3), message("m-4", 4)], { has_older: false });
    const folded = foldPeekPage(current, older, "older");
    assert.deepEqual(
      folded.messages.map((entry) => entry.id),
      ["m-3", "m-4", "m-5"],
    );
    assert.equal(folded.oldest_seq, 3);
    assert.equal(folded.newest_seq, 5);
    assert.equal(folded.has_older, false);
    assert.equal(folded.has_newer, false);
  });

  it("advances the newest edge for newer pages", () => {
    const current = page([message("m-1", 1)], { has_older: true, has_newer: true });
    const newer = page([message("m-2", 2)], { has_newer: false });
    const folded = foldPeekPage(current, newer, "newer");
    assert.deepEqual(
      folded.messages.map((entry) => entry.id),
      ["m-1", "m-2"],
    );
    assert.equal(folded.oldest_seq, 1);
    assert.equal(folded.newest_seq, 2);
    assert.equal(folded.has_older, true);
    assert.equal(folded.has_newer, false);
  });
});

describe("applyPeekMessage", () => {
  it("appends a sent message and advances the newest sequence", () => {
    const applied = applyPeekMessage(page([message("m-1", 1)]), message("m-2", 2));
    assert.deepEqual(
      applied.messages.map((entry) => entry.id),
      ["m-1", "m-2"],
    );
    assert.equal(applied.newest_seq, 2);
  });

  it("replaces an echoed message instead of duplicating it", () => {
    const applied = applyPeekMessage(page([message("m-1", 1)]), {
      ...message("m-1", 1),
      body: "final",
    });
    assert.equal(applied.messages.length, 1);
    assert.equal(applied.messages[0].body, "final");
  });
});

describe("peekReadThroughSeq", () => {
  it("returns zero without a window and the highest sequence otherwise", () => {
    assert.equal(peekReadThroughSeq(undefined), 0);
    assert.equal(peekReadThroughSeq(page([message("m-1", 1), message("m-7", 7)])), 7);
  });
});
