import type { Message, User } from "./types";

export type OutputPage = { outputs: Message[]; next_cursor: string | null };
export const outputSourceKey = (userID: string, workspaceID: string) =>
  `clickclack:output-source:${encodeURIComponent(userID)}:${encodeURIComponent(workspaceID)}`;
export function outputBots(users: User[]): User[] {
  return users.filter((user) => user.kind === "bot" && !user.deleted_at);
}
export function boundOutputBot(users: User[], id: string): User | undefined {
  return outputBots(users).find((user) => user.id === id);
}
export type OutputFetcher = (
  cursor: string,
  limit: number,
  signal: AbortSignal,
) => Promise<OutputPage>;

// One request owner per user/workspace/source. Pages survive view detours, but
// every return validates them before displaying cached content again.
export class OutputGallerySession {
  pages: OutputPage[] = [];
  cursors: string[] = [];
  selectedID = "";
  scrollTop = 0;
  anchorID = "";
  anchorOffset = 0;
  busy = false;
  error = "";
  private generation = 0;
  private controller: AbortController | undefined;
  private fetchPage: OutputFetcher;
  constructor(fetchPage: OutputFetcher) {
    this.fetchPage = fetchPage;
  }
  get outputs(): Message[] {
    return this.pages.flatMap((page) => page.outputs);
  }
  get nextCursor(): string | null {
    return this.pages.at(-1)?.next_cursor ?? null;
  }
  cancel() {
    this.generation++;
    this.controller?.abort();
    this.busy = false;
  }
  async load(more = false): Promise<void> {
    if (this.busy || (more && !this.nextCursor)) return;
    const cursor = more ? this.nextCursor! : "";
    await this.request(async (signal) => {
      const page = await this.fetchPage(cursor, 30, signal);
      return () => {
        const seen = new Set(more ? this.outputs.map((m) => m.id) : []);
        const unique = {
          ...page,
          outputs: page.outputs.filter((m) => !seen.has(m.id) && !!seen.add(m.id)),
        };
        this.pages = more ? [...this.pages, unique] : [unique];
        this.cursors = more ? [...this.cursors, cursor] : [cursor];
      };
    });
  }
  async revalidate(): Promise<void> {
    this.cancel();
    if (!this.pages.length) return this.load();
    await this.request(async (signal) => {
      const pages: OutputPage[] = [];
      // Sequential bounded page requests preserve pagination boundaries. Do not
      // insert fresh first-page cards into a scrolled gallery without Refresh.
      for (const cursor of this.cursors) pages.push(await this.fetchPage(cursor, 30, signal));
      const current = new Map(pages.flatMap((p) => p.outputs).map((m) => [m.id, m]));
      return () => {
        this.pages = this.pages.map((p) => ({
          ...p,
          outputs: p.outputs.flatMap((m) => (current.has(m.id) ? [current.get(m.id)!] : [])),
        }));
      };
    }, true);
  }
  async latest(): Promise<Message | undefined> {
    this.cancel();
    let latest: Message | undefined;
    await this.request(async (signal) => {
      const page = await this.fetchPage("", 1, signal);
      return () => {
        latest = page.outputs[0];
      };
    });
    return latest;
  }
  private async request(
    work: (signal: AbortSignal) => Promise<() => void>,
    clearOnFailure = false,
  ) {
    const generation = ++this.generation;
    this.controller = new AbortController();
    this.busy = true;
    this.error = "";
    try {
      const commit = await work(this.controller.signal);
      if (generation === this.generation) commit();
    } catch {
      if (generation === this.generation) {
        this.error = "Responses could not be loaded. Retry to check access and try again.";
        if (clearOnFailure) {
          this.pages = [];
          this.cursors = [];
        }
      }
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }
}

export let galleryReturn:
  | { userID: string; workspaceID: string; session: OutputGallerySession; sourceID: string }
  | undefined;
export let gallerySource: Message | undefined;
export function rememberGallery(value: NonNullable<typeof galleryReturn>) {
  galleryReturn = value;
}
export function revealGallerySource(message: Message) {
  gallerySource = message;
}
export function consumeGallerySource() {
  const message = gallerySource;
  gallerySource = undefined;
  return message;
}
export function clearGalleryReturn() {
  galleryReturn?.session.cancel();
  galleryReturn = undefined;
  gallerySource = undefined;
}
