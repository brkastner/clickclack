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
  let heroDrag = $state<{
    pointerID: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | null>(null);

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
  const heroPosition = $derived({
    x: $personaHeroPositions[profile.id]?.x ?? 50,
    y: $personaHeroPositions[profile.id]?.y ?? 20,
    zoom: $personaHeroPositions[profile.id]?.zoom ?? 118,
  });

  function clampPercent(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function clampHeroX(value: number): number {
    return Math.max(-100, Math.min(200, Math.round(value)));
  }

  function updateHeroZoom(event: Event) {
    const zoom = Number((event.currentTarget as HTMLInputElement).value);
    setPersonaHeroPosition(profile.id, { ...heroPosition, zoom });
  }

  function startHeroPan(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    target.setPointerCapture(event.pointerId);
    heroDrag = {
      pointerID: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: heroPosition.x,
      startY: heroPosition.y,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
  }

  function moveHeroPan(event: PointerEvent) {
    if (!heroDrag || heroDrag.pointerID !== event.pointerId) return;
    setPersonaHeroPosition(profile.id, {
      ...heroPosition,
      x: clampHeroX(heroDrag.startX - ((event.clientX - heroDrag.startClientX) / heroDrag.width) * 200),
      y: clampPercent(heroDrag.startY - ((event.clientY - heroDrag.startClientY) / heroDrag.height) * 100),
    });
  }

  function endHeroPan(event: PointerEvent) {
    if (heroDrag?.pointerID !== event.pointerId) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    heroDrag = null;
  }

  function moveHeroWithKeyboard(event: KeyboardEvent) {
    const delta = event.shiftKey ? 10 : 2;
    const next = { ...heroPosition };
    if (event.key === "ArrowLeft") next.x = clampHeroX(next.x - delta);
    else if (event.key === "ArrowRight") next.x = clampHeroX(next.x + delta);
    else if (event.key === "ArrowUp") next.y = clampPercent(next.y - delta);
    else if (event.key === "ArrowDown") next.y = clampPercent(next.y + delta);
    else return;
    event.preventDefault();
    setPersonaHeroPosition(profile.id, next);
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
        <div
          class="profile-editor__hero-pan"
          class:is-dragging={heroDrag !== null}
          role="img"
          tabindex="0"
          aria-label="Sidebar hero preview. Drag to pan. Use arrow keys for fine adjustment."
          onpointerdown={startHeroPan}
          onpointermove={moveHeroPan}
          onpointerup={endHeroPan}
          onpointercancel={endHeroPan}
          onkeydown={moveHeroWithKeyboard}
        >
          <Avatar
            class="profile-editor__hero-preview"
            id={profile.id}
            name={displayName || profile.display_name}
            src={avatarURL}
            lightSrc={avatarURLLight}
            size={320}
            loading="eager"
            fetchPriority="auto"
            imagePosition={`50% ${heroPosition.y}%`}
            imageOffsetX={50 - heroPosition.x}
            imageScale={heroPosition.zoom / 100}
          />
          <span class="profile-editor__hero-pan-hint" aria-hidden="true">Drag to pan</span>
        </div>
        <div class="profile-editor__hero-controls">
          <div class="profile-editor__hero-heading">
            <strong>Sidebar hero crop</strong>
            <button type="button" class="text-action" disabled={heroPosition.x === 50 && heroPosition.y === 20 && heroPosition.zoom === 118} onclick={() => setPersonaHeroPosition(profile.id, { x: 50, y: 20, zoom: 118 })}>Reset</button>
          </div>
          <label class="profile-editor__range">
            <span>Zoom <output>{heroPosition.zoom}%</output></span>
            <input type="range" min="25" max="250" value={heroPosition.zoom} aria-label="Sidebar hero zoom" oninput={updateHeroZoom} />
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
