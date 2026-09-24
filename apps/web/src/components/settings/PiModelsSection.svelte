<script lang="ts">
  import { DEFAULT_PI_MODELS, PI_MODELS_KEY, loadPiModels, validatePiModels } from "../../lib/pi-model-controls";
  let models = $state(loadPiModels());
  let notice = $state("");
  let failed = $state(false);
  function save() {
    try {
      const validated = validatePiModels(models);
      localStorage.setItem(PI_MODELS_KEY, JSON.stringify(validated));
      models = validated;
      window.dispatchEvent(new Event("pi-models-changed"));
      notice = "model list saved.";
      failed = false;
    } catch (error) {
      notice = error instanceof Error ? error.message : "couldn't save models.";
      failed = true;
    }
  }
</script>

<section class="pi-models" aria-label="Pi models">
  <h3>Pi models</h3>
  <p>choose which models appear in the composer. this list is saved on this device.</p>
  {#each models as model, index}
    <div class="pi-models__row">
      <label>label <input aria-label={`model ${index + 1} label`} bind:value={model.label} /></label>
      <label>model id <input aria-label={`model ${index + 1} id`} bind:value={model.id} spellcheck="false" /></label>
      <button type="button" class="ghost-action" aria-label={`remove model ${index + 1}`} onclick={() => models = models.filter((_, i) => i !== index)}>remove</button>
    </div>
  {/each}
  <div class="profile-actions">
    <button type="button" class="ghost-action" onclick={() => models = [...models, { label: "", id: "" }]}>add model</button>
    <button type="button" class="ghost-action" onclick={() => models = DEFAULT_PI_MODELS.map(model => ({ ...model }))}>reset defaults</button>
    <button type="button" class="ghost-action" onclick={save}>save models</button>
  </div>
  {#if notice}<p role="status" class:failed>{notice}</p>{/if}
</section>

<style>
  .pi-models { margin-top: 24px; border-top: 1px solid var(--line-strong); padding-top: 16px; }
  h3 { font-size: 16px; color: var(--text-strong); }
  p { color: var(--muted); font-size: 13px; }
  .pi-models__row { display: flex; align-items: end; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
  label { display: grid; gap: 4px; min-width: 0; flex: 1 1 160px; font-size: 12px; color: var(--muted); }
  input { width: 100%; min-width: 0; box-sizing: border-box; padding: 8px; background: var(--panel); color: var(--text-strong); border: 1px solid var(--line-strong); border-radius: 6px; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .failed { color: var(--danger); }
</style>
