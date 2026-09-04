<script lang="ts">
  import Avatar from "../avatar/Avatar.svelte";
  import {
    personaHeroPositions,
    personaHeroPositionSaveState,
    retryPersonaHeroPositions,
    setPersonaHeroPosition,
  } from "../../lib/appearance";
  import type { User } from "../../lib/types";

  type Props = {
    profile: User;
    canEditIdentity: boolean;
    onBack: () => void;
    onSaveBotProfile: (
      botUserID: string,
      patch: {
        display_name?: string;
        handle?: string;
        avatar_url?: string;
        avatar_url_light?: string;
      },
    ) => Promise<void>;
  };

  let { profile, canEditIdentity, onBack, onSaveBotProfile }: Props = $props();
  let displayName = $state("");
  let handle = $state("");
  let avatarURL = $state("");
  let avatarURLLight = $state("");
  let saving = $state(false);
  let status = $state("");
  let statusError = $state(false);

  $effect(() => {
    displayName = profile.display_name;
    handle = profile.handle ?? "";
    avatarURL = profile.avatar_url ?? "";
    avatarURLLight = profile.avatar_url_light ?? "";
  });

  $effect(() => {
    if (!avatarURL.trim()) avatarURLLight = "";
  });

  const normalizedHandle = $derived(handle.trim().replace(/^@+/, ""));
  const identityDirty = $derived(
    displayName.trim() !== profile.display_name ||
      normalizedHandle !== (profile.handle ?? "") ||
      avatarURL.trim() !== (profile.avatar_url ?? "") ||
      avatarURLLight.trim() !== (profile.avatar_url_light ?? ""),
  );
  const identityValid = $derived(displayName.trim().length > 0);
  const heroPosition = $derived($personaHeroPositions[profile.id] ?? { x: 50, y: 20 });

  function updateHeroPosition(axis: "x" | "y", event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    setPersonaHeroPosition(profile.id, { ...heroPosition, [axis]: value });
  }

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
        avatar_url_light: avatarURLLight.trim(),
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
        <Avatar
          id={profile.id}
          name={displayName || profile.display_name}
          src={avatarURL}
          lightSrc={avatarURLLight}
          size={88}
          loading="eager"
          fetchPriority="auto"
        />
        <div class="profile-editor__avatar-controls">
          <label class="profile-editor__field">
            <span>Default / dark avatar URL</span>
            <input bind:value={avatarURL} placeholder="https://example.com/avatar-dark.png" inputmode="url" aria-label="Default or dark avatar URL" />
          </label>
          {#if avatarURL}<button type="button" class="text-action" onclick={() => (avatarURL = "")}>Remove</button>{/if}
          <label class="profile-editor__field">
            <span>Light mode avatar URL</span>
            <input
              bind:value={avatarURLLight}
              placeholder="https://example.com/avatar-light.png"
              inputmode="url"
              aria-label="Light mode avatar URL"
              disabled={!avatarURL.trim()}
            />
          </label>
          {#if avatarURLLight}<button type="button" class="text-action" onclick={() => (avatarURLLight = "")}>Remove light avatar</button>{/if}
        </div>
      </div>
      <section class="profile-editor__hero-position" aria-label="Sidebar hero crop">
        <Avatar
          class="profile-editor__hero-preview"
          id={profile.id}
          name={displayName || profile.display_name}
          src={avatarURL}
          lightSrc={avatarURLLight}
          size={320}
          loading="eager"
          fetchPriority="auto"
          imagePosition={`${heroPosition.x}% ${heroPosition.y}%`}
        />
        <div class="profile-editor__hero-controls">
          <div class="profile-editor__hero-heading">
            <strong>Sidebar hero crop</strong>
            <button type="button" class="text-action" disabled={heroPosition.x === 50 && heroPosition.y === 20} onclick={() => setPersonaHeroPosition(profile.id, { x: 50, y: 20 })}>Reset</button>
          </div>
          <label class="profile-editor__range">
            <span>Horizontal <output>{heroPosition.x}%</output></span>
            <input type="range" min="0" max="100" value={heroPosition.x} aria-label="Sidebar hero horizontal position" oninput={(event) => updateHeroPosition("x", event)} />
          </label>
          <label class="profile-editor__range">
            <span>Vertical <output>{heroPosition.y}%</output></span>
            <input type="range" min="0" max="100" value={heroPosition.y} aria-label="Sidebar hero vertical position" oninput={(event) => updateHeroPosition("y", event)} />
          </label>
          {#if $personaHeroPositionSaveState === "saving"}
            <p class="profile-editor__hero-save" role="status">Saving crop...</p>
          {:else if $personaHeroPositionSaveState === "error"}
            <p class="profile-editor__hero-save is-error" role="alert">
              Could not save this crop.
              <button type="button" class="text-action" onclick={retryPersonaHeroPositions}>Retry</button>
            </p>
          {/if}
        </div>
      </section>
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
