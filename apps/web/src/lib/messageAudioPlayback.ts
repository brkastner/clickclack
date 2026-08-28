import { get, writable, type Readable } from "svelte/store";

import { getMessageAudio, messageAudioKey, type CachedMessageAudio } from "./messageAudio.ts";

export type MessageAudioPlaybackStatus = "idle" | "generating" | "playing" | "paused" | "error";

export type MessageAudioPlaybackSnapshot = {
  key: string;
  messageID: string;
  status: MessageAudioPlaybackStatus;
  error: string;
};

type AudioLoader = (messageID: string, body: string) => Promise<CachedMessageAudio>;

const IDLE_SNAPSHOT: MessageAudioPlaybackSnapshot = {
  key: "",
  messageID: "",
  status: "idle",
  error: "",
};

export class MessageAudioPlaybackController implements Readable<MessageAudioPlaybackSnapshot> {
  private readonly store = writable<MessageAudioPlaybackSnapshot>(IDLE_SNAPSHOT);
  private entry: CachedMessageAudio | null = null;
  private generation = 0;
  private removeListeners = () => {};
  private readonly loadAudio: AudioLoader;

  readonly subscribe = this.store.subscribe;

  constructor(loadAudio: AudioLoader = getMessageAudio) {
    this.loadAudio = loadAudio;
  }

  snapshot(): MessageAudioPlaybackSnapshot {
    return get(this.store);
  }

  async toggle(messageID: string, body: string): Promise<void> {
    const key = messageAudioKey(messageID, body);
    const current = this.snapshot();
    if (current.key === key) {
      if (current.status === "generating") return;
      if (current.status === "playing") {
        this.pause();
        return;
      }
      if (current.status === "paused") {
        await this.resume();
        return;
      }
    }
    await this.play(messageID, body);
  }

  async play(messageID: string, body: string): Promise<void> {
    this.stop();
    const key = messageAudioKey(messageID, body);
    const generation = ++this.generation;
    this.store.set({ key, messageID, status: "generating", error: "" });
    try {
      const entry = await this.loadAudio(messageID, body);
      if (generation !== this.generation || this.snapshot().key !== key) return;
      this.bind(entry, key);
      entry.audio.currentTime = 0;
      this.store.set({ key, messageID, status: "playing", error: "" });
      await entry.audio.play();
    } catch (error) {
      if (generation !== this.generation || this.snapshot().key !== key) return;
      this.store.set({
        key,
        messageID,
        status: "error",
        error: error instanceof Error ? error.message : "Text-to-speech failed",
      });
    }
  }

  pause(): void {
    const current = this.snapshot();
    if (current.status !== "playing" || !this.entry) return;
    this.entry.audio.pause();
    this.store.set({ ...current, status: "paused" });
  }

  async resume(): Promise<void> {
    const current = this.snapshot();
    if (current.status !== "paused" || !this.entry) return;
    this.store.set({ ...current, status: "playing", error: "" });
    try {
      await this.entry.audio.play();
    } catch (error) {
      if (this.snapshot().key !== current.key) return;
      this.store.set({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "Generated audio could not be played",
      });
    }
  }

  async restart(): Promise<void> {
    const current = this.snapshot();
    if (!this.entry || (current.status !== "playing" && current.status !== "paused")) return;
    this.entry.audio.currentTime = 0;
    if (current.status === "paused") await this.resume();
  }

  stop(): void {
    this.generation += 1;
    if (this.entry) {
      this.entry.audio.pause();
      this.entry.audio.currentTime = 0;
    }
    this.detach();
    this.store.set(IDLE_SNAPSHOT);
  }

  private bind(entry: CachedMessageAudio, key: string): void {
    this.detach();
    this.entry = entry;
    const handleEnded = () => {
      if (this.snapshot().key !== key) return;
      entry.audio.currentTime = 0;
      this.detach();
      this.store.set(IDLE_SNAPSHOT);
    };
    const handleError = () => {
      const current = this.snapshot();
      if (current.key !== key) return;
      this.store.set({
        ...current,
        status: "error",
        error: "Generated audio could not be played",
      });
    };
    entry.audio.addEventListener("ended", handleEnded);
    entry.audio.addEventListener("error", handleError);
    this.removeListeners = () => {
      entry.audio.removeEventListener("ended", handleEnded);
      entry.audio.removeEventListener("error", handleError);
    };
  }

  private detach(): void {
    this.removeListeners();
    this.removeListeners = () => {};
    this.entry = null;
  }
}

export const messageAudioPlayback = new MessageAudioPlaybackController();
