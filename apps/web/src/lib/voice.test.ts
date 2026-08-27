import assert from "node:assert/strict";
import test from "node:test";

import { BrowserVoiceSession, type VoiceState } from "./voice.ts";

class FakeTrack {
  readonly kind: "audio" | "video";
  readyState: MediaStreamTrackState = "live";
  stopped = false;
  private readonly endedListeners = new Set<() => void>();

  constructor(kind: "audio" | "video" = "audio") {
    this.kind = kind;
  }

  stop(): void {
    this.stopped = true;
    this.readyState = "ended";
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === "ended") this.endedListeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === "ended") this.endedListeners.delete(listener);
  }

  end(): void {
    this.readyState = "ended";
    for (const listener of this.endedListeners) listener();
  }

  endedListenerCount(): number {
    return this.endedListeners.size;
  }
}

class FakeStream {
  readonly track: FakeTrack;

  constructor(track = new FakeTrack()) {
    this.track = track;
  }

  getTracks(): FakeTrack[] {
    return [this.track];
  }
}

class FakeDataChannel {
  closed = false;

  close(): void {
    this.closed = true;
  }
}

class FakeAudio {
  autoplay = false;
  paused = false;
  srcObject: unknown = null;

  async play(): Promise<void> {}

  pause(): void {
    this.paused = true;
  }
}

class FakePeer {
  connectionState: RTCPeerConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "complete";
  localDescription: RTCSessionDescription | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  closed = false;
  tracks: FakeTrack[] = [];
  dataChannel = new FakeDataChannel();
  dataChannelLabel = "";

  createDataChannel(label: string): FakeDataChannel {
    this.dataChannelLabel = label;
    return this.dataChannel;
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track as unknown as FakeTrack);
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { sdp: "local-sdp", type: "offer" };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description as RTCSessionDescription;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
    this.connectionState = "connected";
    this.onconnectionstatechange?.();
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  close(): void {
    this.closed = true;
    this.connectionState = "closed";
  }

  emitTrack(stream: FakeStream): void {
    this.ontrack?.({
      track: stream.track,
      streams: [stream],
    } as unknown as RTCTrackEvent);
  }
}

test("connects microphone audio through kassette SmallWebRTC signaling", async () => {
  const peer = new FakePeer();
  const input = new FakeStream();
  const audio = new FakeAudio();
  const states: VoiceState[] = [];
  let requestedURL = "";
  let requestedBody: unknown;
  const session = new BrowserVoiceSession({
    baseURL: "http://127.0.0.1:7860/",
    onState: (state) => states.push(state),
    dependencies: {
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      getUserMedia: async () => input as unknown as MediaStream,
      createAudio: () => audio as unknown as HTMLAudioElement,
      fetch: async (input, init) => {
        requestedURL = String(input);
        requestedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ sdp: "remote-sdp", type: "answer", pc_id: "pc_test" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  });

  await session.connect();

  assert.equal(requestedURL, "http://127.0.0.1:7860/api/offer");
  assert.deepEqual(requestedBody, { sdp: "local-sdp", type: "offer" });
  assert.deepEqual(peer.remoteDescription, { sdp: "remote-sdp", type: "answer" });
  assert.equal(peer.dataChannelLabel, "chat");
  assert.equal(session.currentState().status, "listening");
  assert.deepEqual(
    states.map((state) => state.status),
    ["connecting", "listening"],
  );

  session.disconnect();
  assert.equal(peer.closed, true);
  assert.equal(peer.dataChannel.closed, true);
  assert.equal(input.track.stopped, true);
  assert.equal(audio.paused, true);
  assert.equal(session.currentState().status, "idle");
});

test("cleans up microphone input when signaling fails", async () => {
  const peer = new FakePeer();
  const input = new FakeStream();
  const session = new BrowserVoiceSession({
    baseURL: "http://127.0.0.1:7860",
    onState: () => undefined,
    dependencies: {
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      getUserMedia: async () => input as unknown as MediaStream,
      createAudio: () => new FakeAudio() as unknown as HTMLAudioElement,
      fetch: async () => new Response("unavailable", { status: 503 }),
    },
  });

  await session.connect();

  assert.deepEqual(session.currentState(), {
    status: "failed",
    error: "Voice service returned HTTP 503",
  });
  assert.equal(peer.closed, true);
  assert.equal(input.track.stopped, true);
});

test("publishes remote audio and clears replaced or ended tracks", async () => {
  const peer = new FakePeer();
  const audio = new FakeAudio();
  const published: Array<MediaStream | null> = [];
  const session = new BrowserVoiceSession({
    baseURL: "http://127.0.0.1:7860",
    onState: () => undefined,
    onRemoteAudio: (stream) => published.push(stream),
    dependencies: {
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      getUserMedia: async () => new FakeStream() as unknown as MediaStream,
      createAudio: () => audio as unknown as HTMLAudioElement,
      fetch: successfulAnswer,
    },
  });
  await session.connect();

  const first = new FakeStream();
  const replacement = new FakeStream();
  peer.emitTrack(first);
  assert.equal(audio.srcObject, first);
  assert.deepEqual(published, [first]);
  assert.equal(first.track.endedListenerCount(), 1);

  peer.emitTrack(replacement);
  assert.equal(audio.srcObject, replacement);
  assert.deepEqual(published, [first, null, replacement]);
  assert.equal(first.track.endedListenerCount(), 0);
  assert.equal(replacement.track.endedListenerCount(), 1);

  first.track.end();
  assert.deepEqual(published, [first, null, replacement]);
  replacement.track.end();
  assert.deepEqual(published, [first, null, replacement, null]);
  assert.equal(replacement.track.endedListenerCount(), 0);
  assert.equal(audio.srcObject, null);

  session.disconnect();
  assert.deepEqual(published, [first, null, replacement, null]);
});

test("clears remote audio on failure and across repeated connection cycles", async () => {
  const peers = [new FakePeer(), new FakePeer()];
  const inputs = [new FakeStream(), new FakeStream()];
  const published: Array<MediaStream | null> = [];
  let peerIndex = 0;
  let inputIndex = 0;
  const session = new BrowserVoiceSession({
    baseURL: "http://127.0.0.1:7860",
    onState: () => undefined,
    onRemoteAudio: (stream) => published.push(stream),
    dependencies: {
      createPeerConnection: () => peers[peerIndex++] as unknown as RTCPeerConnection,
      getUserMedia: async () => inputs[inputIndex++] as unknown as MediaStream,
      createAudio: () => new FakeAudio() as unknown as HTMLAudioElement,
      fetch: successfulAnswer,
    },
  });

  await session.connect();
  const first = new FakeStream();
  peers[0].emitTrack(first);
  session.disconnect();
  assert.equal(first.track.endedListenerCount(), 0);

  await session.connect();
  const second = new FakeStream();
  peers[1].emitTrack(second);
  peers[1].connectionState = "failed";
  peers[1].onconnectionstatechange?.();

  assert.deepEqual(published, [first, null, second, null]);
  assert.equal(second.track.endedListenerCount(), 0);
  assert.equal(inputs[0].track.stopped, true);
  assert.equal(inputs[1].track.stopped, true);
  assert.deepEqual(session.currentState(), {
    status: "failed",
    error: "Voice connection was lost",
  });

  first.track.end();
  second.track.end();
  session.disconnect();
  assert.deepEqual(published, [first, null, second, null]);
});

async function successfulAnswer(): Promise<Response> {
  return new Response(JSON.stringify({ sdp: "remote-sdp", type: "answer", pc_id: "pc_test" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
