<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import MobileBottomNavigation from "../../../components/navigation/MobileBottomNavigation.svelte";
  import CommandPalette from "../../../components/palette/CommandPalette.svelte";
  import { resolvedColorMode, setColorMode } from "$lib/appearance";
  import { isPaletteShortcut } from "$lib/command-palette";
  import { themeCommand, viewCommands } from "$lib/command-palette-commands";
  import { registerPaletteProvider, toggleCommandPalette } from "$lib/command-palette-state.svelte";

  let { children } = $props();

  const workspaceID = $derived(page.params.workspaceID ?? "");

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    const mac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
    if (!isPaletteShortcut(event, mac)) return;
    // Takes the chord even from the composer: nothing else binds it, and the
    // palette should be one keystroke away wherever focus is.
    event.preventDefault();
    event.stopPropagation();
    toggleCommandPalette();
  }

  onMount(() =>
    registerPaletteProvider("workspace", () => [
      ...viewCommands(workspaceID, page.url.pathname, (href) => goto(href)),
      themeCommand(get(resolvedColorMode), setColorMode),
    ]),
  );
</script>

<svelte:window onkeydowncapture={handleWindowKeydown} />

{@render children?.()}
<MobileBottomNavigation />
<CommandPalette {workspaceID} />
