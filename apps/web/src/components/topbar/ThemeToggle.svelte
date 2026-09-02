<script lang="ts">
  import { resolvedColorMode, setColorMode } from "../../lib/appearance";

  const targetMode = $derived($resolvedColorMode === "light" ? "dark" : "light");
  const label = $derived(`Switch to ${targetMode} mode`);

  function toggleTheme() {
    setColorMode(targetMode);
  }
</script>

<button
  type="button"
  class="theme-toggle"
  title={label}
  aria-label={label}
  onclick={toggleTheme}
>
  {#if $resolvedColorMode === "light"}
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.7 6.7 0 0 0 21 12.8Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  {/if}
</button>
