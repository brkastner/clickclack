<script lang="ts">
  import ChatApp from "../../../src/ChatApp.svelte";
  let target = $state("clickclack");
  let generation = $state(0);
</script>
<svelte:window ontangent-test-navigation={(event) => { target = event.detail.split("/").at(-1); }} ontangent-test-remount={() => { generation += 1; }} />
{#key generation}<ChatApp routeWorkspaceID="w" routeTargetID={target} />{/key}
