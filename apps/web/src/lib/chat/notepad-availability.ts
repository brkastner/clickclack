export type NotepadAvailability = { available: boolean };
export type NotepadAvailabilityDependencies = {
  read: (path: string, signal: AbortSignal) => Promise<NotepadAvailability>;
};

// Availability is deliberately a boolean: routing identities and credentials
// remain server-owned. A new selection immediately hides the previous entry.
export function createNotepadAvailability(
  deps: NotepadAvailabilityDependencies,
  update: (available: boolean) => void,
) {
  let generation = 0;
  let request: AbortController | undefined;

  return {
    select(path: string | null) {
      request?.abort();
      const currentGeneration = ++generation;
      update(false);
      if (!path) return;
      request = new AbortController();
      void deps.read(path, request.signal).then(
        (result) => {
          if (generation === currentGeneration && !request?.signal.aborted)
            update(result.available);
        },
        () => {},
      );
    },
    dispose() {
      generation++;
      request?.abort();
    },
  };
}
