<script lang="ts">
  import Avatar from "../avatar/Avatar.svelte";
  import type { ProfilePersonaLane } from "../../lib/chat/people";
  import type { User } from "../../lib/types";

  type Props = {
    profile: User;
    personaLanes: ProfilePersonaLane[];
    canEditIdentity: boolean;
    canEditPersonas: boolean;
    onBack: () => void;
    onSaveBotProfile: (
      botUserID: string,
      patch: { display_name?: string; handle?: string; avatar_url?: string },
    ) => Promise<void>;
    onSavePersonaLane: (
      botUserID: string,
      channelID: string,
      presentation: { display_name: string; avatar_url: string },
    ) => Promise<void>;
  };

  let {
    profile,
    personaLanes,
    canEditIdentity,
    canEditPersonas,
    onBack,
    onSaveBotProfile,
    onSavePersonaLane,
  }: Props = $props();

  type StepID = "identity" | "personas";
  const steps = $derived.by<{ id: StepID; label: string }[]>(() => {
    const list: { id: StepID; label: string }[] = [];
    if (canEditIdentity) list.push({ id: "identity", label: "identity" });
    if (canEditPersonas && personaLanes.length > 0) list.push({ id: "personas", label: "personas" });
    return list;
  });

  let step = $state<StepID>("identity");
  let displayName = $state("");
  let handle = $state("");
  let avatarURL = $state("");
  let laneDrafts = $state<Record<string, { display_name: string; avatar_url: string }>>({});
  let saving = $state(false);
  let status = $state("");
  let statusError = $state(false);

  // Reset every draft when the pane switches to a different profile, or when
  // the server hands back an updated record after a save.
  $effect(() => {
    displayName = profile.display_name;
    handle = profile.handle ?? "";
    avatarURL = profile.avatar_url ?? "";
  });

  $effect(() => {
    const drafts: Record<string, { display_name: string; avatar_url: string }> = {};
    for (const lane of personaLanes) {
      drafts[lane.channel_id] = { display_name: lane.display_name, avatar_url: lane.avatar_url };
    }
    laneDrafts = drafts;
  });

  $effect(() => {
    if (!steps.some((candidate) => candidate.id === step)) {
      step = steps[0]?.id ?? "identity";
    }
  });

  const normalizedHandle = $derived(handle.trim().replace(/^@+/, ""));
  const identityDirty = $derived(
    displayName.trim() !== profile.display_name ||
      normalizedHandle !== (profile.handle ?? "") ||
      avatarURL.trim() !== (profile.avatar_url ?? ""),
  );
  const identityValid = $derived(displayName.trim().length > 0);

  function laneDirty(lane: ProfilePersonaLane): boolean {
    const draft = laneDrafts[lane.channel_id];
    if (!draft) return false;
    return draft.display_name !== lane.display_name || draft.avatar_url !== lane.avatar_url;
  }

  // A lane whose label matches the bot's own display name is that bot's
  // canonical identity, so renaming the bot renames the sidebar group too.
  const canonicalLane = $derived(personaLanes.find((lane) => lane.is_canonical));
  const renamingCanonical = $derived(
    Boolean(canonicalLane) && displayName.trim() !== profile.display_name,
  );

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

  async function saveLane(lane: ProfilePersonaLane) {
    const draft = laneDrafts[lane.channel_id];
    if (saving || !draft || !laneDirty(lane) || !draft.display_name.trim()) return;
    saving = true;
    status = "";
    statusError = false;
    try {
      await onSavePersonaLane(profile.id, lane.channel_id, {
        display_name: draft.display_name.trim(),
        avatar_url: draft.avatar_url.trim(),
      });
      status = `Saved #${lane.channel_name}`;
    } catch (error) {
      status = error instanceof Error ? error.message : "Could not save persona";
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

  {#if steps.length > 1}
    <nav class="profile-editor__steps" aria-label="Profile editor sections">
      {#each steps as item (item.id)}
        <button
          type="button"
          class="profile-editor__step"
          class:is-active={step === item.id}
          aria-current={step === item.id ? "true" : undefined}
          onclick={() => (step = item.id)}
        >
          {item.label}
        </button>
      {/each}
    </nav>
  {/if}

  <div class="profile-editor__body">
    {#if steps.length === 0}
      <p class="profile-note">You do not have permission to edit this profile.</p>
    {:else if step === "identity"}
      <div class="profile-editor__avatar-row">
        <Avatar
          id={profile.id}
          name={displayName || profile.display_name}
          src={avatarURL}
          size={88}
          loading="eager"
          fetchPriority="auto"
        />
        <div class="profile-editor__avatar-controls">
          <label class="profile-editor__field">
            <span>Avatar URL</span>
            <input
              bind:value={avatarURL}
              placeholder="https://example.com/avatar.png"
              inputmode="url"
              aria-label="Avatar URL"
            />
          </label>
          {#if avatarURL}
            <button type="button" class="text-action" onclick={() => (avatarURL = "")}>Remove</button>
          {/if}
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

      {#if renamingCanonical}
        <p class="profile-note">
          #{canonicalLane?.channel_name} uses this bot's own name, so renaming it here also renames
          that sidebar group.
        </p>
      {/if}

      <div class="profile-editor__actions">
        <button
          type="button"
          class="primary-action"
          disabled={saving || !identityDirty || !identityValid}
          onclick={() => void saveIdentity()}
        >
          {saving ? "Saving..." : "Save identity"}
        </button>
      </div>
    {:else}
      <p class="profile-note">
        Each persona is a channel-scoped face for this bot. The underlying identity, handle,
        mentions, and permissions stay the same.
      </p>
      {#each personaLanes as lane (lane.channel_id)}
        <section class="profile-editor__lane">
          <header>
            <Avatar
              id={lane.channel_id}
              name={laneDrafts[lane.channel_id]?.display_name || lane.display_name}
              src={laneDrafts[lane.channel_id]?.avatar_url ?? lane.avatar_url}
              size={36}
            />
            <div>
              <strong>{lane.display_name}</strong>
              <small>#{lane.channel_name}{lane.is_canonical ? " · canonical" : ""}</small>
            </div>
          </header>
          {#if laneDrafts[lane.channel_id]}
            <label class="profile-editor__field">
              <span>Name in #{lane.channel_name}</span>
              <input
                bind:value={laneDrafts[lane.channel_id]!.display_name}
                aria-label={`Name in ${lane.channel_name}`}
              />
            </label>
            <label class="profile-editor__field">
              <span>Avatar URL in #{lane.channel_name}</span>
              <input
                bind:value={laneDrafts[lane.channel_id]!.avatar_url}
                placeholder="https://example.com/avatar.png"
                inputmode="url"
                aria-label={`Avatar URL in ${lane.channel_name}`}
              />
            </label>
            <div class="profile-editor__actions">
              <button
                type="button"
                class="primary-action"
                disabled={saving || !laneDirty(lane) || !laneDrafts[lane.channel_id]!.display_name.trim()}
                onclick={() => void saveLane(lane)}
              >
                {saving ? "Saving..." : "Save persona"}
              </button>
            </div>
          {/if}
        </section>
      {/each}
    {/if}

    {#if status}
      <p class="profile-editor__status" class:is-error={statusError} role="status">{status}</p>
    {/if}
  </div>
</div>
