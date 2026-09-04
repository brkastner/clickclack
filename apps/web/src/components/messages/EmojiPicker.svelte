<script lang="ts" module>
  import { emojiCharForShortcode } from "../../lib/emoji";

  /* Quick reacts stay a short hand-picked row: they are the one-click path in
     the hover toolbar, so they must not shuffle as recents change. */
  const quick = (name: string): string => emojiCharForShortcode(name) ?? "";

  export const QUICK_EMOJIS = [
    quick("+1"),
    quick("heart"),
    quick("joy"),
    quick("open_mouth"),
    quick("cry"),
    quick("pray"),
    quick("tada"),
    quick("fire"),
    quick("100"),
    quick("eyes"),
    quick("rocket"),
    quick("white_check_mark"),
  ];

  /* Quick reacts shared by the hover toolbar and the touch action sheet. */
  export const QUICK_REACTS = [quick("+1"), quick("white_check_mark"), quick("eyes")];

  /* Sheet quick-react row: toolbar reacts first, topped up from the picker. */
  export const SHEET_QUICK_REACTS = [
    ...QUICK_REACTS,
    ...QUICK_EMOJIS.filter((emoji) => !QUICK_REACTS.includes(emoji)),
  ].slice(0, 6);
</script>

<script lang="ts">
  import { tick } from "svelte";
  import {
    EMOJI_GROUP_LABELS,
    EMOJI_GROUP_ORDER,
    emojiGroup,
    loadRecentEmoji,
    rememberRecentEmoji,
    searchEmoji,
    type EmojiEntry,
  } from "../../lib/emoji";

  let {
    id,
    placement = "above",
    disabled = false,
    onPick,
    onEscape,
  }: {
    id: string;
    placement?: "above" | "above-right" | "below";
    disabled?: boolean;
    onPick: (emoji: string) => void;
    onEscape: () => void;
  } = $props();

  let rootRef = $state<HTMLDivElement>();
  let query = $state("");
  let recents = $state<EmojiEntry[]>(loadRecentEmoji());

  type Section = { key: string; label: string; entries: EmojiEntry[] };

  const sections = $derived.by<Section[]>(() => {
    const trimmed = query.trim();
    if (trimmed) {
      const results = searchEmoji(trimmed, 48);
      return results.length > 0 ? [{ key: "results", label: "Results", entries: results }] : [];
    }
    const groups = EMOJI_GROUP_ORDER.map((group) => ({
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
    if (disabled) return;
    rememberRecentEmoji(entry.name);
    onPick(entry.char);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onEscape();
  }

  /* Focus lands on the first quick react, not the search box: the toolbar
     picker is primarily a one-click path, and search is a Tab away. */
  $effect(() => {
    void (async () => {
      await tick();
      rootRef?.querySelector<HTMLButtonElement>(".emoji-option")?.focus();
    })();
  });
</script>

<div
  bind:this={rootRef}
  class="emoji-grid"
  class:below={placement === "below"}
  class:above-right={placement === "above-right"}
  {id}
  role="group"
  aria-label="Choose a reaction"
  onkeydown={handleKeydown}
>
  <div class="emoji-quick-row">
    {#each QUICK_EMOJIS as emoji}
      <button
        type="button"
        class="emoji-option"
        onclick={() => onPick(emoji)}
        aria-label={`React with ${emoji}`}
        title={emoji}
        {disabled}
      >
        {emoji}
      </button>
    {/each}
  </div>
  <input
    bind:value={query}
    class="emoji-search"
    type="search"
    placeholder="Search emoji"
    aria-label="Search emoji"
    {disabled}
  />
  <div class="emoji-scroll">
    {#each sections as section (section.key)}
      <div class="emoji-section">
        <h4>{section.label}</h4>
        <div class="emoji-section-grid">
          {#each section.entries as entry (entry.name)}
            <button
              type="button"
              class="emoji-option"
              onclick={() => pick(entry)}
              aria-label={`React with :${entry.name}:`}
              title={`:${entry.name}:`}
              {disabled}
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
</div>

<style>
  .emoji-grid {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 4px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    background: var(--panel, #fff);
    border: 1px solid var(--line-strong, #e0e0e0);
    border-radius: var(--radius, 8px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 100;
    width: 268px;
  }

  .emoji-grid.below {
    bottom: auto;
    top: calc(100% + 4px);
    left: auto;
    right: 0;
    margin-bottom: 0;
  }

  .emoji-grid.above-right {
    left: auto;
    right: 0;
  }

  /* The quick row keeps the picker's original one-click grid intact; search
     and the full catalog sit underneath it. */
  .emoji-quick-row {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 2px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line, #eee);
  }

  .emoji-search {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line, #e0e0e0);
    border-radius: 6px;
    background: var(--panel-2, #f7f7f7);
    color: inherit;
    font-size: 12.5px;
  }

  .emoji-scroll {
    max-height: 208px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .emoji-section + .emoji-section {
    margin-top: 8px;
  }

  .emoji-section h4 {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0 0 2px;
    padding: 3px 2px;
    background: var(--panel, #fff);
    color: var(--muted, #777);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .emoji-section-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 2px;
  }

  .emoji-empty {
    margin: 10px 4px;
    color: var(--muted, #777);
    font-size: 12px;
  }

  .emoji-option {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 1;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    transition: background 0.1s;
  }

  .emoji-option:hover,
  .emoji-option:focus-visible {
    background: color-mix(in srgb, var(--accent, #5865f2) 12%, transparent);
  }

  .emoji-option:disabled {
    cursor: wait;
    opacity: 0.55;
  }
</style>
