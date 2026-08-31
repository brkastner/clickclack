export type VoiceStatus = "idle" | "connecting" | "listening" | "speaking" | "failed";
export type VoiceInputStatus = "live" | "pausing" | "paused" | "resuming";
export type VoiceProviderMode = "cascaded" | "native";

export type VoiceFocus = {
  workspaceID: string;
  channelID?: string;
  directConversationID?: string;
  topicID?: string;
  topicFilterID: string;
  topicFilterGeneration: number;
};

export type VoiceDestination = VoiceFocus & {
  viewKey: string;
};

export function voiceDestinationForFocus(focus: VoiceFocus): VoiceDestination | null {
  const viewKey = focus.directConversationID || focus.channelID || "";
  if (!focus.workspaceID || !viewKey) return null;
  return {
    workspaceID: focus.workspaceID,
    channelID: focus.channelID,
    directConversationID: focus.directConversationID,
    topicID: focus.channelID ? focus.topicID : undefined,
    topicFilterID: focus.channelID ? focus.topicFilterID : "",
    topicFilterGeneration: focus.channelID ? focus.topicFilterGeneration : 0,
    viewKey,
  };
}

export function voiceFocusChanged(
  previous: VoiceDestination | null,
  next: VoiceDestination | null,
): boolean {
  return previous?.workspaceID !== next?.workspaceID || previous?.viewKey !== next?.viewKey;
}

export function voiceResponsePlaybackEnabled(
  status: VoiceStatus,
  awaitingResponses: number,
): boolean {
  return awaitingResponses > 0 && (status === "listening" || status === "speaking");
}

export type VoiceKeyboardShortcut = "toggle-input" | "toggle-auto-send";

export type VoiceKeyboardInput = {
  status: VoiceStatus;
  code: string;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  editable: boolean;
};

export function voiceKeyboardShortcut(input: VoiceKeyboardInput): VoiceKeyboardShortcut | null {
  if (
    (input.status !== "listening" && input.status !== "speaking") ||
    (input.code !== "Space" && input.key !== " ") ||
    input.ctrlKey ||
    input.metaKey ||
    input.altKey ||
    input.repeat ||
    input.isComposing ||
    input.editable
  ) {
    return null;
  }
  return input.shiftKey ? "toggle-auto-send" : "toggle-input";
}

type VoiceResponseCandidate = {
  id: string;
  body: string;
  created_at: string;
  kind?: string;
  author?: { kind?: string } | null;
};

export function collectVoiceResponseCandidates<T extends VoiceResponseCandidate>(
  messages: T[],
  voiceStartedAt: number,
  spokenMessageIDs: ReadonlySet<string>,
): T[] {
  return messages.filter(
    (message) =>
      message.author?.kind === "bot" &&
      (!message.kind || message.kind === "message") &&
      Date.parse(message.created_at) >= voiceStartedAt - 2_000 &&
      !spokenMessageIDs.has(message.id) &&
      Boolean(message.body.trim()),
  );
}

export function prepareTextForSpeech(markdown: string): string {
  let text = markdown.normalize("NFKC");
  text = text.replace(
    /```[\s\S]*?```/gu,
    " I put the code example in the chat instead of reading it aloud. ",
  );
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/gu, (_match, alt: string) =>
    alt.trim() ? ` ${alt.trim()}. ` : " I put an image in the chat. ",
  );
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1");
  text = text.replace(/<https?:\/\/[^>]+>/giu, "the link in chat");
  text = text.replace(/https?:\/\/\S+/giu, "the link in chat");
  text = text.replace(/^\s{0,3}#{1,6}\s+/gmu, "");
  text = text.replace(/^\s{0,3}>\s?/gmu, "");
  text = text.replace(/^\s*[-+*]\s+/gmu, "");
  text = text.replace(/^\s*\d+[.)]\s+/gmu, "");
  text = text.replace(/(\*\*|__)(.*?)\1/gu, "$2");
  text = text.replace(/~~(.*?)~~/gu, "$1");
  text = text.replace(/`([^`\n]+)`/gu, "$1");
  text = text.replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|[.,!?;:]|$)/gu, "$1$2");
  text = text.replace(/\\([\\`*_[\]{}()#+\-.!>])/gu, "$1");
  text = text.replace(/^\s*[-*_]{3,}\s*$/gmu, " ");
  text = text.replace(/\s*\|\s*/gu, "; ");
  text = text.replace(/\s*\n+\s*/gu, ". ");
  text = text.replace(/([.!?])\s*\.\s*/gu, "$1 ");
  return text.replace(/\s+/gu, " ").trim();
}

export type VoiceState = {
  status: VoiceStatus;
  inputStatus?: VoiceInputStatus;
  providerMode?: VoiceProviderMode;
  error?: string;
};

type VoiceSessionDependencies = {
  createPeerConnection?: () => RTCPeerConnection;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  fetch?: typeof fetch;
  createAudio?: () => HTMLAudioElement;
};

export type VoiceTranscript = {
  sessionID: string;
  turnID: string;
  text: string;
  final: boolean;
  sequence: number;
};

export type VoiceDelegation = {
  delegationID: string;
  text: string;
};

export type VoiceDraft = {
  text: string;
  turnIDs: string[];
};

export class VoiceDraftAccumulator {
  private readonly segments = new Map<string, VoiceTranscript>();
  private readonly turnIDs: string[] = [];

  update(transcript: VoiceTranscript): boolean {
    const prior = this.segments.get(transcript.turnID);
    if (prior && prior.sequence >= transcript.sequence) return false;
    const text = transcript.text.trim();
    if (!text) return false;
    if (!prior) this.turnIDs.push(transcript.turnID);
    this.segments.set(transcript.turnID, { ...transcript, text });
    return true;
  }

  snapshot(): VoiceDraft | null {
    const turnIDs = this.turnIDs.filter((turnID) => this.segments.has(turnID));
    const text = turnIDs
      .map((turnID) => this.segments.get(turnID)?.text.trim() ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();
    return text ? { text, turnIDs } : null;
  }

  consume(): VoiceDraft | null {
    const draft = this.snapshot();
    this.clear();
    return draft;
  }

  clear(): void {
    this.segments.clear();
    this.turnIDs.length = 0;
  }
}

type VoiceSessionOptions = {
  baseURL: string;
  onState: (state: VoiceState) => void;
  onTranscript?: (transcript: VoiceTranscript) => void;
  onDelegation?: (delegation: VoiceDelegation) => void;
  onInterrupted?: () => void;
  onInputStream?: (stream: MediaStream | null) => void;
  onRemoteAudio?: (stream: MediaStream | null) => void;
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
  private readonly onTranscript: (transcript: VoiceTranscript) => void;
  private readonly onDelegation: (delegation: VoiceDelegation) => void;
  private readonly onInterrupted: () => void;
  private readonly onInputStream: (stream: MediaStream | null) => void;
  private readonly onRemoteAudio: (stream: MediaStream | null) => void;
  private readonly createPeerConnection: () => RTCPeerConnection;
  private readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly request: typeof fetch;
  private readonly audio: HTMLAudioElement;
  private peer: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private input: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private remoteTrack: MediaStreamTrack | null = null;
  private remoteTrackEnded: (() => void) | null = null;
  private state: VoiceState = { status: "idle" };
  private attempt = 0;

  constructor(options: VoiceSessionOptions) {
    this.baseURL = options.baseURL.replace(/\/+$/u, "");
    this.onState = options.onState;
    this.onTranscript = options.onTranscript ?? (() => undefined);
    this.onDelegation = options.onDelegation ?? (() => undefined);
    this.onInterrupted = options.onInterrupted ?? (() => undefined);
    this.onInputStream = options.onInputStream ?? (() => undefined);
    this.onRemoteAudio = options.onRemoteAudio ?? (() => undefined);
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
      this.onInputStream(input);

      const peer = this.createPeerConnection();
      this.peer = peer;
      this.dataChannel = peer.createDataChannel("chat", { ordered: true });
      this.dataChannel.onmessage = (event) => this.handleServerMessage(event.data);
      peer.ontrack = (event) => {
        if (
          peer !== this.peer ||
          event.track.kind !== "audio" ||
          event.track.readyState === "ended"
        ) {
          return;
        }
        const [eventStream] = event.streams;
        const stream = eventStream ?? new MediaStream([event.track]);
        this.replaceRemoteAudio(event.track, stream);
      };
      peer.onconnectionstatechange = () => {
        if (peer !== this.peer) return;
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
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
    } catch (error) {
      if (attempt !== this.attempt) return;
      this.fail(error instanceof Error ? error.message : "Voice connection failed");
    }
  }

  toggleInput(): boolean {
    if (
      (this.state.status !== "listening" && this.state.status !== "speaking") ||
      this.dataChannel?.readyState !== "open"
    ) {
      return false;
    }
    const inputStatus = this.state.inputStatus ?? "live";
    if (inputStatus === "live") {
      this.setInputTracksEnabled(false);
      this.dataChannel.send(JSON.stringify({ label: "kassette", type: "input.pause", data: {} }));
      this.publish({ ...this.state, inputStatus: "pausing" });
      return true;
    }
    if (inputStatus === "paused") {
      this.dataChannel.send(JSON.stringify({ label: "kassette", type: "input.resume", data: {} }));
      this.publish({ ...this.state, inputStatus: "resuming" });
      return true;
    }
    return false;
  }

  setOutputMuted(muted: boolean): void {
    this.audio.muted = muted;
  }

  completeDelegation(delegationID: string, text: string): boolean {
    const response = text.trim().slice(0, 32_000);
    if (
      this.state.providerMode !== "native" ||
      !delegationID ||
      !response ||
      this.dataChannel?.readyState !== "open"
    ) {
      return false;
    }
    this.dataChannel.send(
      JSON.stringify({
        label: "kassette",
        type: "delegation.complete",
        data: { delegation_id: delegationID, text: response },
      }),
    );
    return true;
  }

  speak(text: string): boolean {
    const speech = prepareTextForSpeech(text);
    if (!speech || this.dataChannel?.readyState !== "open") return false;
    this.dataChannel.send(
      JSON.stringify({
        label: "kassette",
        type: "tts.speak",
        data: { text: speech },
      }),
    );
    return true;
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
    this.onInputStream(null);
    this.clearRemoteAudio();
  }

  private replaceRemoteAudio(track: MediaStreamTrack, stream: MediaStream): void {
    if (track === this.remoteTrack && stream === this.remoteStream) return;
    this.clearRemoteAudio();
    const handleEnded = () => {
      if (track === this.remoteTrack) this.clearRemoteAudio();
    };
    this.remoteTrack = track;
    this.remoteStream = stream;
    this.remoteTrackEnded = handleEnded;
    track.addEventListener("ended", handleEnded);
    this.audio.srcObject = stream;
    this.onRemoteAudio(stream);
    void this.audio.play().catch(() => undefined);
  }

  private clearRemoteAudio(): void {
    const hadRemoteAudio = this.remoteTrack !== null || this.remoteStream !== null;
    if (this.remoteTrack && this.remoteTrackEnded) {
      this.remoteTrack.removeEventListener("ended", this.remoteTrackEnded);
    }
    this.remoteTrack = null;
    this.remoteStream = null;
    this.remoteTrackEnded = null;
    this.audio.pause();
    this.audio.srcObject = null;
    if (hadRemoteAudio) this.onRemoteAudio(null);
  }

  private setInputTracksEnabled(enabled: boolean): void {
    for (const track of this.input?.getAudioTracks() ?? []) track.enabled = enabled;
  }

  private handleServerMessage(value: unknown): void {
    const message = parseServerMessage(value);
    if (!message) return;
    if (message.type === "provider.active") {
      const capabilities = message.data.capabilities;
      const mode =
        capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)
          ? (capabilities as Record<string, unknown>).mode
          : undefined;
      if (mode !== "native" && mode !== "cascaded") return;
      const state = message.data.state;
      this.publish({
        ...this.state,
        status: state === "listening" || state === "speaking" ? state : this.state.status,
        inputStatus: this.state.inputStatus ?? "live",
        providerMode: mode,
      });
      return;
    }
    if (message.type === "session.state_changed") {
      const state = message.data.state;
      if (state === "listening" || state === "speaking") {
        this.publish({
          status: state,
          inputStatus: this.state.inputStatus ?? "live",
          providerMode: this.state.providerMode,
        });
      }
      return;
    }
    if (message.type === "delegation.requested") {
      const delegationID = message.data.delegation_id;
      const text = message.data.text;
      if (
        this.state.providerMode === "native" &&
        typeof delegationID === "string" &&
        typeof text === "string" &&
        text.trim()
      ) {
        this.onDelegation({ delegationID, text: text.trim() });
      }
      return;
    }
    if (message.type === "session.interrupted") {
      this.onInterrupted();
      return;
    }
    if (message.type === "input.state_changed") {
      const paused = message.data.paused;
      if (typeof paused !== "boolean") return;
      this.setInputTracksEnabled(!paused);
      this.publish({
        ...this.state,
        inputStatus: paused ? "paused" : "live",
      });
      return;
    }
    if (message.type === "session.error") {
      this.fail(
        typeof message.data.message === "string" ? message.data.message : "Voice service failed",
      );
      return;
    }
    if (message.type !== "transcript.delta" && message.type !== "transcript.final") return;
    const { session_id, turn_id, text, sequence } = message.data;
    if (
      typeof session_id !== "string" ||
      typeof turn_id !== "string" ||
      typeof text !== "string" ||
      typeof sequence !== "number"
    ) {
      return;
    }
    this.onTranscript({
      sessionID: session_id,
      turnID: turn_id,
      text,
      final: message.type === "transcript.final",
      sequence,
    });
  }

  private publish(state: VoiceState): void {
    if (
      this.state.status === state.status &&
      this.state.inputStatus === state.inputStatus &&
      this.state.providerMode === state.providerMode &&
      this.state.error === state.error
    ) {
      return;
    }
    this.state = state;
    this.onState(state);
  }
}

type KassetteServerMessage = {
  type: string;
  data: Record<string, unknown>;
};

function parseServerMessage(value: unknown): KassetteServerMessage | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record.label !== "kassette" || typeof record.type !== "string") return null;
  if (!record.data || typeof record.data !== "object") return null;
  return { type: record.type, data: record.data as Record<string, unknown> };
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
