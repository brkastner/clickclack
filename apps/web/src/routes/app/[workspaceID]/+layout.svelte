<script lang="ts">
  import MobileBottomNavigation from "../../../components/navigation/MobileBottomNavigation.svelte";

  let { children } = $props();
</script>

{@render children?.()}
<MobileBottomNavigation />
