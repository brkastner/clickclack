<script lang="ts">
  import BotRuntimeStatus from "../../../src/components/composer/BotRuntimeStatus.svelte";
  import PiModelsSection from "../../../src/components/settings/PiModelsSection.svelte";
  let kind = $state<"channels" | "dms">("channels");
</script>
<main style="padding: 24px;">
  <label>draft <textarea aria-label="draft">keep this draft</textarea></label>
  <div style="display: flex; margin-top: 240px;">
    <BotRuntimeStatus target={{ kind, id: "test", botUserID: "pi" }} />
  </div>
  <button type="button" onclick={() => kind = kind === "channels" ? "dms" : "channels"}>switch conversation</button>
  <PiModelsSection />
</main>
