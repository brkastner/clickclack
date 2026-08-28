import assert from "node:assert/strict";
import test from "node:test";

import type { CachedMessageAudio } from "./messageAudio.ts";
import { MessageAudioPlaybackController } from "./messageAudioPlayback.ts";

class FakeAudio extends EventTarget {
  currentTime = 0;
  pauseCount = 0;
  playCount = 0;

  async play(): Promise<void> {
    this.playCount += 1;
  }

  pause(): void {
    this.pauseCount += 1;
  }
}

function entry(key: string, audio = new FakeAudio()): CachedMessageAudio {
  return {
    key,
    audio: audio as unknown as HTMLAudioElement,
    objectURL: `blob:${key}`,
  };
}

test("plays, pauses, resumes, restarts, and stops one message", async () => {
  const audio = new FakeAudio();
  const controller = new MessageAudioPlaybackController(async () =>
    entry("message-1\0hello", audio),
  );

  await controller.toggle("message-1", "hello");
  assert.equal(controller.snapshot().status, "playing");
  assert.equal(audio.playCount, 1);

  await controller.toggle("message-1", "hello");
  assert.equal(controller.snapshot().status, "paused");
  assert.equal(audio.pauseCount, 1);

  audio.currentTime = 12;
  await controller.restart();
  assert.equal(controller.snapshot().status, "playing");
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.playCount, 2);

  controller.stop();
  assert.equal(controller.snapshot().status, "idle");
  assert.equal(audio.pauseCount, 2);
});

test("natural completion dismisses active playback", async () => {
  const audio = new FakeAudio();
  const controller = new MessageAudioPlaybackController(async () =>
    entry("message-1\0hello", audio),
  );
  await controller.play("message-1", "hello");

  audio.dispatchEvent(new Event("ended"));

  assert.deepEqual(controller.snapshot(), {
    key: "",
    messageID: "",
    status: "idle",
    error: "",
  });
  assert.equal(audio.currentTime, 0);
});

test("starting another message stops the previous playback", async () => {
  const first = new FakeAudio();
  const second = new FakeAudio();
  const controller = new MessageAudioPlaybackController(async (messageID, body) =>
    entry(`${messageID}\0${body}`, messageID === "first" ? first : second),
  );

  await controller.play("first", "one");
  await controller.play("second", "two");

  assert.equal(first.pauseCount, 1);
  assert.equal(first.currentTime, 0);
  assert.equal(second.playCount, 1);
  assert.equal(controller.snapshot().messageID, "second");
  assert.equal(controller.snapshot().status, "playing");
});

test("generation and playback errors stay attached to their message", async () => {
  const controller = new MessageAudioPlaybackController(async () => {
    throw new Error("voice unavailable");
  });

  await controller.play("message-1", "hello");

  assert.equal(controller.snapshot().status, "error");
  assert.equal(controller.snapshot().key, "message-1\0hello");
  assert.equal(controller.snapshot().error, "voice unavailable");
});
