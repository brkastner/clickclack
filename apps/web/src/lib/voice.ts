export type VoiceStatus = "idle" | "connecting" | "listening" | "failed";

export type VoiceState = {
  status: VoiceStatus;
  error?: string;
};

type VoiceSessionDependencies = {
  createPeerConnection?: () => RTCPeerConnection;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  fetch?: typeof fetch;
  createAudio?: () => HTMLAudioElement;
};

type VoiceSessionOptions = {
  baseURL: string;
  onState: (state: VoiceState) => void;
  dependencies?: VoiceSessionDependencies;
};

type SmallWebRTCAnswer = {
  sdp: string;
  type: RTCSdpType;
  pc_id: string;
};

export class BrowserVoiceSession {
  private readonly baseURL: string;
  private readonly onState: (state: VoiceState) => void;
  private readonly createPeerConnection: () => RTCPeerConnection;
  private readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly request: typeof fetch;
  private readonly audio: HTMLAudioElement;
  private peer: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private input: MediaStream | null = null;
  private state: VoiceState = { status: "idle" };
  private attempt = 0;

  constructor(options: VoiceSessionOptions) {
    this.baseURL = options.baseURL.replace(/\/+$/u, "");
    this.onState = options.onState;
    this.createPeerConnection =
      options.dependencies?.createPeerConnection ?? (() => new RTCPeerConnection());
    this.getUserMedia =
      options.dependencies?.getUserMedia ??
      ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    this.request = options.dependencies?.fetch ?? globalThis.fetch.bind(globalThis);
    this.audio = options.dependencies?.createAudio?.() ?? new Audio();
    this.audio.autoplay = true;
  }

  currentState(): VoiceState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state.status === "connecting" || this.state.status === "listening") return;
    const attempt = ++this.attempt;
    this.publish({ status: "connecting" });

    try {
      const input = await this.getUserMedia({ audio: true, video: false });
      if (attempt !== this.attempt) {
        stopStream(input);
        return;
      }
      this.input = input;

      const peer = this.createPeerConnection();
      this.peer = peer;
      this.dataChannel = peer.createDataChannel("chat", { ordered: true });
      peer.ontrack = (event) => {
        const [stream] = event.streams;
        this.audio.srcObject = stream ?? new MediaStream([event.track]);
        void this.audio.play().catch(() => undefined);
      };
      peer.onconnectionstatechange = () => {
        if (peer !== this.peer) return;
        if (peer.connectionState === "connected") {
          this.publish({ status: "listening" });
        } else if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          this.fail("Voice connection was lost");
        }
      };
      for (const track of input.getTracks()) peer.addTrack(track, input);

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      if (attempt !== this.attempt || peer !== this.peer) return;
      if (!peer.localDescription) throw new Error("Voice connection produced no local offer");

      const response = await this.request(`${this.baseURL}/api/offer`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp: peer.localDescription.sdp,
          type: peer.localDescription.type,
        }),
      });
      if (!response.ok) throw new Error(`Voice service returned HTTP ${response.status}`);
      const answer = parseAnswer(await response.json());
      if (attempt !== this.attempt || peer !== this.peer) return;
      await peer.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
      if (peer.connectionState === "connected") this.publish({ status: "listening" });
    } catch (error) {
      if (attempt !== this.attempt) return;
      this.fail(error instanceof Error ? error.message : "Voice connection failed");
    }
  }

  disconnect(): void {
    this.attempt += 1;
    this.cleanup();
    this.publish({ status: "idle" });
  }

  private fail(message: string): void {
    this.attempt += 1;
    this.cleanup();
    this.publish({ status: "failed", error: message });
  }

  private cleanup(): void {
    const peer = this.peer;
    this.peer = null;
    this.dataChannel?.close();
    this.dataChannel = null;
    if (peer) {
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    stopStream(this.input);
    this.input = null;
    this.audio.pause();
    this.audio.srcObject = null;
  }

  private publish(state: VoiceState): void {
    if (this.state.status === state.status && this.state.error === state.error) return;
    this.state = state;
    this.onState(state);
  }
}

function parseAnswer(value: unknown): SmallWebRTCAnswer {
  if (!value || typeof value !== "object")
    throw new Error("Voice service returned an invalid answer");
  const answer = value as Record<string, unknown>;
  if (
    typeof answer.sdp !== "string" ||
    (answer.type !== "answer" && answer.type !== "offer") ||
    typeof answer.pc_id !== "string"
  ) {
    throw new Error("Voice service returned an invalid answer");
  }
  return answer as SmallWebRTCAnswer;
}

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", handleStateChange);
      reject(new Error("Voice connection timed out gathering network candidates"));
    }, 10_000);
    const handleStateChange = () => {
      if (peer.iceGatheringState !== "complete") return;
      clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", handleStateChange);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", handleStateChange);
  });
}
