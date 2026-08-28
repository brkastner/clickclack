import assert from "node:assert/strict";
import test from "node:test";

import {
  clearMessageAudioCacheForTests,
  getMessageAudio,
  hasCachedMessageAudio,
  messageAudioKey,
} from "./messageAudio.ts";

class FakeAudio {
  preload = "";
  paused = true;
  currentTime = 0;
  readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  pause() {
    this.paused = true;
  }
}

test.before(() => {
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: FakeAudio,
  });
});

test.afterEach(() => clearMessageAudioCacheForTests());

test("keys generated speech by message and cleaned body", () => {
  assert.equal(
    messageAudioKey("message-1", "**Read** [this](https://example.com)"),
    "message-1\u0000Read this",
  );
});

test("generates once and reuses the refresh-scoped audio entry", async () => {
  const requests: { url: string; body: string }[] = [];
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), body: String(init?.body) });
    return new Response(new Uint8Array([73, 68, 51]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  };

  const first = await getMessageAudio("message-1", "Read **this**", request);
  const second = await getMessageAudio("message-1", "Read **this**", request);

  assert.equal(first, second);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "/api/tts");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? ""), { text: "Read this" });
  assert.equal(hasCachedMessageAudio("message-1", "Read **this**"), true);
});

test("does not cache failed generation", async () => {
  let calls = 0;
  const request = async () => {
    calls += 1;
    return new Response(JSON.stringify({ detail: "provider unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  };

  await assert.rejects(getMessageAudio("message-1", "Read this", request), /provider unavailable/);
  await assert.rejects(getMessageAudio("message-1", "Read this", request), /provider unavailable/);
  assert.equal(calls, 2);
});
