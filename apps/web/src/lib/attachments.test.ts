import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MESSAGE_ATTACHMENTS,
  appendPendingAttachments,
  mergeUploads,
  readyUploads,
  uploadsMissingAttachments,
  type PendingAttachment,
} from "./attachments.ts";
import type { Upload } from "./types.ts";

function file(name: string): File {
  return { name, size: 10, type: "text/plain" } as File;
}

function upload(id: string, filename = `${id}.txt`): Upload {
  return {
    id,
    workspace_id: "workspace-1",
    owner_id: "user-1",
    filename,
    content_type: "text/plain",
    byte_size: 10,
    created_at: "2026-01-01T00:00:00Z",
  };
}

test("appends multiple files in selection order with stable local keys", () => {
  let serial = 0;
  const result = appendPendingAttachments(
    [],
    [file("same.txt"), file("same.txt"), file("third.txt")],
    "workspace-1",
    () => `attachment-${++serial}`,
  );

  assert.equal(result.rejectedCount, 0);
  assert.deepEqual(
    result.attachments.map((attachment) => [attachment.key, attachment.file.name]),
    [
      ["attachment-1", "same.txt"],
      ["attachment-2", "same.txt"],
      ["attachment-3", "third.txt"],
    ],
  );
});

test("retains the existing queue and rejects files beyond the message limit", () => {
  const existing: PendingAttachment[] = Array.from(
    { length: MAX_MESSAGE_ATTACHMENTS - 1 },
    (_, index) => ({
      key: `existing-${index}`,
      file: file(`existing-${index}.txt`),
      workspaceID: "workspace-1",
      state: "uploading",
    }),
  );
  const result = appendPendingAttachments(
    existing,
    [file("accepted.txt"), file("rejected.txt")],
    "workspace-1",
    () => "accepted",
  );

  assert.equal(result.attachments.length, MAX_MESSAGE_ATTACHMENTS);
  assert.equal(result.attachments.at(-1)?.file.name, "accepted.txt");
  assert.equal(result.rejectedCount, 1);
});

test("collects ready uploads and merges server attachments without duplicates", () => {
  const first = upload("upload-1");
  const second = upload("upload-2");
  const pending: PendingAttachment[] = [
    {
      key: "first",
      file: file("first.txt"),
      workspaceID: "workspace-1",
      state: "ready",
      upload: first,
    },
    {
      key: "failed",
      file: file("failed.txt"),
      workspaceID: "workspace-1",
      state: "failed",
      error: "failed",
    },
    {
      key: "second",
      file: file("second.txt"),
      workspaceID: "workspace-1",
      state: "ready",
      upload: second,
    },
  ];

  assert.deepEqual(readyUploads(pending), [first, second]);
  assert.deepEqual(
    mergeUploads([first], [first, second]).map((candidate) => candidate.id),
    ["upload-1", "upload-2"],
  );
  assert.deepEqual(uploadsMissingAttachments([first, second], [first.id]), [second]);
});
