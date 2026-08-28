import { voiceBaseURL } from "./api.ts";
import { prepareTextForSpeech } from "./voice.ts";

export type MessageAudioState = "idle" | "generating" | "playing" | "ready" | "error";

export type CachedMessageAudio = {
  key: string;
  audio: HTMLAudioElement;
  objectURL: string;
};

type AudioRequest = typeof fetch;

const audioCache = new Map<string, Promise<CachedMessageAudio>>();
let cleanupInstalled = false;

export function messageAudioKey(messageID: string, body: string): string {
  return `${messageID}\u0000${prepareTextForSpeech(body)}`;
}

export function hasCachedMessageAudio(messageID: string, body: string): boolean {
  return audioCache.has(messageAudioKey(messageID, body));
}

export async function getMessageAudio(
  messageID: string,
  body: string,
  request: AudioRequest = fetch,
): Promise<CachedMessageAudio> {
  const speech = prepareTextForSpeech(body);
  if (!speech) throw new Error("This message has no speakable text");
  const key = messageAudioKey(messageID, body);
  const cached = audioCache.get(key);
  if (cached) return cached;

  const pending = generateMessageAudio(key, speech, request);
  audioCache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    audioCache.delete(key);
    throw error;
  }
}

async function generateMessageAudio(
  key: string,
  speech: string,
  request: AudioRequest,
): Promise<CachedMessageAudio> {
  const response = await request(`${voiceBaseURL()}/api/tts`, {
    method: "POST",
    headers: { Accept: "audio/wav", "Content-Type": "application/json" },
    body: JSON.stringify({ text: speech }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    let message = `Text-to-speech returned HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) message = body.detail.trim();
    } catch {
      // Keep the bounded status message when the service returns a non-JSON error.
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  if (blob.size === 0) throw new Error("Text-to-speech returned empty audio");
  const objectURL = URL.createObjectURL(blob);
  const audio = new Audio(objectURL);
  audio.preload = "auto";
  installCleanup();
  return { key, audio, objectURL };
}

function installCleanup() {
  if (cleanupInstalled || typeof window === "undefined") return;
  cleanupInstalled = true;
  window.addEventListener(
    "pagehide",
    () => {
      for (const pending of audioCache.values()) {
        void pending.then(({ audio, objectURL }) => {
          audio.pause();
          URL.revokeObjectURL(objectURL);
        });
      }
      audioCache.clear();
    },
    { once: true },
  );
}

export function clearMessageAudioCacheForTests() {
  for (const pending of audioCache.values()) {
    void pending.then(({ audio, objectURL }) => {
      audio.pause();
      URL.revokeObjectURL(objectURL);
    });
  }
  audioCache.clear();
}
