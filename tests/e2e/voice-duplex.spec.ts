import { expect, test } from "@playwright/test";
import { waitForAppReady } from "./app-ready";

test("keeps live transcription visible while response audio plays", async ({ context, page }) => {
  await context.addInitScript(() => {
    type TestDataChannel = {
      readyState: RTCDataChannelState;
      onmessage: ((event: MessageEvent<string>) => void) | null;
      sent: string[];
      send: (message: string) => void;
      close: () => void;
      emit: (message: unknown) => void;
    };
    const channel: TestDataChannel = {
      readyState: "open",
      onmessage: null,
      sent: [],
      send(message) {
        this.sent.push(message);
      },
      close() {
        this.readyState = "closed";
      },
      emit(message) {
        this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
      },
    };
    const testWindow = window as typeof window & { __voiceTestChannel?: TestDataChannel };
    testWindow.__voiceTestChannel = channel;

    class FakePeerConnection {
      connectionState: RTCPeerConnectionState = "new";
      iceGatheringState: RTCIceGatheringState = "complete";
      localDescription: RTCSessionDescription | null = null;
      onconnectionstatechange: (() => void) | null = null;
      ontrack: ((event: RTCTrackEvent) => void) | null = null;

      createDataChannel(): RTCDataChannel {
        return channel as unknown as RTCDataChannel;
      }

      addTrack(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}

      async createOffer(): Promise<RTCSessionDescriptionInit> {
        return { sdp: "local-sdp", type: "offer" };
      }

      async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
        this.localDescription = description as RTCSessionDescription;
      }

      async setRemoteDescription(): Promise<void> {
        this.connectionState = "connected";
        this.onconnectionstatechange?.();
      }

      close(): void {
        this.connectionState = "closed";
      }
    }

    window.RTCPeerConnection = FakePeerConnection as unknown as typeof RTCPeerConnection;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => new MediaStream() },
    });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (String(input).includes(":7860/api/offer")) {
        return new Response(
          JSON.stringify({ sdp: "remote-sdp", type: "answer", pc_id: "pc-test" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    };
  });

  const workspaceResponse = await page.request.post("/api/workspaces", {
    data: { name: "Voice duplex", slug: `voice-duplex-${Date.now()}` },
  });
  expect(workspaceResponse.ok()).toBe(true);
  const { workspace } = (await workspaceResponse.json()) as {
    workspace: { id: string; route_id: string };
  };
  const channelResponse = await page.request.post(`/api/workspaces/${workspace.id}/channels`, {
    data: { name: "voice-duplex", kind: "public" },
  });
  expect(channelResponse.ok()).toBe(true);
  const { channel } = (await channelResponse.json()) as { channel: { id: string } };

  await page.goto(`/app/${workspace.route_id}/${channel.id}`);
  await waitForAppReady(page);
  await page.getByRole("button", { name: "Start live voice conversation" }).click();

  const emit = (type: string, data: Record<string, unknown>) =>
    page.evaluate(
      ({ type: eventType, data: eventData }) => {
        const testWindow = window as typeof window & {
          __voiceTestChannel?: { emit: (message: unknown) => void };
        };
        testWindow.__voiceTestChannel?.emit({
          label: "kassette",
          type: eventType,
          data: eventData,
        });
      },
      { type, data },
    );

  await emit("session.state_changed", {
    session_id: "voice-test",
    state: "listening",
    sequence: 1,
  });
  await emit("transcript.delta", {
    session_id: "voice-test",
    turn_id: "voice-test:1",
    text: "before playback",
    final: false,
    sequence: 2,
  });
  const preview = page.locator(".message-row.is-voice");
  await expect(preview).toContainText("before playback");

  await emit("session.state_changed", {
    session_id: "voice-test",
    state: "speaking",
    sequence: 3,
  });
  await emit("transcript.delta", {
    session_id: "voice-test",
    turn_id: "voice-test:1",
    text: "during playback",
    final: false,
    sequence: 4,
  });

  await expect(page.getByRole("region", { name: "Live voice conversation" })).toContainText(
    "Response playing",
  );
  await expect(preview).toContainText("during playback");
});
