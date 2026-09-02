<script lang="ts">
  import Avatar from "../avatar/Avatar.svelte";
  import type { User } from "../../lib/types";

  type Props = {
    profile: User;
    canEditIdentity: boolean;
    onBack: () => void;
    onSaveBotProfile: (
      botUserID: string,
      patch: { display_name?: string; handle?: string; avatar_url?: string },
    ) => Promise<void>;
  };

  let { profile, canEditIdentity, onBack, onSaveBotProfile }: Props = $props();
  let displayName = $state("");
  let handle = $state("");
  let avatarURL = $state("");
  let saving = $state(false);
  let status = $state("");
  let statusError = $state(false);

  $effect(() => {
    displayName = profile.display_name;
    handle = profile.handle ?? "";
    avatarURL = profile.avatar_url ?? "";
  });

  const normalizedHandle = $derived(handle.trim().replace(/^@+/, ""));
  const identityDirty = $derived(
    displayName.trim() !== profile.display_name ||
      normalizedHandle !== (profile.handle ?? "") ||
      avatarURL.trim() !== (profile.avatar_url ?? ""),
  );
  const identityValid = $derived(displayName.trim().length > 0);

  async function saveIdentity() {
    if (saving || !identityDirty || !identityValid) return;
    saving = true;
    status = "";
    statusError = false;
    try {
      await onSaveBotProfile(profile.id, {
        display_name: displayName.trim(),
        handle: normalizedHandle ? `@${normalizedHandle}` : "",
        avatar_url: avatarURL.trim(),
      });
      status = "Saved";
    } catch (error) {
      status = error instanceof Error ? error.message : "Could not save profile";
      statusError = true;
    } finally {
      saving = false;
    }
  }
</script>

<div class="profile-editor">
  <header class="profile-editor__head">
    <button type="button" class="text-action" onclick={onBack}>← Back</button>
    <strong>Editing {profile.display_name}</strong>
  </header>

  <div class="profile-editor__body">
    {#if !canEditIdentity}
      <p class="profile-note">You do not have permission to edit this profile.</p>
    {:else}
      <div class="profile-editor__avatar-row">
        <Avatar id={profile.id} name={displayName || profile.display_name} src={avatarURL} size={88} loading="eager" fetchPriority="auto" />
        <div class="profile-editor__avatar-controls">
          <label class="profile-editor__field">
            <span>Avatar URL</span>
            <input bind:value={avatarURL} placeholder="https://example.com/avatar.png" inputmode="url" aria-label="Avatar URL" />
          </label>
          {#if avatarURL}<button type="button" class="text-action" onclick={() => (avatarURL = "")}>Remove</button>{/if}
        </div>
      </div>
      <label class="profile-editor__field">
        <span>Display name</span>
        <input bind:value={displayName} maxlength="80" aria-label="Display name" />
      </label>
      <label class="profile-editor__field">
        <span>Handle</span>
        <input bind:value={handle} placeholder="handle" aria-label="Handle" autocomplete="off" />
      </label>
      <div class="profile-editor__actions">
        <button type="button" class="primary-action" disabled={saving || !identityDirty || !identityValid} onclick={() => void saveIdentity()}>
          {saving ? "Saving..." : "Save identity"}
        </button>
      </div>
    {/if}
    {#if status}<p class="profile-editor__status" class:is-error={statusError} role="status">{status}</p>{/if}
  </div>
</div>
