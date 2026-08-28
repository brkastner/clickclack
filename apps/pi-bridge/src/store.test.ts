import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BridgeStore } from "./store.js";

test("persists cursors and atomically rejects duplicate source claims", () => {
  const directory = mkdtempSync(join(tmpdir(), "clickclack-pi-bridge-"));
  const path = join(directory, "state.db");
  try {
    const first = new BridgeStore(path);
    first.commitCursor("wrk_test", "cursor-1");
    assert.equal(first.claimSource("msg_1", "cursor-1"), true);
    assert.equal(first.claimSource("msg_1", "cursor-1"), false);
    first.close();

    const reopened = new BridgeStore(path);
    assert.equal(reopened.getCursor("wrk_test"), "cursor-1");
    assert.equal(reopened.claimSource("msg_1", "cursor-2"), false);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rolls back failed transactions", () => {
  const directory = mkdtempSync(join(tmpdir(), "clickclack-pi-bridge-"));
  const store = new BridgeStore(join(directory, "state.db"));
  try {
    assert.throws(() =>
      store.transaction(() => {
        store.commitCursor("wrk_test", "cursor-lost");
        throw new Error("fail");
      }),
    );
    assert.equal(store.getCursor("wrk_test"), undefined);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
