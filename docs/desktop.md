---
title: Desktop apps
description: Native ClickClack shells for macOS, Windows, and Linux, including packaging, security boundaries, and desktop-only behavior.
---

# Desktop apps

ClickClack ships one Electron desktop client for macOS, Windows, and Linux. It
connects to the hosted service by default and can point at any compatible
self-hosted server. The server remains the source of truth; the desktop client
adds operating-system behavior around the existing web app and API.

## What becomes native

- **Notifications with routing.** Incoming channel and DM notifications use the
  operating system notification center. Clicking one opens its ClickClack
  conversation.
- **Unread state outside the window.** macOS/Linux badges, a Windows taskbar
  overlay, and the tray menu reflect aggregate channel and DM unread counts.
- **Background presence.** Closing the window can keep the realtime connection
  alive in the tray so notifications still arrive. This behavior is configurable.
- **Quick compose.** `Cmd/Ctrl+Shift+K` raises ClickClack and focuses the active
  channel, DM, or thread composer.
- **Deep links.** `clickclack://app/<workspace>/<target>` opens routed workspace,
  channel, DM, and thread URLs in the desktop client.
- **Native downloads and text editing.** Completed downloads reveal themselves
  in the OS file manager. Text fields gain the platform spellchecker and native
  edit menu.
- **Remembered workspace.** Window bounds, maximized state, selected server,
  tray preference, and optional login launch are stored in the platform user-data
  directory.
- **Integrated window chrome.** ClickClack extends into the native title bar:
  macOS traffic lights and Windows/Linux caption controls share one compact row
  with the sidebar toggle, the workspace name (click it for workspace
  settings), the current channel or DM title, and centered message search, all
  on one continuous chrome surface with the rail and sidebar — the conversation
  floats on it as a rounded card with no header row of its own. Desktop
  settings live in the app menu (Cmd/Ctrl+,) and the tray menu, and a
  "Connecting…" note appears beside the channel title only while the realtime
  link is down. The browser app keeps these controls in the normal app header. The
  desktop app checks for this renderer capability before hiding the standard
  frame, so older self-hosted servers retain usable native window chrome. While
  the integrated frame is active, non-app pages open in the system browser so
  the desktop window always keeps its draggable control row.

The desktop shell does not run ClickClack server code, read agent transcripts,
or grant web content filesystem or Node.js access.

## Connect a server

Open **ClickClack → Settings** on macOS or **File → Settings** on Windows/Linux.
Enter the server origin:

```text
https://app.clickclack.chat
https://chat.example.com
http://127.0.0.1:8080
```

Remote servers must use HTTPS. Plain HTTP is accepted only for `localhost`,
`127.0.0.1`, and `::1`. Authentication returns to Electron's persistent browser
session and remains scoped to the selected origin.

GitHub sign-in opens in the system browser, where existing GitHub sessions,
passkeys, password managers, and two-factor authentication already work. After
GitHub approves the login, `chat.clickclack.desktop:/auth/callback` returns a
one-time grant to the running app. The app redeems it against the exact server
that initiated the flow, verifies the resulting session through `/api/me`, and
then reloads itself as the signed-in workspace. The app also accepts the legacy
`clickclack://auth/callback` format when connecting to an older server.

Servers using namespaced cookies require desktop OAuth protocol 2. They return
an update-required page before sending an older desktop client to GitHub.

## Security model

The app loads the selected ClickClack origin with Electron sandboxing,
`contextIsolation`, `webSecurity`, and Node integration disabled. The preload
bridge exposes only bounded notification, unread-count, navigation, and quick-
compose messages. It does not expose arbitrary IPC, shell commands, environment
variables, filesystem access, or credentials.

Navigation stays on the configured ClickClack origin. GitHub OAuth and other
HTTP(S) and mail links open in the system browser. The callback carries only an
opaque, short-lived grant: GitHub access tokens and ClickClack session tokens
never appear in the callback URL. Redemption requires the verifier held by the
initiating app, is single-use, survives server restart or replica handoff, and
expires after five minutes. Permission requests from remote content are denied.
Server configuration is accepted only from the bundled local settings window
and is written atomically with user-only permissions.

## Embedded terminal

The desktop client provides one local terminal session per native main window.
A `BaseWindow` owns sibling `WebContentsView` instances: the configured remote
application and a packaged local terminal surface. The terminal view renders
`@xterm/xterm` with `@xterm/addon-fit`, while Electron main owns the shell through
`node-pty`. The dock is hidden by default. Hiding it preserves the shell;
explicit termination, process exit, or window destruction ends the session.

This stays deliberately small. It does not add tabs, split panes, multiplexing,
persistence across app restarts, remote shells, terminal sharing, a new service,
or an IDE framework.

### Contracts and compatibility

- The page-facing `app-preload.ts` contains no terminal imports, channels,
  methods, output, state, or mount logic. The configured remote renderer cannot
  start a shell, write commands, subscribe to output, or obtain a terminal
  capability.
- The packaged `terminal.html` runs in a separate, non-persistent session with a
  dedicated preload. Its strict content security policy and Electron guards deny
  network access, navigation, popups, downloads, permissions, frames, and
  webviews. It never exposes `clickclackDesktop`.
- Terminal IPC accepts only the exact live terminal `webContents`, its main
  frame, and the canonical local terminal file URL. The application view fails
  every terminal request. File origin alone is never sufficient.
- Electron main owns native bounds, visibility, focus, PTY creation, shell
  selection, process identity, bounded delivery, flow control, and disposal.
  The remote application cannot move, restyle, cover, or activate the terminal
  surface.
- Visibility and process lifetime remain separate. Closing the dock hides it
  without ending the shell. Explicit termination ends it, starting after an exit
  creates a fresh PTY, and closing the Electron window always disposes it.
- The initial target is one local shell per desktop window on macOS, Windows,
  and Linux. Browser behavior, server behavior, the API, the database, the
  protocol, and the SDK do not change.
- Electron, xterm.js, node-pty, operating-system PTY facilities, and the user's
  shell remain external dependencies. ClickClack uses their public interfaces
  and does not assume they can change.

### Implementation

- `apps/desktop/src/terminal-surface.ts` owns the terminal view, lazy
  `TerminalSession`, native layout, focus transitions, sender authorization,
  event delivery, renderer recovery, and idempotent disposal.
- Closed, the application view fills the content area and the terminal view has
  zero bounds, so it cannot cover application or titlebar controls. Open, the
  application view shrinks and the terminal view occupies a 220 to 380 pixel
  bottom dock. The terminal view remains the top sibling.
- `apps/desktop/src/terminal-preload.ts` exposes only the bounded local terminal
  client to `terminal.html`. `terminal-dock.tsx` mounts only into
  `#terminal-root`; it never queries or mutates the remote document.
- First presentation fits xterm, sends measured rows and columns, focuses xterm,
  and starts the shell lazily before announcing renderer readiness. Native
  terminal `webContents` focus happens first so main can bound and queue keyboard
  input during renderer startup, then replay it after xterm owns focus. Closing
  restores application focus without terminating the shell.
- `Cmd/Ctrl+J` or the native View menu toggles the terminal. Quick Compose hides
  it and focuses the application. Reload, force reload, and zoom menu actions
  always target the
  application view.
- Terminal copy and paste stay in the local view. Windows and Linux use
  `Ctrl+Shift+C/V`; macOS uses `Cmd+C/V`. Plain `Ctrl+C` remains PTY input.
  Clipboard text and PTY input are bounded.
- PTY output uses one acknowledged IPC chunk at a time. Main pauses `node-pty` at
  the high-water mark, resumes below the low-water mark, and terminates the shell
  if its one-megabyte delivery buffer is exceeded.
- `node-pty` stays external to the esbuild bundle, is unpacked from the
  application archive, and is rebuilt for the pinned Electron version.

### Verification

- `pnpm test:desktop` covers terminal payload validation, PTY lifecycle and flow
  control, pure native layout, exact sender authorization, application sender
  rejection, two-owner isolation, hide and reopen behavior, renderer recovery,
  and final disposal.
- Source checks keep terminal code out of `app-preload.ts`, require the local
  `#terminal-root`, reject remote selectors and shadow roots, enforce first-open
  ordering, and preserve xterm write acknowledgements.
- `pnpm --filter @clickclack/desktop smoke:terminal:isolation` loads the real
  terminal document, preload, React renderer, and xterm inside a sibling
  `WebContentsView`. It sends a printable key immediately after opening, checks
  delivery to the PTY owner, verifies that keyboard, input, composition,
  selection, and clipboard events never reach an adversarial application view,
  and covers hide, reopen, renderer reload, disjoint bounds, and native window
  destruction.
- `pnpm --filter @clickclack/desktop smoke:terminal` exercises `node-pty` under
  the pinned Electron runtime. The packaged smoke loads it from `app.asar`,
  verifies the terminal HTML, preload, renderer, and stylesheet resources, and
  runs a real PTY marker command.
- Manual verification opens the panel, runs an interactive command, checks local
  copy and paste, resizes the window, hides and reopens the panel with the session
  intact, terminates and restarts it, and closes the app without leaving a shell
  process alive.
- macOS, Windows, and Linux packaging jobs run the isolation and packaged native
  smokes before uploading installers.

### Risks and handling

- `node-pty` may fail to rebuild, sign, or package against an Electron ABI. Pin a
  compatible release, use the existing rebuild path, externalize it, and require
  the three-platform package matrix plus a current-platform packaged smoke test.
- Sharing a document with remote page JavaScript would expose composed keyboard,
  input, selection, and clipboard events and permit clickjacking. Keep the
  terminal in its sibling local `WebContentsView`; shadow DOM is not a security
  boundary.
- Repeated hide and open cycles could duplicate subscriptions, lose output, or
  end the shell. Keep process lifetime in main, make start idempotent, attach
  subscriptions once, and keep xterm mounted while the dock is visually hidden.
- Unbounded output could exhaust Electron or xterm queues. Keep delivery
  acknowledgement-based, pause and resume the PTY at fixed watermarks, and fail
  closed at the hard buffer limit.
- A full renderer reload discards xterm scrollback while leaving the PTY alive.
  This is intentional: hidden-time output is preserved during normal dock use,
  but terminal history is not persisted or replayed across renderer lifetimes.
- Resize observations could flood IPC or send invalid dimensions. Fit only after
  the dock is measurable, clamp rows and columns in both processes, and skip
  unchanged or transient resize events.
- A configured shell may be missing, exit immediately, or fail through its own
  startup files. Use conservative platform fallbacks and show a bounded error or
  exited state with restart. Do not interpret output or modify user settings.

### Boundaries

The remote Svelte and React application does not render terminal output, manage
its lifecycle, receive its IPC client, or share its DOM event boundary. The
terminal is a packaged local document presented by a native sibling view. It is
not part of `examples/assistant-ui-island-prototype`, `PinnedPanelIsland.tsx`, or
`ImageViewerIsland.tsx`.

This feature does not change API handlers, database schemas or migrations,
OpenAPI, SDK behavior, bot features, hosted infrastructure, or external
services. It does not change Electron, xterm.js, node-pty, operating-system
terminals or PTY facilities, shells, signing systems, or package toolchains.

It does not embed or reparent Terminal.app, Windows Terminal, or Linux terminal
emulator windows. It does not build a terminal emulator, PTY implementation,
shell parser, command-runner abstraction, or platform window manager. It does
not add tabs, split panes, multiplexing, persisted sessions, a command-history
service, remote shells, terminal sharing, workspace-specific shell settings, or
a general IDE framework. Ordinary browser sessions receive no terminal
capability, generic Node.js access, or raw IPC access.

No new service, resource, repository, test framework, or rollout mechanism is
part of this work. The implementation reuses the current monorepo, Electron
bridge patterns, package pipeline, and release matrix.

## Build locally

Install workspace dependencies, then build or run the desktop package:

```sh
pnpm install
pnpm build:desktop
pnpm dev:desktop
```

Rebuild and exercise the native PTY under Electron, then create an unpacked app
for the current platform:

```sh
pnpm --filter @clickclack/desktop run smoke:terminal:isolation
pnpm --filter @clickclack/desktop run smoke:terminal
pnpm --filter @clickclack/desktop run verify:pack
```

Create installers on their native CI runner:

```sh
pnpm --filter @clickclack/desktop run dist:mac
pnpm --filter @clickclack/desktop run dist:win
pnpm --filter @clickclack/desktop run dist:linux
```

Pull requests run a three-platform desktop workflow and attach explicitly
unsigned preview installers for seven days. Official macOS release candidates
are built on an authorized maintainer Mac from the exact signed tag, signed
inside-out with the OpenClaw Foundation Developer ID identity and hardened
runtime, notarized, stapled, and uploaded to a private draft. The release
workflow independently verifies their checksums, bundle seals, stable bundle
identifier, Foundation team, Gatekeeper assessment, and notarization tickets
before publishing them alongside the Windows and Linux installers.

## Icon system

`apps/desktop/assets/icon-source.svg` is the source of truth: opposing claws for
conversation, a central aqua realtime pulse, and ClickClack coral. Generated
assets include multi-resolution macOS `.icns`, Windows `.ico`, Linux PNG, a
monochrome macOS tray template, and a Windows unread overlay.
