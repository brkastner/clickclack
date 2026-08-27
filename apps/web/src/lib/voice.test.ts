import assert from "node:assert/strict";
import test from "node:test";

import { BrowserVoiceSession, type VoiceState } from "./voice.ts";

class FakeTrack {
  stopped = false;

  stop(): void {
    this.stopped = true;
  }
}

class FakeStream {
  readonly track = new FakeTrack();

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
