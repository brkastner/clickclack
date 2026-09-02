import assert from "node:assert/strict";
import test from "node:test";

import { newestAutoLoadAttachmentID } from "./media-loading.ts";
import type { Message, Upload } from "./types.ts";

function upload(
  id: string,
  createdAt: string,
  contentType = "image/png",
): Upload {
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

test("newestAutoLoadAttachmentID chooses exactly the newest binary attachment", () => {
  assert.equal(
    newestAutoLoadAttachmentID([
      message("older", [upload("old-image", "2026-09-02T00:00:00Z")]),
      message("newer", [
        upload("new-image", "2026-09-02T00:02:00Z"),
        upload("older-video", "2026-09-02T00:01:00Z", "video/mp4"),
      ]),
    ]),
    "new-image",
  );
});

test("newestAutoLoadAttachmentID follows attachments added to older messages", () => {
  assert.equal(
    newestAutoLoadAttachmentID([
      message("older-message", [upload("late-image", "2026-09-02T00:03:00Z")]),
      message("newer-message", [upload("earlier-image", "2026-09-02T00:02:00Z")]),
    ]),
    "late-image",
  );
});

test("newestAutoLoadAttachmentID ignores deleted messages and demand-loaded files", () => {
  assert.equal(
    newestAutoLoadAttachmentID([
      message("visible", [upload("visible-image", "2026-09-02T00:00:00Z")]),
      message("document", [upload("report", "2026-09-02T00:02:00Z", "application/pdf")]),
      message("deleted", [upload("deleted-image", "2026-09-02T00:03:00Z")], true),
    ]),
    "visible-image",
  );
  assert.equal(newestAutoLoadAttachmentID([message("empty")]), undefined);
});
