<script lang="ts">
  import { avatarSize, setAvatarSize } from "../../lib/avatar-size";

  const doubled = $derived($avatarSize === "double");
  const label = $derived(doubled ? "Use regular-sized avatars" : "Use double-sized avatars");

  function toggleAvatarSize() {
    setAvatarSize(doubled ? "regular" : "double");
  }
</script>

<button
  type="button"
  class="avatar-size-toggle"
  class:active={doubled}
  title={label}
  aria-label={label}
  aria-pressed={doubled}
  onclick={toggleAvatarSize}
>
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
    <circle cx="12" cy="8" r="3.25" fill="none" stroke="currentColor" stroke-width="1.8" />
    <path
      d="M5.5 20a6.5 6.5 0 0 1 13 0"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
    />
    <path d="M18 4h4v4" fill="none" stroke="currentColor" stroke-width="1.6" />
    <path d="m22 4-4.25 4.25" fill="none" stroke="currentColor" stroke-width="1.6" />
  </svg>
</button>
