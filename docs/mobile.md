---
title: Mobile app
description: The Capacitor shell that runs ClickClack as an iOS and Android app, including deep links, push notification routing, and native gestures.
---

# Mobile app

ClickClack runs on iOS and Android through a [Capacitor](https://capacitorjs.com)
shell in `apps/mobile`. The shell is deliberately thin: it loads the ClickClack
web app from a real server origin, the same way the desktop client does, so
sessions, cookies, uploads, search, and the realtime socket behave exactly as
they do in a browser. The server stays the source of truth, and the app is never
a separate build of the product that can drift from it.

## What becomes native

- **Deep links.** `clickclack://app/<workspace>/<target>` and
  `clickclack://open?path=/app/...` open a routed workspace, channel, DM, or
  thread in the app. This is the scheme the desktop client already registers, so
  one link works on every ClickClack surface.
- **Push notifications that land on the message.** Pushover notifications carry
  an "Open in ClickClack" link to the conversation the message arrived in;
  tapping it opens the app on that channel, DM, or thread rather than on the
  app's home. See [Push notifications](#push-notifications) below.
- **Long press for message actions.** Holding a message opens ClickClack's
  action sheet — react, reply, open thread, copy, copy link, edit, pin, delete —
  with a haptic tick when the press registers. In the app the gesture no longer
  competes with WebKit's text selection and link callout; Copy and Copy link in
  the sheet take their place.
- **A back button that closes things.** Android's back button walks the same
  hierarchy Escape does: it closes the open modal, then the navigation drawer,
  then the thread, pinned, artifact, or search pane, then a pending reply, and
  only leaves the screen when nothing is left to close.
- **System chrome that follows the board.** The status bar tracks the active
  color mode, including the system-follows setting, and the keyboard resizes the
  web view so the composer rides above it instead of being covered by it.
- **Sharing into ClickClack.** ClickClack appears in Android's share sheet for
  links, text, and images, one or several at a time. Shared content fills the
  composer of the conversation already open and waits there — a share sheet is
  an intent to compose, not an intent to post — so sending it stays deliberate.
- **In-app stays in-app.** Navigation is confined to the configured server;
  every other link opens in the system browser.

Everything above degrades to nothing in a browser: the web bundle talks to the
shell through the globals Capacitor injects, never through native packages, so
the web app carries no native dependency and behaves exactly as it does today.

## Build it

Requirements are Capacitor's own: Xcode for iOS, Android Studio and a JDK for
Android. Install workspace dependencies first:

```sh
pnpm install
```

Point the shell at your server and generate the native project. The server URL
is read at build time and baked into the app:

```sh
CLICKCLACK_SERVER_URL=https://chat.example.com pnpm mobile:ios
CLICKCLACK_SERVER_URL=https://chat.example.com pnpm mobile:android
```

Remote servers must use HTTPS. Plain HTTP is accepted only for `localhost`,
`127.0.0.1`, and `::1`, so a development server works without extra flags. With
no `CLICKCLACK_SERVER_URL`, the shell targets `https://app.clickclack.chat`.

Then open the project in its platform IDE and run it on a device or simulator:

```sh
pnpm --filter @clickclack/mobile open:ios
pnpm --filter @clickclack/mobile open:android
```

### Install Android over the tailnet

Kas's Android install path is one command from the repository root:

```sh
pnpm mobile:install
```

The command asks Tailscale for the current tailnet rather than storing its DNS
suffix. It derives the app origin from this machine's Tailscale name on port
8080, finds the `pixel-10-pro` peer by name, syncs or creates the generated
Android project, picks the newest installed JDK Gradle accepts, and runs
`installDebug`. A one-off override is still possible:

```sh
CLICKCLACK_SERVER_URL=https://another-host:8080 \
CLICKCLACK_ANDROID_DEVICE=another-phone pnpm mobile:install
```

Android requires one pairing ceremony for a new computer. Enable **Wireless
debugging**, choose **Pair device with pairing code**, then use the pairing port
and the separate connect port shown by Android:

```sh
adb pair <phone>:<pairing-port>
adb connect <phone>:<connect-port>
pnpm mobile:install
```

The installer sees that temporary connection and moves adbd to the stable
Tailnet address on port 5555 itself. Later installs need only
`pnpm mobile:install`, including across Wi-Fi changes. Android stops that fixed
listener when the phone reboots; after a reboot, enable Wireless debugging and
make one temporary connection again. The pairing itself persists.

After changing `capacitor.config.ts` or the server URL, re-sync:

```sh
CLICKCLACK_SERVER_URL=https://chat.example.com pnpm mobile:sync
```

`apps/mobile/ios` and `apps/mobile/android` are generated, not tracked. Both
`mobile:ios`/`mobile:android` and `mobile:sync` run
`scripts/configure-native.mjs`, which registers the app's URL schemes in the iOS
`Info.plist` and the Android manifest — `clickclack://` for conversation links
and `chat.clickclack.desktop:` for the sign-in callback — claims the Android
share sheet, installs the branded launcher and splash art, sets the launcher
label, and installs the app's own Java. It is idempotent, so the native
projects stay disposable: delete them and regenerate at any time.

## Branding

The launcher icon and splash art are rendered from one source mark,
`apps/mobile/assets/brand/kasmos-k.png`, into `apps/mobile/native/android/res`,
which is tracked. `configure-native.mjs` copies that over Capacitor's own art,
so installing the brand needs no image tooling and `pnpm mobile:sync` works on
a machine that has never rendered it.

Regenerating is a separate step, needed only when the source mark changes, and
it requires ImageMagick:

```sh
node apps/mobile/scripts/generate-android-brand.mjs
pnpm mobile:sync
```

The app id and both URL schemes are deliberately not part of the branding. The
server, the desktop client, and every deep link already issued address this app
by those rather than by its name, so only the label changes.

## Sign in

Sign-in runs in the system browser, not in the app's web view, and the app
receives the result over a URL scheme.

It has to work this way. Hitting `/api/auth/github/start` from the web view
would set the provider's browser-binding cookie there and then redirect to
GitHub, which the shell hands to the system browser; the callback would arrive
without that cookie and be rejected, and any session it did establish would
belong to the browser rather than to the app. So the app instead starts the
whole flow in the browser with a PKCE challenge, the callback hands back a
single-use grant over `chat.clickclack.desktop:/auth/callback`, and the app
redeems that grant from the web view — which is what installs the session where
the app can use it.

These are the same server endpoints the desktop client uses
(`/api/auth/github/desktop/start` and `/api/auth/github/desktop/consume`), so a
server needs no extra configuration beyond having GitHub OAuth set up. The grant
is single-use, expires quickly, and is only redeemable with the verifier held by
the app that started the flow.

**Sign in with OpenClaw ID is not offered in the app.** It has no native-client
handoff on the server yet, so the app hides it rather than presenting a flow
that cannot finish — the same thing the desktop client does. Use GitHub sign-in,
or reach the workspace in a mobile browser.

## Deep links

The app accepts the two link shapes the desktop client accepts:

```text
clickclack://app/<workspace>/<target>
clickclack://open?path=/app/<workspace>/<target>
```

Only `/app` routes are navigable. A link to any other path, to another origin,
or to another scheme is refused rather than followed, so an untrusted link
cannot steer the app somewhere it should not go. Links that arrive while the app
is closed are honored on launch, not dropped.

`<target>` may be a shareable route ID or a raw channel, conversation, or
message identifier; the app canonicalizes the pair through the route API. A
message identifier opens that message's thread.

## Push notifications

Push notifications continue to go through Pushover, configured exactly as
before: set `CLICKCLACK_PUSHOVER_API_TOKEN` on the server, and each member adds
their own Pushover user key in account settings. See
[Channel notifications](features/channel-notifications.md).

What is new is that each notification carries a link to the conversation it came
from. `CLICKCLACK_APP_LINK_MODE` selects which link:

| Mode | Link | Use it when |
| --- | --- | --- |
| `app` (default) | `clickclack://open?path=/app/...` | Members read notifications on a phone with the app installed. |
| `web` | `https://<public URL>/app/...` | Members open notifications without an installed client. |
| `off` | none | Notifications should carry no link. |

`web` mode requires `CLICKCLACK_PUBLIC_URL`; without it no link is sent.
Building the link costs no extra database work, so the notification path is
unchanged in cost.

On the phone, Pushover shows the link as **Open in ClickClack** on the
notification. Pushover's Android client can be set to open a notification's
supplementary URL directly on tap, under its notification settings; on iOS the
link is tapped from the expanded notification or the Pushover app.

To go further and have plain `https` links to your server open the app as well,
configure [universal links](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
on iOS and [app links](https://developer.android.com/training/app-links) on
Android for your server's domain, then switch `CLICKCLACK_APP_LINK_MODE` to
`web`. The app already routes `https` links to its own origin through the same
code path as `clickclack://` links, so no app change is needed — only the
associated-domain files on your server and the matching entitlement and
signing-certificate fingerprint in the native projects.

## Security model

The shell loads the server it was built for, and adds no navigation allowlist of
its own. Other sites, and links carrying another scheme, are handed to the system
browser instead of being rendered in the app's web view, so remote content cannot
navigate the app somewhere that would still look like ClickClack.

Capacitor decides in-app navigation by comparing the app URL's scheme and host
and **not its port**, so on its own a second HTTPS service on the same hostname
at another port would stay inside the web view where the bridge is injected. The
Android project closes that gap: `apps/mobile/native/android/MainActivity.java`
installs a web view client that compares the full origin — scheme, host, and
port, with default ports resolved. It is tracked here and installed into the
generated project by `scripts/configure-native.mjs`, bound to the origin the
build was configured with, so the native projects stay disposable.

It guards two callbacks, because one is not enough. `shouldOverrideUrlLoading`
is documented not to fire for POST requests, and Capacitor's local server only
proxies GET, so a main-frame form POST to another port would otherwise load its
HTML response in the web view without the URL check ever running.
`shouldInterceptRequest` is therefore the fail-closed boundary: an off-origin
main-frame request is refused with a 403 rather than deferred to WebView. It is
refused rather than reopened externally, since replaying a submission's body as
a browser GET would change what it means. `shouldOverrideUrlLoading`
additionally hands ordinary off-origin link navigations to the system browser.

Subframes and same-origin requests keep Capacitor's own policy, which plugins
take part in, and the system-browser sign-in flow is unaffected because it never
navigates the web view.

The guard is Android-specific by design: it addresses the host comparison in
Capacitor's Android `Bridge.launchIntent`, and iOS decides differently. Do not
assume the same reasoning transfers.

The shell exposes no bridge of its own. The only native surfaces the web app can
reach are the Capacitor plugins the app declares — app lifecycle and deep links,
haptics, keyboard, status bar, and splash screen — and every call through them
is best-effort: a missing plugin, an older shell, or a rejected call degrades to
nothing rather than breaking the chat UI.

Deep links are validated before they are followed, and the shell never holds
credentials of its own. Sessions live in the web view's cookie store for the
configured origin, exactly as they do in a browser.

## Limits

Sharing has no destination picker: the payload lands in the conversation that
is already open, and shared files need a workspace to upload to, so sharing
while signed out or before a workspace is chosen reports that rather than
discarding the payload. The app claims only `text/plain` and `image/*` from the
share sheet. Every other type is left to the apps that handle it, because the
composer's upload path accepts images and claiming more would put ClickClack in
share sheets for files it would then refuse.

Shared bytes cross the bridge in 1 MB chunks rather than as one base64 string.
The web app is served from a real server origin, so it can read neither the
`content://` URI the share sheet produced nor Capacitor's `_capacitor_file_`
route, which sends no `Access-Control-Allow-Origin` header and is therefore
cross-origin. Chunking keeps memory flat and imposes no size limit below the
server's own upload ceiling.

The shell requires a reachable server; there is no offline mode, and a build
without a server URL shows a short page saying so. Sign in with OpenClaw ID is
unavailable in the app until the server grows a native-client handoff for it.

The Android origin guard is Java that only compiles as part of an Android build.
Its rendering, placement and idempotence are covered by tests, and tests assert
that both document-loading callbacks stay origin-checked and that the request
boundary fails closed — but the compiled behaviour is first exercised when you
build the Android project. There is no instrumented WebView regression for it:
that needs an emulator and two HTTPS origins with certificates WebView accepts.
To check it by hand on a device, serve a page on the configured origin that
same-window POSTs a form to another port on the same host; the submission
should fail rather than render, while ordinary in-app links and same-origin
navigation keep working. Notifications are delivered
by Pushover rather than by APNs or FCM, so the app itself registers no push
token and the operating system's own notification settings for ClickClack cover
only what the app raises while running.
