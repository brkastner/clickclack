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

## Embedded terminal plan

The desktop client will add one local terminal session per Electron window. The
terminal uses `node-pty` in the privileged main process and `@xterm/xterm` with
`@xterm/addon-fit` in a bottom-docked Svelte panel. The dock is hidden and
unmounted by default. Hiding it preserves the shell, while explicit termination
or window shutdown cleans it up.

This stays deliberately small. It does not add tabs, split panes, multiplexing,
persistence across app restarts, remote shells, terminal sharing, a new service,
or an IDE framework.

### Contracts and compatibility

- The renderer bridge gains an optional desktop-only `terminal` capability.
  Browser callers continue to work when that property is absent.
- The IPC contract is limited to `start`, `status`, `write`, `resize`,
  `terminate`, `data`, and `exit`. Inputs are typed and validated. Generic
  process spawning, shell strings, environment mutation, filesystem access,
  Node.js access, and raw IPC do not cross the preload boundary.
- Electron owns PTY creation, shell selection, process identity, and disposal.
  Svelte owns panel visibility, xterm rendering, focus, and measured rows and
  columns.
- Visibility and process lifetime remain separate. Closing the dock hides it
  without ending the shell. Explicit termination ends it, starting after an exit
  creates a fresh PTY, and closing the Electron window always disposes it.
- The initial target is one local shell per desktop window on macOS, Windows,
  and Linux. Browser behavior, server behavior, the API, the database, the
  protocol, and the SDK do not change.
- Electron, xterm.js, node-pty, operating-system PTY facilities, and the user's
  shell remain external dependencies. ClickClack uses their public interfaces
  and does not assume they can change.

### Implementation plan

1. Add `node-pty` as a packaged dependency of `apps/desktop`. Add
   `@xterm/xterm` and `@xterm/addon-fit` to `apps/web`. Update the root lockfile,
   keep `node-pty` external to the browser bundle, and use the existing
   Electron and electron-builder paths to rebuild and package its native binary.
   A clean install, `pnpm build:desktop`, and a packaged-directory smoke build
   must prove that the module loads on the current platform.
2. Add a focused PTY owner under `apps/desktop/src/` and connect it from
   `apps/desktop/src/main.ts`. It chooses the user's platform shell with
   conservative fallbacks, owns one PTY per window, forwards data and exit
   events, validates bounded input and dimensions, preserves the PTY while the
   panel is hidden, supports explicit termination and restart, and cleans up
   idempotently with the window. IPC handlers use the existing main-sender
   validation pattern.
3. Extend `apps/desktop/src/app-preload.ts` and
   `apps/web/src/lib/desktop.ts` with the optional terminal bridge. Expose only
   start/status, write, resize, terminate, and data/exit subscriptions. Each
   subscription returns an unsubscribe function, and payloads are checked on
   both sides.
4. Add `apps/web/src/components/terminal/TerminalDock.svelte`. Use xterm.js and
   FitAddon, mount only when opened, wire each input and output subscription
   once, fit through `ResizeObserver`, show starting, running, exited, and error
   states, and provide close, terminate, and restart controls. Opening focuses
   the terminal. Unmounting disposes renderer observers and listeners but does
   not terminate the PTY.
5. Add non-persisted `terminalOpen = false` state to
   `apps/web/src/ChatApp.svelte`. Render the dock as the final row beneath the
   conversation only when the preload advertises terminal support. Put a clear,
   labeled toggle in `DesktopTitlebar.svelte` or the nearest existing desktop
   action surface. Reuse the existing colors, borders, controls, focus styles,
   and responsive layout. The closed state reserves no space.
6. Add focused tests through the existing desktop and web test runners. Prefer
   unit and contract tests. Add an end-to-end test only if the current harness
   already supports the Electron preload boundary. Do not add a test framework.
7. Update this document with the shipped behavior. Use the existing macOS,
   Windows, and Linux desktop release matrix for rollout. Change those jobs only
   when an explicit native-module rebuild or package smoke check is required.
   No data migration, server rollout, feature service, or API migration applies.

### Verification

- Dependency and build checks prove `node-pty` is externalized, rebuilt for
  Electron, packaged, and loadable.
- PTY owner tests cover spawn, duplicate start, data, input, resize, exit,
  restart, terminate, invalid payloads, invalid senders, window cleanup, and
  idempotent disposal without orphan processes.
- Preload contract tests cover the exact allowed methods and channels, payload
  validation, subscription cleanup, and the missing capability in browser mode.
- Terminal UI tests cover the hidden default, capability gating, opening and
  focus, fitting and resize, input and output, hide without termination,
  explicit termination and restart, failure states, and listener cleanup.
- A layout regression test proves the open panel stays below the conversation
  and the closed panel leaves no empty area.
- A manual desktop smoke test opens the panel, runs an interactive command,
  resizes it, hides and reopens it with the session intact, terminates and
  restarts it, and closes the app without leaving a shell process alive.
- `pnpm test:desktop`, web tests and typechecking, lint, formatting, and
  `pnpm check` pass without weakened checks.
- The existing macOS, Windows, and Linux release jobs provide packaging evidence
  before rollout is complete.

### Risks and handling

- `node-pty` may fail to rebuild, sign, or package against an Electron ABI. Pin a
  compatible release, use the existing rebuild path, externalize it, and require
  the three-platform package matrix plus a current-platform packaged smoke test.
- An overly broad IPC bridge could let compromised renderer content run local
  processes. Keep shell selection and PTY ownership in main, validate every
  sender and payload, and never accept executable paths, commands, environment
  maps, or arbitrary channels from the renderer.
- Repeated hide and open cycles could duplicate subscriptions, lose output, or
  end the shell. Keep process lifetime in main, make start idempotent, return
  unsubscribe functions, dispose renderer resources on unmount, and test the
  cycle directly.
- Resize observations could flood IPC or send invalid dimensions. Fit only after
  the dock is measurable, clamp rows and columns in both processes, and skip
  unchanged or transient resize events.
- A configured shell may be missing, exit immediately, or fail through its own
  startup files. Use conservative platform fallbacks and show a bounded error or
  exited state with restart. Do not interpret output or modify user settings.
- Existing uncommitted work touches nearby files. Use targeted edits, preserve
  unrelated changes, inspect each diff, and keep terminal work in new modules
  and components where practical.

### Boundaries

This plan does not change API handlers, database schemas or migrations,
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

Create an unpacked app for the current platform:

```sh
pnpm --filter @clickclack/desktop run pack
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
