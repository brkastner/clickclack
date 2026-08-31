---
title: Voice assistant
description: Use local Kassette speech input and playback with the active OpenClaw conversation.
---

# Voice assistant

ClickClack can run a live voice session from the channel or direct-message
composer. The browser captures microphone audio, Kassette owns the transient
voice session, and ClickClack keeps the durable conversation. Spoken requests
follow the same message path as typed requests, including the active channel,
direct message, topic, and OpenClaw routing.

This is a local agent voice interface. It is not peer-to-peer calling,
conferencing, or video chat.

## Start a session

Run Kassette on the local machine before opening voice:

```sh
uv run kassette serve --client-origin http://127.0.0.1:5173
```

The web client connects to `http://127.0.0.1:7860` by default. A customized
build can set `window.__CLICKCLACK_CONFIG__.voiceBaseUrl` to another trusted
Kassette origin. Kassette remains loopback-bound; `--client-origin` only
allowlists the exact browser origin that may reach it.

Choose a channel or writable direct message, then select the microphone button
in the composer. The browser asks for microphone permission and opens one
SmallWebRTC session with an ordered control channel. The typed draft remains in
the composer while voice is active.

## Controls

- Select the microphone control, or press `Space`, to pause or resume input.
- Select the speaker control to mute or unmute assistant playback.
- In cascade mode, press `A` or select **Auto send** to switch between automatic
  turn submission and a finished draft that waits for **Send**.
- Select the end control to close the voice session and return to the normal
  composer.

Voice shortcuts do not run while focus is in an input, textarea, editable
content, modal, or artifact viewer.

## Provider modes

Kassette exposes two provider paths behind the same browser session.

### Cascade

Kassette streams provisional and final transcripts to ClickClack. ClickClack
commits a finished turn through its normal message dispatch, waits for the
OpenClaw response in that conversation, then returns the response with
`tts.speak`. Kassette renders it through the configured speech provider.

### Quicksilver

Quicksilver handles native transcription and speech, but it does not own the
conversation or reasoning. Kassette emits `delegation.requested`; ClickClack
posts that request through the active OpenClaw conversation and returns the
settled answer with `delegation.complete`. Kassette then lets Quicksilver speak
the delegated answer.

Delegation IDs are opaque to ClickClack. Kassette may issue a temporary ID when
the provider's delegation event is late, then reconcile the real provider turn
without posting the request twice.

## Session boundaries

Raw audio and provider state stay inside the short-lived Kassette session.
ClickClack stores the resulting user and assistant messages through its normal
durable API. Ending or interrupting voice clears pending playback and native
delegations without rewriting messages that were already committed.

Availability depends on the local browser microphone, audio output, Kassette
credentials, and the selected provider. ClickClack does not provision a remote
voice relay, TLS termination, or TURN service for Kassette.
