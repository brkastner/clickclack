<script lang="ts">
  import { onDestroy } from "svelte";
  import Avatar from "../avatar/Avatar.svelte";
  import BrowserNotificationSetting from "./BrowserNotificationSetting.svelte";
  import { readableAPIError } from "../../lib/api";
  import { requestCurrentUser } from "../../lib/appearance";
  import { clipboardImageFiles } from "../../lib/attachments";
  import { browserFilesFromDesktop, desktop, type DesktopPasteTarget } from "../../lib/desktop";
  import { uploadResourcePath, uploadWorkspaceFile } from "../../lib/uploads";
  import type { User } from "../../lib/types";

  type AvatarTarget = "dark" | "light";

  type Props = {
    user: User;
    workspaceID: string;
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
    workspaceID,
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
  let darkPreviewURL = $state("");
  let lightPreviewURL = $state("");
  let darkUploadError = $state("");
  let lightUploadError = $state("");
  let darkUploading = $state(false);
  let lightUploading = $state(false);
  let darkUploadGeneration = 0;
  let lightUploadGeneration = 0;
  let status = $state("");
  let statusError = $state(false);
  let saving = $state(false);

  const previewName = $derived(displayName.trim() || currentUser.display_name || "Your name");
  const previewHandle = $derived(handle.trim().replace(/^@+/, "") || currentUser.handle || "");
  const avatarUploading = $derived(darkUploading || lightUploading);

  $effect(() => {
    displayName = currentUser.display_name;
    handle = currentUser.handle ?? "";
    avatarURL = currentUser.avatar_url;
    avatarURLLight = currentUser.avatar_url_light ?? "";
  });

  $effect(() => {
    if (!avatarURL.trim()) avatarURLLight = "";
  });

  $effect(() => {
    const removers = (["profile-dark", "profile-light"] as const).map((target) =>
      desktop?.onPasteFiles(target, (payload) => {
        void uploadAvatar(desktopTarget(target), browserFilesFromDesktop(payload));
      }),
    );
    return () => removers.forEach((remove) => remove?.());
  });

  onDestroy(() => {
    darkUploadGeneration += 1;
    lightUploadGeneration += 1;
    revokePreview("dark");
    revokePreview("light");
  });

  function desktopTarget(target: DesktopPasteTarget): AvatarTarget {
    return target === "profile-light" ? "light" : "dark";
  }

  function previewURL(target: AvatarTarget): string {
    return target === "dark" ? darkPreviewURL : lightPreviewURL;
  }

  function setPreviewURL(target: AvatarTarget, value: string) {
    if (target === "dark") darkPreviewURL = value;
    else lightPreviewURL = value;
  }

  function revokePreview(target: AvatarTarget) {
    const value = previewURL(target);
    if (!value) return;
    URL.revokeObjectURL(value);
    setPreviewURL(target, "");
  }

  function setUploadError(target: AvatarTarget, value: string) {
    if (target === "dark") darkUploadError = value;
    else lightUploadError = value;
  }

  function setUploading(target: AvatarTarget, value: boolean) {
    if (target === "dark") darkUploading = value;
    else lightUploading = value;
  }

  function nextUploadGeneration(target: AvatarTarget): number {
    if (target === "dark") return ++darkUploadGeneration;
    return ++lightUploadGeneration;
  }

  function currentUploadGeneration(target: AvatarTarget): number {
    return target === "dark" ? darkUploadGeneration : lightUploadGeneration;
  }

  async function uploadAvatar(target: AvatarTarget, files: File[]) {
    if (files.length === 0) return;
    setUploadError(target, "");
    if (files.length !== 1) {
      setUploadError(target, "Paste exactly one image for this profile photo.");
      return;
    }
    if (!workspaceID) {
      setUploadError(target, "Choose a workspace before uploading a profile photo.");
      return;
    }

    const generation = nextUploadGeneration(target);
    revokePreview(target);
    const localPreviewURL = URL.createObjectURL(files[0]);
    setPreviewURL(target, localPreviewURL);
    setUploading(target, true);
    try {
      const upload = await uploadWorkspaceFile(workspaceID, files[0]);
      if (generation !== currentUploadGeneration(target)) return;
      revokePreview(target);
      const hostedURL = uploadResourcePath(upload);
      if (target === "dark") avatarURL = hostedURL;
      else avatarURLLight = hostedURL;
    } catch (error) {
      if (generation !== currentUploadGeneration(target)) return;
      revokePreview(target);
      setUploadError(target, readableAPIError(error, "Could not upload profile photo"));
    } finally {
      if (generation === currentUploadGeneration(target)) setUploading(target, false);
    }
  }

  function handleAvatarPaste(target: AvatarTarget, event: ClipboardEvent) {
    if (!event.clipboardData) return;
    const files = clipboardImageFiles(event.clipboardData.items);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadAvatar(target, files);
  }

  function normalizedHandleForSave(): string {
    const trimmed = handle.trim().replace(/^@+/, "");
    return trimmed ? `@${trimmed}` : "";
  }

  async function save() {
    if (saving || avatarUploading) return;
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
    nextUploadGeneration("dark");
    revokePreview("dark");
    darkUploading = false;
    clearLightAvatar();
    avatarURL = "";
  }

  function clearLightAvatar() {
    nextUploadGeneration("light");
    revokePreview("light");
    lightUploading = false;
    avatarURLLight = "";
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
      src={darkPreviewURL || avatarURL}
      lightSrc={lightPreviewURL || avatarURLLight}
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
          onpaste={(event) => handleAvatarPaste("dark", event)}
        />
        {#if darkPreviewURL}
          <img class="settings-avatar-upload-preview" src={darkPreviewURL} alt="" data-avatar-preview="dark" />
        {/if}
        {#if darkUploading}
          <span class="settings-field-note" role="status">Uploading photo...</span>
        {/if}
        {#if darkUploadError}
          <p class="settings-field-error" role="status">{darkUploadError}</p>
        {/if}
        {#if avatarURL || darkPreviewURL}
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
          onpaste={(event) => handleAvatarPaste("light", event)}
        />
        {#if lightPreviewURL}
          <img class="settings-avatar-upload-preview" src={lightPreviewURL} alt="" data-avatar-preview="light" />
        {/if}
        {#if lightUploading}
          <span class="settings-field-note" role="status">Uploading photo...</span>
        {/if}
        {#if lightUploadError}
          <p class="settings-field-error" role="status">{lightUploadError}</p>
        {/if}
        {#if avatarURLLight || lightPreviewURL}
          <button
            type="button"
            class="settings-linklike"
            onclick={clearLightAvatar}
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
    <button type="submit" class="settings-button settings-button--primary" disabled={saving || avatarUploading}>
      {saving ? "Saving..." : "Save profile"}
    </button>
  </footer>
</form>
