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

  const sentMessages = () =>
    page.evaluate(() => {
      const testWindow = window as typeof window & {
        __voiceTestChannel?: { sent: string[] };
      };
      return (testWindow.__voiceTestChannel?.sent || []).map((message) => JSON.parse(message));
    });

  await page.keyboard.press("Space");
  expect((await sentMessages()).at(-1)).toEqual({
    label: "kassette",
    type: "input.pause",
    data: {},
  });
  await emit("input.state_changed", {
    session_id: "voice-test",
    paused: true,
    sequence: 5,
  });
  await expect(page.getByRole("button", { name: "Resume microphone" })).toBeVisible();

  await page.keyboard.press("Space");
  expect((await sentMessages()).at(-1)).toEqual({
    label: "kassette",
    type: "input.resume",
    data: {},
  });
  await emit("input.state_changed", {
    session_id: "voice-test",
    paused: false,
    sequence: 6,
  });

  const sentBeforeEditableSpace = (await sentMessages()).length;
  await page.evaluate(() => {
    const textarea = document.createElement("textarea");
    textarea.id = "voice-shortcut-editable";
    document.body.append(textarea);
    textarea.focus();
  });
  await page.keyboard.press("Space");
  await expect(page.locator("#voice-shortcut-editable")).toHaveValue(" ");
  expect(await sentMessages()).toHaveLength(sentBeforeEditableSpace);
  await page.locator("#voice-shortcut-editable").evaluate((element) => element.remove());

  await page.keyboard.press("a");
  await expect(page.getByRole("button", { name: "Enable VAD auto-send" })).toBeVisible();
  await emit("transcript.final", {
    session_id: "voice-test",
    turn_id: "voice-test:1",
    text: "held for manual send",
    final: true,
    sequence: 7,
  });
  await expect(preview).toContainText("held for manual send");
  const beforeManualSend = (await page.request
    .get(`/api/channels/${channel.id}/messages`)
    .then((response) => response.json())) as { messages: Array<{ body: string }> };
  expect(
    beforeManualSend.messages.some((message) => message.body.includes("held for manual send")),
  ).toBe(false);

  await page.getByRole("button", { name: "Send dictated message" }).click();
  await expect(
    page.locator(".message-row:not(.is-voice)", { hasText: "held for manual send" }),
  ).toBeVisible();

  await emit("provider.active", {
    session_id: "voice-test",
    provider_id: "quicksilver",
    state: "listening",
    capabilities: { mode: "native" },
    sequence: 8,
  });
  await emit("transcript.delta", {
    session_id: "voice-test",
    turn_id: "voice-test:native:2",
    role: "user",
    text: "native live preview",
    final: false,
    sequence: 9,
  });
  await expect(preview).toContainText("native live preview");

  await emit("delegation.requested", {
    session_id: "voice-test",
    delegation_id: "delegation-native-2",
    text: "native durable message",
    sequence: 10,
  });
  const nativeDurableMessageCount = async () => {
    const response = await page.request.get(`/api/channels/${channel.id}/messages`);
    const payload = (await response.json()) as { messages: Array<{ body: string }> };
    return payload.messages.filter((message) => message.body === "native durable message").length;
  };
  await expect.poll(nativeDurableMessageCount).toBe(1);

  await emit("transcript.final", {
    session_id: "voice-test",
    turn_id: "voice-test:native:2",
    role: "user",
    text: "native durable message",
    final: true,
    sequence: 11,
  });
  await expect.poll(nativeDurableMessageCount).toBe(1);
});
