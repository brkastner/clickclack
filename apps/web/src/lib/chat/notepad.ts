export type NotepadStep = { step: string; status: "pending" | "in_progress" | "completed" };
export type NotepadCard = {
  revision: number;
  updatedAt: number;
  markdown?: string;
  steps?: NotepadStep[];
};
export type NotepadState =
  | "loading"
  | "ready"
  | "unmapped"
  | "unsupported"
  | "denied"
  | "unavailable"
  | "disconnected";
export type NotepadSnapshot = { state: NotepadState; card: NotepadCard | null };
export type NotepadSocket = Pick<WebSocket, "close" | "onmessage" | "onclose" | "onerror">;
export type NotepadDependencies = {
  read: (path: string, signal: AbortSignal) => Promise<NotepadSnapshot>;
  connect: (path: string) => NotepadSocket;
  retryMs?: number;
};

// Each open panel owns a disposable generation. Neither snapshots nor pending
// requests survive a target switch, collapse, disconnect, or access failure.
export function watchNotepad(
  path: string,
  deps: NotepadDependencies,
  update: (snapshot: NotepadSnapshot) => void,
): () => void {
  let stopped = false;
  let epoch = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let coalesce: ReturnType<typeof setTimeout> | undefined;
  let socket: NotepadSocket | undefined;
  let request: AbortController | undefined;
  let failures = 0;
  const emit = (state: NotepadState, card: NotepadCard | null = null) => update({ state, card });
  const stopConnection = () => {
    epoch++;
    request?.abort();
    request = undefined;
    clearTimeout(coalesce);
    const old = socket;
    socket = undefined;
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      old.onerror = null;
      old.close();
    }
  };
  const connect = () => {
    stopConnection();
    const generation = epoch;
    const current = () => !stopped && epoch === generation;
    let dirty = 0;
    let loading = false;
    let terminal = false;
    const fail = (denied = false) => {
      if (!current()) return;
      stopConnection();
      emit(denied ? "denied" : "disconnected");
      if (denied || terminal) return;
      const probeGeneration = epoch;
      const controller = new AbortController();
      request = controller;
      // Browsers hide failed WebSocket HTTP statuses. A normal authenticated read
      // distinguishes access denial from connectivity without exposing a snapshot.
      void deps
        .read(path, controller.signal)
        .then((result) => {
          if (stopped || epoch !== probeGeneration) return;
          if (["denied", "unsupported", "unmapped"].includes(result.state)) {
            clearTimeout(retry);
            emit(result.state);
          }
        })
        .catch((error: unknown) => {
          if (!stopped && epoch === probeGeneration && isDenied(error)) {
            clearTimeout(retry);
            emit("denied");
          }
        });
      retry = setTimeout(
        connect,
        Math.min(30_000, (deps.retryMs ?? 1_000) * 2 ** Math.min(failures++, 5)),
      );
    };
    const load = async () => {
      if (!current() || loading || terminal) return;
      loading = true;
      const revision = dirty;
      const controller = new AbortController();
      request = controller;
      try {
        const result = await deps.read(path, controller.signal);
        if (!current()) return;
        if (["denied", "unsupported", "unmapped"].includes(result.state)) {
          terminal = true;
          emit(result.state);
          stopConnection();
          return;
        }
        if (revision === dirty) {
          if (result.state === "ready") {
            failures = 0;
            emit("ready", result.card);
          } else {
            fail();
            return;
          }
        }
      } catch (error) {
        if (!current()) return;
        fail(isDenied(error));
        return;
      } finally {
        loading = false;
        if (current() && revision !== dirty) coalesce = setTimeout(() => void load(), 25);
      }
    };
    emit("loading");
    try {
      socket = deps.connect(`${path}/watch`);
    } catch {
      fail();
      return;
    }
    socket.onmessage = (event) => {
      if (!current()) return;
      let message: { type?: string; state?: NotepadState };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        fail();
        return;
      }
      if (message.type !== "notepad.changed") return;
      if (["denied", "unsupported", "unmapped"].includes(message.state ?? "")) {
        terminal = true;
        emit(message.state!);
        stopConnection();
        return;
      }
      if (message.state !== "ready") {
        fail();
        return;
      }
      dirty++;
      emit("loading"); // an invalidated snapshot is never labelled current
      clearTimeout(coalesce);
      coalesce = setTimeout(() => void load(), 25);
    };
    socket.onclose = (event) => fail(event.code === 1008);
    socket.onerror = () => fail();
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    stopConnection();
  };
}
function isDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  );
}
