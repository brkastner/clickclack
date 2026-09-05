<script lang="ts">
  import { onMount } from "svelte";
  import {
    botAvatarFiles,
    botAvatarPacks,
    botAvatarPreference,
    loadBotAvatarPacks,
    setBotAvatarPreference,
  } from "../../lib/bot-avatar-packs";

  onMount(() => { void loadBotAvatarPacks(true); });
</script>

<section class="settings-rows" aria-label="Custom bot avatars">
  <h3 class="settings-rows__head">Custom bot avatars</h3>
  <div class="settings-row2 settings-row2--toggle">
    <div class="settings-row2__desc">
      <label class="settings-row2__label" for="custom-bot-avatars">Use custom bot avatars</label>
      <p class="settings-row2__hint">Replace bot avatars on this device only. Human avatars and bot identities are unchanged.</p>
    </div>
    <div class="settings-row2__control settings-row2__control--end">
      <input id="custom-bot-avatars" class="settings-switch" type="checkbox"
        checked={$botAvatarPreference.enabled}
        disabled={$botAvatarPacks.loading || !$botAvatarPacks.packs.length}
        onchange={(event) => setBotAvatarPreference({ ...$botAvatarPreference, enabled: event.currentTarget.checked })} />
    </div>
  </div>
  <div class="settings-row2">
    <div class="settings-row2__desc">
      <label class="settings-row2__label" for="custom-bot-avatar-pack">Avatar pack</label>
      <p class="settings-row2__hint">Images are supplied by the server operator.</p>
    </div>
    <div class="settings-row2__control">
      <select id="custom-bot-avatar-pack" class="settings-input" value={$botAvatarPreference.pack}
        disabled={$botAvatarPacks.loading || !$botAvatarPacks.packs.length || !$botAvatarPreference.enabled}
        onchange={(event) => setBotAvatarPreference({ ...$botAvatarPreference, pack: event.currentTarget.value })}>
        <option value="">Select a pack</option>
        {#if $botAvatarPreference.pack && !$botAvatarPacks.packs.includes($botAvatarPreference.pack)}
          <option value={$botAvatarPreference.pack}>{$botAvatarPreference.pack} (unavailable)</option>
        {/if}
        {#each $botAvatarPacks.packs as pack}<option value={pack}>{pack}</option>{/each}
      </select>
    </div>
  </div>
  {#if $botAvatarPacks.loading}
    <p class="settings-field__hint" role="status">Loading avatar packs…</p>
  {:else if $botAvatarPacks.failed}
    <p class="settings-field__hint" role="status">Avatar packs could not be loaded. Normal bot avatars remain in use.</p>
  {:else if !$botAvatarPacks.packs.length}
    <p class="settings-field__hint" role="status">No avatar packs are available in {$botAvatarPacks.directory || "the server’s configured avatar-packs directory"}. Ask the server operator to add a pack. Normal bot avatars remain in use.</p>
  {:else if $botAvatarPreference.enabled && !$botAvatarFiles.length}
    <p class="settings-field__hint" role="status">The selected pack has no available images. Normal bot avatars remain in use.</p>
  {/if}
</section>
