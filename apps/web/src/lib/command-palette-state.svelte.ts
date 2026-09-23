// Open state and command providers for the command palette.
//
// The palette itself is mounted once per workspace layout. Anything that knows
// about commands registers a provider while it's on screen: chat contributes
// channels, direct messages and chat actions; the settings pages contribute
// their sections. Providers are plain functions that are read every time the
// palette renders, so a legacy component can register a closure over its own
// variables and the palette still sees current values.

import { SvelteMap } from "svelte/reactivity";
import type { PaletteCommand } from "./command-palette";

export type PaletteProvider = () => PaletteCommand[];

const providers = new SvelteMap<string, PaletteProvider>();

export const commandPalette = $state({
  open: false,
  // Bumped whenever the palette opens, so it can reset its query and selection
  // even when it's reopened without having been unmounted.
  session: 0,
});

export function openCommandPalette() {
  if (commandPalette.open) return;
  commandPalette.session += 1;
  commandPalette.open = true;
}

export function closeCommandPalette() {
  commandPalette.open = false;
}

export function toggleCommandPalette() {
  if (commandPalette.open) closeCommandPalette();
  else openCommandPalette();
}

/**
 * Offer commands while the caller is mounted. Registering again under the same
 * key replaces the earlier provider. Returns the unregister function.
 */
export function registerPaletteProvider(key: string, provider: PaletteProvider): () => void {
  providers.set(key, provider);
  return () => {
    if (providers.get(key) === provider) providers.delete(key);
  };
}

export function hasPaletteProvider(key: string): boolean {
  return providers.has(key);
}

/** Every registered command, most recently registered provider first. */
export function paletteCommands(): PaletteCommand[] {
  const commands: PaletteCommand[] = [];
  for (const provider of [...providers.values()].reverse()) {
    try {
      commands.push(...provider());
    } catch (error) {
      // One broken provider shouldn't take the whole palette down.
      console.error("command palette provider failed", error);
    }
  }
  return commands;
}
