import assert from "node:assert/strict";
import { test } from "node:test";
import { createNotepadAvailability } from "./chat/notepad-availability.ts";
import { watchNotepad, type NotepadSocket, type NotepadSnapshot } from "./chat/notepad.ts";
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
function fixture() {
  const sockets: NotepadSocket[] = [];
  const reads: { path: string; signal: AbortSignal; resolve: (value: NotepadSnapshot) => void }[] =
    [];
  const snapshots: NotepadSnapshot[] = [];
  let closed = 0;
  const deps = {
    retryMs: 5,
    connect: () => {
      const socket: NotepadSocket = {
        close: () => {
          closed++;
        },
        onmessage: null,
        onclose: null,
        onerror: null,
      };
      sockets.push(socket);
      return socket;
    },
    read: (path: string, signal: AbortSignal) =>
      new Promise<NotepadSnapshot>((resolve) => reads.push({ path, signal, resolve })),
  };
  const notify = (state = "ready", socket = sockets.at(-1)!) =>
    socket.onmessage?.call(
      socket as WebSocket,
      new MessageEvent("message", { data: JSON.stringify({ type: "notepad.changed", state }) }),
    );
  return {
    deps,
    sockets,
    reads,
    snapshots,
    notify,
    closed: () => closed,
    start: (path: string) => watchNotepad(path, deps, (s) => snapshots.push(s)),
  };
}
const card = (markdown: string, revision = 1): NotepadSnapshot => ({
  state: "ready",
  card: { markdown, revision, updatedAt: 1 },
});
test("notepad availability only exposes bound conversations and rejects late responses", async () => {
  const reads: {
    path: string;
    signal: AbortSignal;
    resolve: (value: { available: boolean }) => void;
  }[] = [];
  const visible: boolean[] = [];
  const availability = createNotepadAvailability(
    {
      read: (path, signal) => new Promise((resolve) => reads.push({ path, signal, resolve })),
    },
    (available) => visible.push(available),
  );
  availability.select("/api/channels/bound/notepad/availability");
  availability.select("/api/channels/unbound/notepad/availability");
  reads[0].resolve({ available: true });
  reads[1].resolve({ available: false });
  await tick();
  assert.equal(reads[0].signal.aborted, true);
  assert.equal(visible.at(-1), false);
  availability.select(null); // Pi-only conversations have no server binding path.
  assert.equal(visible.at(-1), false);
  assert.equal(reads.length, 2);
  availability.dispose();
});

test("notepad fences switches and disposed requests", async () => {
  const f = fixture();
  const stopA = f.start("/a");
  f.notify();
  await tick();
  stopA();
  const stopB = f.start("/b");
  f.notify();
  await tick();
  f.reads[0].resolve(card("secret a"));
  f.reads[1].resolve(card("b"));
  await tick();
  assert.equal(f.snapshots.at(-1)?.card?.markdown, "b");
  assert(!f.snapshots.some((s) => s.card?.markdown === "secret a"));
  assert(f.reads[0].signal.aborted);
  stopB();
  assert.equal(f.closed(), 2);
});
test("notepad coalesces invalidations, rejects in-flight stale response, and clears remotely", async () => {
  const f = fixture();
  const stop = f.start("/a");
  f.notify();
  f.notify();
  f.notify();
  await tick();
  assert.equal(f.reads.length, 1);
  f.notify();
  f.notify();
  f.reads[0].resolve(card("stale", 1));
  await tick();
  assert.equal(f.reads.length, 2);
  assert(!f.snapshots.some((s) => s.card?.markdown === "stale"));
  f.reads[1].resolve(card("new", 3));
  await tick();
  assert.equal(f.snapshots.at(-1)?.card?.revision, 3);
  f.notify();
  await tick();
  f.reads[2].resolve({ state: "ready", card: null });
  await tick();
  assert.deepEqual(f.snapshots.at(-1), { state: "ready", card: null });
  stop();
});
test("notepad reconnect refetches and ignores old responses", async () => {
  const f = fixture();
  const stop = f.start("/a");
  f.notify();
  await tick();
  const old = f.sockets[0];
  old.onerror?.call(old as WebSocket, new Event("error"));
  assert.equal(f.snapshots.at(-1)?.state, "disconnected");
  await tick();
  assert.equal(f.sockets.length, 2);
  f.notify();
  await tick();
  f.reads[0].resolve(card("old"));
  f.reads.at(-1)!.resolve({ state: "ready", card: null });
  await tick();
  assert.equal(f.snapshots.at(-1)?.card, null);
  assert(!f.snapshots.some((s) => s.card?.markdown === "old"));
  stop();
});
test("notepad preserves authoritative HTTP unavailable while retrying", async () => {
  const f = fixture();
  const stop = f.start("/a");
  f.notify();
  await tick();
  f.reads[0].resolve({
    state: "unavailable",
    card: { markdown: "stale", revision: 1, updatedAt: 1 },
  });
  await tick();
  assert(
    f.snapshots.some((snapshot) => snapshot.state === "unavailable" && snapshot.card === null),
  );
  await tick();
  assert.equal(f.sockets.length, 2);
  stop();
});
test("notepad preserves authoritative WebSocket unavailable while retrying", async () => {
  const f = fixture();
  const stop = f.start("/a");
  f.notify("unavailable");
  assert.deepEqual(f.snapshots.at(-1), { state: "unavailable", card: null });
  await tick();
  assert.equal(f.sockets.length, 2);
  stop();
});
test("notepad unsupported and denied stop observation without retaining content", async () => {
  for (const state of ["unsupported", "unmapped", "denied"]) {
    const f = fixture();
    const stop = f.start("/a");
    f.notify(state);
    await tick();
    assert.equal(f.snapshots.at(-1)?.state, state);
    assert.equal(f.reads.length, 0);
    assert.equal(f.closed(), 1);
    stop();
  }
});
