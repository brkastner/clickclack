import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserVoiceSession,
  collectVoiceResponseCandidates,
  prepareTextForSpeech,
  VoiceDraftAccumulator,
  type VoiceState,
  type VoiceTranscript,
} from "./voice.ts";

class FakeTrack {
  enabled = true;
  stopped = false;
  readyState: MediaStreamTrackState = "live";
  readonly kind: "audio" | "video";
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

  getAudioTracks(): FakeTrack[] {
    return [this.track];
  }
}

class FakeDataChannel {
  closed = false;
  readyState: RTCDataChannelState = "open";
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  sent: string[] = [];

  send(message: string): void {
    this.sent.push(message);
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  close(): void {
    this.closed = true;
    this.readyState = "closed";
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

test("preserves and combines transcript segments across microphone pauses", () => {
  const draft = new VoiceDraftAccumulator();

  assert.equal(
    draft.update({
      sessionID: "voice-1",
      turnID: "voice-1:1",
      text: "I said a whole thing",
      final: false,
      sequence: 1,
    }),
    true,
  );
  assert.equal(
    draft.update({
      sessionID: "voice-1",
      turnID: "voice-1:2",
      text: "and a little bit extra",
      final: false,
      sequence: 2,
    }),
    true,
  );
  assert.equal(draft.snapshot()?.text, "I said a whole thing and a little bit extra");
  assert.deepEqual(draft.snapshot()?.turnIDs, ["voice-1:1", "voice-1:2"]);

  assert.equal(
    draft.update({
      sessionID: "voice-1",
      turnID: "voice-1:1",
      text: "stale replacement",
      final: false,
      sequence: 0,
    }),
    false,
  );
  assert.equal(draft.snapshot()?.text, "I said a whole thing and a little bit extra");

  assert.deepEqual(draft.consume(), {
    text: "I said a whole thing and a little bit extra",
    turnIDs: ["voice-1:1", "voice-1:2"],
  });
  assert.equal(draft.snapshot(), null);
});

test("returns every new bot response block in message order", () => {
  const startedAt = Date.parse("2026-08-28T01:00:00Z");
  const messages = [
    {
      id: "user",
      body: "question",
      created_at: "2026-08-28T01:00:00Z",
      author: { kind: "user" },
    },
    {
      id: "block-1",
      body: "First sentence.",
      created_at: "2026-08-28T01:00:01Z",
      author: { kind: "bot" },
    },
    {
      id: "block-2",
      body: "Second sentence.",
      created_at: "2026-08-28T01:00:02Z",
      author: { kind: "bot" },
    },
  ];

  assert.deepEqual(
    collectVoiceResponseCandidates(messages, startedAt, new Set()).map((message) => message.id),
    ["block-1", "block-2"],
  );
  assert.deepEqual(
    collectVoiceResponseCandidates(messages, startedAt, new Set(["block-1"])).map(
      (message) => message.id,
    ),
    ["block-2"],
  );
});

test("turns structured Markdown into conversational speech", () => {
  assert.equal(
    prepareTextForSpeech(
      "## Result\n\n- **Ready now**\n- See [the guide](https://example.com)\n\n```ts\nconst hidden = true;\n```",
    ),
    "Result. Ready now. See the guide. I put the code example in the chat instead of reading it aloud.",
  );
});

test("connects microphone audio through kassette SmallWebRTC signaling", async () => {
  const peer = new FakePeer();
  const input = new FakeStream();
  const audio = new FakeAudio();
  const states: VoiceState[] = [];
  const transcripts: VoiceTranscript[] = [];
  const inputStreams: Array<MediaStream | null> = [];
  const remoteStreams: Array<MediaStream | null> = [];
  let requestedURL = "";
  let requestedBody: unknown;
  const session = new BrowserVoiceSession({
    baseURL: "http://127.0.0.1:7860/",
    onState: (state) => states.push(state),
    onTranscript: (transcript) => transcripts.push(transcript),
    onInputStream: (stream) => inputStreams.push(stream),
    onRemoteAudio: (stream) => remoteStreams.push(stream),
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
  assert.equal(session.currentState().status, "connecting");
  peer.dataChannel.emit({
    label: "kassette",
    type: "session.state_changed",
    data: { session_id: "voice-1", state: "listening", sequence: 1 },
  });
  peer.dataChannel.emit({
    label: "kassette",
    type: "transcript.delta",
    data: {
      session_id: "voice-1",
      turn_id: "voice-1:1",
      text: "hello",
      final: false,
      sequence: 2,
    },
  });
  assert.equal(session.currentState().status, "listening");
  assert.deepEqual(
    states.map((state) => state.status),
    ["connecting", "listening"],
  );
  assert.deepEqual(transcripts, [
    { sessionID: "voice-1", turnID: "voice-1:1", text: "hello", final: false, sequence: 2 },
  ]);

  assert.equal(session.toggleInput(), true);
  assert.equal(input.track.enabled, false);
  assert.equal(peer.closed, false);
  assert.equal(audio.paused, false);
  assert.deepEqual(JSON.parse(peer.dataChannel.sent[0]), {
    label: "kassette",
    type: "input.pause",
    data: {},
  });
  peer.dataChannel.emit({
    label: "kassette",
    type: "input.state_changed",
    data: { session_id: "voice-1", paused: true, sequence: 3 },
  });
  assert.equal(session.currentState().inputStatus, "paused");

  assert.equal(session.toggleInput(), true);
  assert.equal(input.track.enabled, false);
  assert.deepEqual(JSON.parse(peer.dataChannel.sent[1]), {
    label: "kassette",
    type: "input.resume",
    data: {},
  });
  peer.dataChannel.emit({
    label: "kassette",
    type: "input.state_changed",
    data: { session_id: "voice-1", paused: false, sequence: 4 },
  });
  assert.equal(session.currentState().inputStatus, "live");
  assert.equal(input.track.enabled, true);

  assert.equal(session.speak("agent response"), true);
  assert.deepEqual(JSON.parse(peer.dataChannel.sent[2]), {
    label: "kassette",
    type: "tts.speak",
    data: { text: "agent response" },
  });
  assert.equal(session.speak("That is **done**. See [the details](https://example.com)."), true);
  assert.deepEqual(JSON.parse(peer.dataChannel.sent[3]), {
    label: "kassette",
    type: "tts.speak",
    data: { text: "That is done. See the details." },
  });
  assert.deepEqual(inputStreams, [input as unknown as MediaStream]);
  const output = new FakeStream();
  peer.emitTrack(output);
  assert.equal(audio.srcObject, output);
  assert.deepEqual(remoteStreams, [output as unknown as MediaStream]);

  session.disconnect();
  assert.equal(peer.closed, true);
  assert.equal(peer.dataChannel.closed, true);
  assert.equal(input.track.stopped, true);
  assert.equal(audio.paused, true);
  assert.equal(session.currentState().status, "idle");
  assert.equal(inputStreams.at(-1), null);
  assert.equal(remoteStreams.at(-1), null);
  assert.equal(output.track.endedListenerCount(), 0);
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
