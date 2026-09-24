<script lang="ts">
  import ChatApp from "../../../src/ChatApp.svelte";
  import CommandPalette from "../../../src/components/palette/CommandPalette.svelte";
  import { isPaletteShortcut } from "../../../src/lib/command-palette";
  import { toggleCommandPalette } from "../../../src/lib/command-palette-state.svelte";
  let target = $state("general");
  function handleShortcut(event: KeyboardEvent) {
    if (event.defaultPrevented || !isPaletteShortcut(event, false)) return;
    event.preventDefault();
    event.stopPropagation();
    toggleCommandPalette();
  }
</script>
<svelte:window onkeydowncapture={handleShortcut} ontangent-test-navigation={(event) => { target = event.detail.split("/").at(-1); }} />
<ChatApp routeWorkspaceID="w" routeTargetID={target} />
<CommandPalette />
