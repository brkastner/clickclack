<script lang="ts">
  import Avatar from "../avatar/Avatar.svelte";
  import BrowserNotificationSetting from "./BrowserNotificationSetting.svelte";
  import { requestCurrentUser } from "../../lib/appearance";
  import type { User } from "../../lib/types";

  type Props = {
    user: User;
    hideCommentary: boolean;
    hideToolCalls: boolean;
    userAlign: "left" | "right";
    otherAlign: "left" | "right";
    isDesktop?: boolean;
    onUserUpdated?: (user: User) => void;
    onSaved?: () => void;
    onHideCommentary: (value: boolean) => void;
    onHideToolCalls: (value: boolean) => void;
    onUserAlign: (value: "left" | "right") => void;
    onOtherAlign: (value: "left" | "right") => void;
    onBrowserNotificationsChanged?: (enabled: boolean) => void;
  };

  let {
    user,
    hideCommentary,
    hideToolCalls,
    userAlign,
    otherAlign,
    isDesktop = false,
    onUserUpdated,
    onSaved,
    onHideCommentary,
    onHideToolCalls,
    onUserAlign,
    onOtherAlign,
    onBrowserNotificationsChanged,
  }: Props = $props();

  let savedUser = $state<User | null>(null);
  const currentUser = $derived(savedUser ?? user);
  let displayName = $state("");
  let handle = $state("");
  let avatarURL = $state("");
  let avatarURLLight = $state("");
  let status = $state("");
  let statusError = $state(false);
  let saving = $state(false);

  const previewName = $derived(displayName.trim() || currentUser.display_name || "Your name");
  const previewHandle = $derived(handle.trim().replace(/^@+/, "") || currentUser.handle || "");

  $effect(() => {
    displayName = currentUser.display_name;
    handle = currentUser.handle ?? "";
    avatarURL = currentUser.avatar_url;
    avatarURLLight = currentUser.avatar_url_light ?? "";
  });

  $effect(() => {
    if (!avatarURL.trim()) avatarURLLight = "";
  });

  function normalizedHandleForSave(): string {
    const trimmed = handle.trim().replace(/^@+/, "");
    return trimmed ? `@${trimmed}` : "";
  }

  async function save() {
    if (saving) return;
    saving = true;
    status = "";
    statusError = false;
    try {
      const data = await requestCurrentUser({
        method: "PATCH",
        body: JSON.stringify({
          display_name: displayName,
          handle: normalizedHandleForSave(),
          avatar_url: avatarURL,
          avatar_url_light: avatarURLLight,
          notification_settings: currentUser.notification_settings,
        }),
      });
      savedUser = data.user;
      onUserUpdated?.(data.user);
      status = "Saved";
      onSaved?.();
    } catch (error) {
      status = error instanceof Error ? error.message : "Could not save profile";
      statusError = true;
    } finally {
      saving = false;
    }
  }

  function clearAvatar() {
    avatarURL = "";
  }
</script>

<form
  class="settings-form"
  onsubmit={(event) => {
    event.preventDefault();
    void save();
  }}
>
  <section class="settings-identity" aria-label="Profile preview">
    <Avatar
      id={currentUser.id}
      name={previewName}
      src={avatarURL}
      lightSrc={avatarURLLight}
      size={52}
      loading="eager"
      fetchPriority="auto"
    />
    <div class="settings-identity__meta">
      <strong class="settings-identity__name">{previewName}</strong>
      <span class="settings-identity__handle">
        {previewHandle ? `@${previewHandle}` : "No handle set"}
      </span>
    </div>
    <span class="settings-identity__tag">Preview</span>
  </section>

  <div class="settings-rows">
    <div class="settings-row2">
      <div class="settings-row2__desc">
        <label class="settings-row2__label" for="profile-display-name">Display name</label>
        <p class="settings-row2__hint">Shown in messages, mentions, and your profile card.</p>
      </div>
      <div class="settings-row2__control">
        <input
          id="profile-display-name"
          class="settings-input"
          bind:value={displayName}
          aria-label="Display name"
          maxlength="80"
          autocomplete="name"
        />
      </div>
    </div>

    <div class="settings-row2">
      <div class="settings-row2__desc">
        <label class="settings-row2__label" for="profile-handle">Handle</label>
        <p class="settings-row2__hint">Used in mentions and the quick switcher. Must be unique.</p>
      </div>
      <div class="settings-row2__control">
        <div class="settings-input-group">
          <span class="settings-input-group__prefix" aria-hidden="true">@</span>
          <input
            id="profile-handle"
            class="settings-input settings-input--in-group"
            bind:value={handle}
            aria-label="Handle"
            placeholder="your-handle"
            autocomplete="username"
          />
        </div>
      </div>
    </div>

    <div class="settings-row2">
      <div class="settings-row2__desc">
        <label class="settings-row2__label" for="profile-avatar-url">Default / dark photo</label>
        <p class="settings-row2__hint">Used in dark mode and as the fallback in light mode.</p>
      </div>
      <div class="settings-row2__control">
        <input
          id="profile-avatar-url"
          class="settings-input"
          bind:value={avatarURL}
          aria-label="Default or dark avatar URL"
          placeholder="https://example.com/avatar-dark.png"
          inputmode="url"
        />
        {#if avatarURL}
          <button
            type="button"
            class="settings-linklike"
            onclick={clearAvatar}
            aria-label="Remove avatar"
          >
            Remove
          </button>
        {/if}
      </div>
    </div>

    <div class="settings-row2">
      <div class="settings-row2__desc">
        <label class="settings-row2__label" for="profile-avatar-url-light">Light mode photo</label>
        <p class="settings-row2__hint">Optional. Uses the default photo when empty.</p>
      </div>
      <div class="settings-row2__control">
        <input
          id="profile-avatar-url-light"
          class="settings-input"
          bind:value={avatarURLLight}
          aria-label="Light mode avatar URL"
          placeholder="https://example.com/avatar-light.png"
          inputmode="url"
          disabled={!avatarURL.trim()}
        />
        {#if avatarURLLight}
          <button
            type="button"
            class="settings-linklike"
            onclick={() => (avatarURLLight = "")}
            aria-label="Remove light mode avatar"
          >
            Remove
          </button>
        {/if}
      </div>
    </div>

    <h3 class="settings-rows__head">Conversation display</h3>

    <div class="settings-row2 settings-row2--toggle">
      <div class="settings-row2__desc">
        <label class="settings-row2__label" for="profile-hide-commentary">Hide agent commentary</label>
        <p class="settings-row2__hint">Keep agent reasoning summaries out of the message timeline.</p>
      </div>
      <div class="settings-row2__control settings-row2__control--end">
        <input
          id="profile-hide-commentary"
          type="checkbox"
          class="settings-switch"
          checked={hideCommentary}
          onchange={(event) => onHideCommentary(event.currentTarget.checked)}
        />
      </div>
    </div>

    <div class="settings-row2 settings-row2--toggle">
      <div class="settings-row2__desc">
        <label class="settings-row2__label" for="profile-hide-tool-calls">Hide tool calls</label>
        <p class="settings-row2__hint">Hide tool execution details while keeping ordinary messages visible.</p>
      </div>
      <div class="settings-row2__control settings-row2__control--end">
        <input
          id="profile-hide-tool-calls"
          type="checkbox"
          class="settings-switch"
          checked={hideToolCalls}
          onchange={(event) => onHideToolCalls(event.currentTarget.checked)}
        />
      </div>
    </div>

    <div class="settings-row2">
      <div class="settings-row2__desc">
        <label class="settings-row2__label" for="profile-user-align">Your message alignment</label>
        <p class="settings-row2__hint">Choose which side of the timeline shows your messages.</p>
      </div>
      <div class="settings-row2__control">
        <select
          id="profile-user-align"
          class="settings-input"
          value={userAlign}
          onchange={(event) => onUserAlign(event.currentTarget.value === "right" ? "right" : "left")}
        >
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </div>
    </div>

    <div class="settings-row2">
      <div class="settings-row2__desc">
        <label class="settings-row2__label" for="profile-other-align">Other message alignment</label>
        <p class="settings-row2__hint">Choose which side of the timeline shows messages from other people and agents.</p>
      </div>
      <div class="settings-row2__control">
        <select
          id="profile-other-align"
          class="settings-input"
          value={otherAlign}
          onchange={(event) => onOtherAlign(event.currentTarget.value === "right" ? "right" : "left")}
        >
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </div>
    </div>

    <h3 class="settings-rows__head">Notifications</h3>

    <BrowserNotificationSetting
      user={currentUser}
      {isDesktop}
      onChanged={onBrowserNotificationsChanged}
    />
  </div>

  <footer class="settings-footer">
    {#if status}
      <p class="settings-status" class:is-error={statusError} role="status">{status}</p>
    {:else}
      <span class="settings-footer__spacer" aria-hidden="true"></span>
    {/if}
    <button type="submit" class="settings-button settings-button--primary" disabled={saving}>
      {saving ? "Saving..." : "Save profile"}
    </button>
  </footer>
</form>
