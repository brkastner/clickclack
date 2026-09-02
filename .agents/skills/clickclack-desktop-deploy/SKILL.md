---
name: clickclack-desktop-deploy
description: Build, package, install, launch, update, or verify the ClickClack desktop application from this repository. Use when the user asks whether ClickClack is installed or ready, wants the desktop app deployed locally, or requests an end-to-end desktop build.
---

# ClickClack desktop deployment

Take the local checkout all the way from source to a verified desktop application. A dependency install or successful bundle is not an application install.

## 1. Establish the target

Read the repository scripts and desktop builder configuration before acting. Detect the current operating system, architecture, desktop session, existing ClickClack processes, and prior installation path.

Completion criterion: the supported package format and local installation path are known from current repository and host evidence.

## 2. Prepare the toolchain

Load nvm, install and activate the Node major required by `package.json`, and make that major the nvm default when the user asked for a durable local setup. Use the repository's pinned pnpm version and install with the frozen lockfile.

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24
nvm alias default 24
pnpm install --frozen-lockfile
```

Report the observed Node and pnpm versions, not the requested versions.

Completion criterion: the supported Node version is active and the frozen-lockfile install succeeds.

## 3. Run the release gate

Run `pnpm check`. Treat warnings as unfinished work when they are actionable in the current checkout. Fix them narrowly, format touched files, and rerun the complete gate after the final source change.

Completion criterion: the final `pnpm check` exits zero without actionable lint or formatting warnings.

## 4. Package the desktop app

Use the platform script exposed by `apps/desktop/package.json`.

- Linux x86_64: `pnpm --filter @clickclack/desktop dist:linux`
- macOS: use the local distribution script for unsigned development packages; use the release script only when signing and notarization credentials are available.
- Windows: `pnpm --filter @clickclack/desktop dist:win`

Package from the current validated source. Never reuse an older artifact merely because it exists in `apps/desktop/release/`.

Completion criterion: a fresh native installer or AppImage exists and its file type, size, timestamp, and SHA-256 digest have been checked.

## 5. Install on Linux

Choose the host-native target. Debian-family systems may install the generated `.deb`. Arch-family systems, including CachyOS, use the AppImage as a per-user installation.

Before writing anything under `~/.local/bin`, inspect existing paths and running service command lines. The ClickClack server commonly owns `~/.local/bin/clickclack`; preserve that binary and service path.

For an AppImage installation:

1. Install it at `~/.local/opt/clickclack/ClickClack.AppImage` with mode `0755`.
2. Point `~/.local/bin/clickclack-desktop` at that file. Leave `~/.local/bin/clickclack` untouched when it belongs to the server CLI.
3. Install `apps/desktop/assets/icon.png` under the user icon theme.
4. Create `~/.local/share/applications/clickclack.desktop` with the desktop executable, `Network;InstantMessaging;` categories, and both ClickClack protocol MIME handlers.
5. Refresh the desktop database when available and register the protocol handlers with `xdg-mime`.

Use absolute paths in the desktop entry. Validate the entry when `desktop-file-validate` is available. Warnings caused by unrelated existing desktop files do not invalidate a valid ClickClack entry.

Completion criterion: the installed executable resolves to the fresh package, the desktop entry validates, and `xdg-mime` reports `clickclack.desktop` for `x-scheme-handler/clickclack`.

## 6. Launch and prove it

Launch the installed executable, not the repository's Electron development command. Preserve its stdout and stderr in a temporary log. Verify both:

- the installed executable remains running after startup;
- the current desktop environment reports a ClickClack window when it exposes a query interface, such as `hyprctl clients -j` on Hyprland.

Inspect the startup log if the process exits. Fix packaging, FUSE, sandbox, library, or desktop-entry failures before retrying. Use `--appimage-extract-and-run` only as a documented host compatibility fallback, not as the default launcher.

Completion criterion: the installed process is alive and its desktop window is observed, or a precise environmental blocker is reported with the failing command and error.

## 7. Report actual state

State separately whether dependencies are installed, checks pass, packages exist, the application is installed, and the installed application launched successfully. Include the executable path, desktop-entry path, package digest, and any non-blocking build notices.
