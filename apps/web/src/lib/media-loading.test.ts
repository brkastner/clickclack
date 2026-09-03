import assert from "node:assert/strict";
import test from "node:test";

import { recentAutoLoadAttachmentIDs } from "./media-loading.ts";
import type { Message, Upload } from "./types.ts";

function upload(id: string, createdAt: string, contentType = "image/png"): Upload {
  return {
    id,
    workspace_id: "workspace-1",
    owner_id: "user-1",
    filename: `${id}.png`,
    content_type: contentType,
    byte_size: 1,
    created_at: createdAt,
  };
}

function message(id: string, attachments: Upload[] = [], deleted = false): Message {
  return {
    id,
    workspace_id: "workspace-1",
    author_id: "user-1",
    thread_root_id: id,
    body: "",
    body_format: "markdown",
    created_at: "2026-09-02T00:00:00Z",
    attachments,
    deleted_at: deleted ? "2026-09-02T00:01:00Z" : undefined,
  };
}

test("recentAutoLoadAttachmentIDs returns previewable attachments from newest to oldest", () => {
  assert.deepEqual(
    [
      ...recentAutoLoadAttachmentIDs([
        message("older", [upload("old-image", "2026-09-02T00:00:00Z")]),
        message("newer", [
          upload("new-image", "2026-09-02T00:02:00Z"),
          upload("older-video", "2026-09-02T00:01:00Z", "video/mp4"),
        ]),
      ]),
    ],
    ["new-image", "older-video", "old-image"],
  );
});

test("recentAutoLoadAttachmentIDs orders RFC3339Nano timestamps chronologically", () => {
  assert.deepEqual(
    [
      ...recentAutoLoadAttachmentIDs([
        message("same-second", [
          upload("fraction-120ms", "2026-09-02T00:00:00.12Z"),
          upload("fraction-123ms", "2026-09-02T00:00:00.123Z"),
          upload("fraction-123400us-first", "2026-09-02T00:00:00.1234Z"),
          upload("fraction-123400us-last", "2026-09-02T00:00:00.1234Z"),
        ]),
      ]),
    ],
    ["fraction-123400us-last", "fraction-123400us-first", "fraction-123ms", "fraction-120ms"],
  );
});

test("recentAutoLoadAttachmentIDs follows attachments added to older messages", () => {
  assert.deepEqual(
    [
      ...recentAutoLoadAttachmentIDs([
        message("older-message", [upload("late-image", "2026-09-02T00:03:00Z")]),
        message("newer-message", [upload("earlier-image", "2026-09-02T00:02:00Z")]),
      ]),
    ],
    ["late-image", "earlier-image"],
  );
});

test("recentAutoLoadAttachmentIDs limits automatic previews to the ten newest attachments", () => {
  const attachments = Array.from({ length: 12 }, (_, index) =>
    upload(`image-${index}`, `2026-09-02T00:00:${String(index).padStart(2, "0")}Z`),
  );

  assert.deepEqual(
    [...recentAutoLoadAttachmentIDs([message("gallery", attachments)])],
    Array.from({ length: 10 }, (_, index) => `image-${11 - index}`),
  );
});

test("recentAutoLoadAttachmentIDs ignores deleted messages and demand-loaded files", () => {
  assert.deepEqual(
    [
      ...recentAutoLoadAttachmentIDs([
        message("visible", [upload("visible-image", "2026-09-02T00:00:00Z")]),
        message("document", [upload("report", "2026-09-02T00:02:00Z", "application/pdf")]),
        message("deleted", [upload("deleted-image", "2026-09-02T00:03:00Z")], true),
      ]),
    ],
    ["visible-image"],
  );
  assert.deepEqual([...recentAutoLoadAttachmentIDs([message("empty")])], []);
});
