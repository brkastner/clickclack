<script lang="ts">
  import { resolvedColorMode } from "../../../src/lib/appearance";
  resolvedColorMode.set("dark");
  import SidebarFixture from "../sidebar-disclosure/Fixture.svelte";
  import ConversationPeekModal from "../../../src/components/views/ConversationPeekModal.svelte";
</script>
<div class="app-shell">
  <SidebarFixture />
  <main class="workspace-views">
    <ConversationPeekModal target={{id: "channel", routeID: "channel", kind: "channel", title: "#fixture"}} href="#" onClose={() => {}} />
  </main>
</div>
<style>
  .app-shell { display: grid; grid-template-columns: 320px 1fr; height: 100vh; }
  /* Home is a fixed workspace view beside the shell sidebar. */
  .workspace-views { display: block; }
</style>
