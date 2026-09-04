<script lang="ts">
  import { tick } from "svelte";
  import {
    EMOJI_GROUP_LABELS,
    EMOJI_GROUP_ORDER,
    emojiGroup,
    loadRecentEmoji,
    searchEmoji,
    type EmojiEntry,
    type EmojiGroup,
  } from "../../lib/emoji";

  type Props = {
    onPick: (entry: EmojiEntry) => void;
    onClose: () => void;
  };

  let { onPick, onClose }: Props = $props();

  let query = $state("");
  let searchRef = $state<HTMLInputElement>();
  let recents = $state<EmojiEntry[]>(loadRecentEmoji());

  type Section = { key: string; label: string; entries: EmojiEntry[] };

  const sections = $derived.by<Section[]>(() => {
    const trimmed = query.trim();
    if (trimmed) {
      const results = searchEmoji(trimmed, 60);
      return results.length > 0
        ? [{ key: "results", label: `Results for “${trimmed}”`, entries: results }]
        : [];
    }
    const groups = EMOJI_GROUP_ORDER.map((group: EmojiGroup) => ({
      key: group,
      label: EMOJI_GROUP_LABELS[group],
      entries: emojiGroup(group),
    }));
    return recents.length > 0
      ? [{ key: "recent", label: "Frequently used", entries: recents }, ...groups]
      : groups;
  });

  const totalResults = $derived(
    sections.reduce((count, section) => count + section.entries.length, 0),
  );

  function pick(entry: EmojiEntry) {
    onPick(entry);
    recents = loadRecentEmoji();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  $effect(() => {
    void (async () => {
      await tick();
      searchRef?.focus();
    })();
  });
</script>

<section
  class="emoji-picker"
  aria-label="Emoji picker"
  onkeydown={handleKeydown}
>
  <div class="emoji-picker-head">
    <strong>Emoji</strong>
    <input
      bind:this={searchRef}
      bind:value={query}
      placeholder="Search by name, e.g. sob"
      aria-label="Search emoji"
      type="search"
    />
  </div>
  <div class="emoji-picker-body" role="listbox" aria-label="Emoji results">
    {#each sections as section (section.key)}
      <div class="emoji-section">
        <h4>{section.label}</h4>
        <div class="emoji-section-grid">
          {#each section.entries as entry (entry.name)}
            <button
              type="button"
              class="emoji-cell"
              title={`:${entry.name}:`}
              aria-label={`Insert ${entry.name}`}
              onclick={() => pick(entry)}
            >
              {entry.char}
            </button>
          {/each}
        </div>
      </div>
    {/each}
    {#if totalResults === 0}
      <p class="emoji-empty">No emoji match “{query.trim()}”.</p>
    {/if}
  </div>
  <footer class="emoji-picker-foot">
    Type <code>:name:</code> in the composer to insert without opening this panel.
  </footer>
</section>
