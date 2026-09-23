<script lang="ts">
  import { onMount } from "svelte";

  type Props = {
    name: string;
    pending: boolean;
    error: string;
    available: boolean;
    onName: (value: string) => void;
    onClose: () => void;
    onRename: () => void;
  };

  let { name, pending, error, available, onName, onClose, onRename }: Props = $props();
  let input: HTMLInputElement;
  onMount(() => { input?.focus(); input?.select(); });
</script>

<div class="modal-scrim" role="presentation">
  <button class="modal-backdrop" type="button" aria-label="Close rename channel dialog" onclick={onClose}></button>
  <div class="profile-modal create-modal" role="dialog" aria-modal="true" aria-label="Rename channel">
    <header>
      <div><p>Channels</p><h2>Rename channel</h2></div>
      <button type="button" aria-label="Close rename channel dialog" onclick={onClose}>×</button>
    </header>
    <form class="profile-form" onsubmit={(event) => { event.preventDefault(); onRename(); }}>
      <label class="field">
        <span>Channel name</span>
        <input bind:this={input} value={name} disabled={pending} aria-label="Channel name" autocomplete="off"
          aria-invalid={Boolean(name.trim()) && !available}
          oninput={(event) => onName(event.currentTarget.value)} />
      </label>
      {#if name.trim() && !available}<p class="profile-status error" role="alert">That channel name is already in use.</p>{/if}
      {#if error}<p class="profile-status error" role="alert">{error}</p>{/if}
      <div class="profile-actions">
        <button type="button" class="ghost-action" onclick={onClose}>Cancel</button>
        <button type="submit" class="primary-action" disabled={pending || !available}>{pending ? "Renaming…" : "Rename channel"}</button>
      </div>
    </form>
  </div>
</div>
