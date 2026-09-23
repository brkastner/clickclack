<script lang="ts">
  import { tick } from "svelte";
  import { registerDismissLayer } from "$lib/dismissal";
  import {
    flattenSections,
    highlightRuns,
    parseRecentCommands,
    rankCommands,
    recentCommandsStorageKey,
    rememberRecentCommand,
    type PaletteCommand,
    type PaletteSection,
    type RankedCommand,
  } from "$lib/command-palette";
  import { closeCommandPalette, commandPalette, paletteCommands } from "$lib/command-palette-state.svelte";

  type Props = {
    workspaceID: string;
  };

  let { workspaceID }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLDivElement>();
  let query = $state("");
  let activeIndex = $state(0);
  let recentIDs = $state<string[]>([]);
  let keyboardInset = $state(0);
  // Touch devices get a close button instead of keyboard hints.
  let coarsePointer = $state(false);

  const sections = $derived<PaletteSection[]>(
    commandPalette.open ? rankCommands(query, paletteCommands(), recentIDs) : [],
  );
  const flat = $derived<RankedCommand[]>(flattenSections(sections));
  const active = $derived(flat[Math.min(activeIndex, flat.length - 1)]);
  const listID = "command-palette-list";

  function optionID(command: PaletteCommand): string {
    return `command-palette-option-${command.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  }

  function flatIndex(item: RankedCommand): number {
    return flat.indexOf(item);
  }

  function loadRecents() {
    try {
      recentIDs = parseRecentCommands(localStorage.getItem(recentCommandsStorageKey(workspaceID)));
    } catch {
      recentIDs = [];
    }
  }

  function saveRecent(id: string) {
    recentIDs = rememberRecentCommand(recentIDs, id);
    try {
      localStorage.setItem(recentCommandsStorageKey(workspaceID), JSON.stringify(recentIDs));
    } catch {
      // Recents are a convenience; the command still runs without storage.
    }
  }

  async function run(item: RankedCommand | undefined) {
    if (!item) return;
    saveRecent(item.command.id);
    closeCommandPalette();
    // Let the dialog close and hand focus back before the command opens its
    // own modal or moves focus somewhere new.
    await tick();
    try {
      await item.command.run();
    } catch (error) {
      console.error("command palette command failed", error);
    }
  }

  function move(delta: number) {
    if (flat.length === 0) return;
    activeIndex = (activeIndex + delta + flat.length) % flat.length;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    const emacsNext = event.ctrlKey && !event.metaKey && event.key === "n";
    const emacsPrevious = event.ctrlKey && !event.metaKey && event.key === "p";
    if (event.key === "ArrowDown" || emacsNext) {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp" || emacsPrevious) {
      event.preventDefault();
      move(-1);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      activeIndex = Math.min(flat.length - 1, activeIndex + 8);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 8);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void run(active);
    }
  }

  function syncKeyboardInset() {
    const viewport = window.visualViewport;
    if (!viewport) {
      keyboardInset = 0;
      return;
    }
    // Capacitor resizes the web view for the keyboard, so this stays 0 there.
    // Mobile browsers shrink only the visual viewport, which this measures.
    keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
  }

  // Reset every time the palette opens, not only on first mount.
  $effect(() => {
    void commandPalette.session;
    if (!commandPalette.open) return;
    query = "";
    activeIndex = 0;
    loadRecents();
  });

  // Keep the selection on the first result as the query changes.
  $effect(() => {
    void query;
    activeIndex = 0;
  });

  $effect(() => {
    if (!dialog) return;
    if (commandPalette.open && !dialog.open) {
      coarsePointer = window.matchMedia("(hover: none), (pointer: coarse)").matches;
      syncKeyboardInset();
      dialog.showModal();
      input?.focus();
    } else if (!commandPalette.open && dialog.open) {
      dialog.close();
    }
  });

  // Android's back gesture closes the palette before anything under it.
  $effect(() => {
    if (!commandPalette.open) return;
    return registerDismissLayer(() => {
      if (!commandPalette.open) return false;
      closeCommandPalette();
      return true;
    });
  });

  $effect(() => {
    if (!commandPalette.open) return;
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", syncKeyboardInset);
    viewport?.addEventListener("scroll", syncKeyboardInset);
    return () => {
      viewport?.removeEventListener("resize", syncKeyboardInset);
      viewport?.removeEventListener("scroll", syncKeyboardInset);
    };
  });

  $effect(() => {
    if (!active || !list) return;
    list.querySelector(`#${CSS.escape(optionID(active.command))}`)?.scrollIntoView({ block: "nearest" });
  });
</script>

<dialog
  bind:this={dialog}
  class="command-palette"
  aria-label="Command palette"
  style:--palette-keyboard-inset={`${keyboardInset}px`}
  oncancel={(event) => {
    event.preventDefault();
    closeCommandPalette();
  }}
  onclose={() => {
    // The close event is queued, so it can arrive after a quick reopen has
    // already called showModal again. Only sync when the dialog is really shut.
    if (dialog?.open) return;
    if (commandPalette.open) closeCommandPalette();
  }}
  onclick={(event) => {
    // Clicks on the backdrop land on the dialog itself.
    if (event.target === dialog) closeCommandPalette();
  }}
>
  {#if commandPalette.open}
    <div class="command-palette-panel" data-handles-escape>
      <div class="command-palette-search">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          bind:this={input}
          bind:value={query}
          type="text"
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-controls={listID}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionID(active.command) : undefined}
          placeholder="Jump to a channel, view, or action"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          enterkeyhint="go"
          onkeydown={handleKeydown}
        />
        {#if coarsePointer}
          <button type="button" class="command-palette-close" aria-label="Close command palette" onclick={closeCommandPalette}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        {:else}
          <kbd class="command-palette-esc">Esc</kbd>
        {/if}
      </div>

      <div class="command-palette-list" id={listID} role="listbox" aria-label="Commands" bind:this={list}>
        {#each sections as section (section.group + section.label)}
          <div class="command-palette-section" role="group" aria-label={section.label}>
            <div class="command-palette-section-label" aria-hidden="true">{section.label}</div>
            {#each section.items as item (item.command.id)}
              {@const index = flatIndex(item)}
              <div
                id={optionID(item.command)}
                class="command-palette-option"
                class:active={index === activeIndex}
                role="option"
                tabindex="-1"
                aria-selected={index === activeIndex}
                onpointermove={() => (activeIndex = index)}
                onpointerdown={(event) => event.preventDefault()}
                onclick={() => void run(item)}
                onkeydown={() => {}}
              >
                <span class="command-palette-icon" aria-hidden="true">
                  {#if item.command.glyph}
                    {item.command.glyph}
                  {:else if item.command.icon}
                    <svg viewBox="0 0 24 24" width="15" height="15">
                      {#each item.command.icon as path (path)}<path d={path} />{/each}
                    </svg>
                  {:else}
                    <svg viewBox="0 0 24 24" width="15" height="15"><path d="m9 6 6 6-6 6" /></svg>
                  {/if}
                </span>
                <span class="command-palette-label">
                  {#each highlightRuns(item.command.label, item.matches) as run, runIndex (runIndex)}
                    {#if run.match}<mark>{run.text}</mark>{:else}{run.text}{/if}
                  {/each}
                </span>
                {#if item.command.current}
                  <span class="command-palette-hint">current</span>
                {:else if item.command.hint}
                  <span class="command-palette-hint">{item.command.hint}</span>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="command-palette-empty">No matches for “{query.trim()}”</p>
        {/each}
      </div>

      {#if !coarsePointer}
        <footer class="command-palette-footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>Esc</kbd> close</span>
        </footer>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  .command-palette {
    /* The dialog is only a positioning box. Clicks that reach it came from
       the backdrop, so the visible card is the panel inside it. */
    position: fixed;
    inset: 0;
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    overflow: hidden;
  }

  .command-palette:not([open]) {
    display: none;
  }

  .command-palette[open] {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: calc(max(8vh, 56px) + var(--safe-area-top, 0px)) 16px 16px;
  }

  .command-palette::backdrop {
    background: rgba(5, 8, 15, 0.54);
    backdrop-filter: blur(10px);
  }

  .command-palette-panel {
    display: flex;
    flex-direction: column;
    width: min(620px, 100%);
    max-height: min(540px, calc(var(--app-vh, 100dvh) - 20vh));
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-xl);
    box-shadow: var(--key-edge, none), var(--shadow);
    overflow: hidden;
    animation: command-palette-in 0.14s ease-out;
  }

  @keyframes command-palette-in {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.985);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .command-palette-panel {
      animation: none;
    }
  }

  .command-palette-search {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
  }

  .command-palette-search > svg,
  .command-palette-close svg {
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  .command-palette-search input {
    flex: 1 1 auto;
    min-width: 0;
    height: 52px;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-strong);
    font: inherit;
    font-size: 15px;
  }

  .command-palette-search input::placeholder {
    color: var(--muted-2);
  }

  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border: 1px solid var(--line-strong);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
    background: var(--panel-2);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1;
  }

  .command-palette-close {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin-right: -6px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--muted);
  }

  .command-palette-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px;
  }

  .command-palette-section + .command-palette-section {
    margin-top: 4px;
  }

  .command-palette-section-label {
    padding: 8px 10px 4px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .command-palette-option {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    padding: 0 10px;
    border-radius: var(--radius);
    color: var(--text);
    cursor: pointer;
    user-select: none;
  }

  .command-palette-option.active {
    background: var(--hover-strong);
    color: var(--text-strong);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .command-palette-icon {
    display: grid;
    flex: 0 0 18px;
    place-items: center;
    width: 18px;
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
  }

  .command-palette-option.active .command-palette-icon {
    color: var(--accent);
  }

  .command-palette-icon svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .command-palette-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 14px;
  }

  .command-palette-label mark {
    background: transparent;
    color: var(--accent);
    font-weight: 650;
  }

  .command-palette-hint {
    flex: 0 0 auto;
    color: var(--muted-2);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .command-palette-empty {
    margin: 0;
    padding: 28px 16px;
    color: var(--muted);
    text-align: center;
    font-size: 13px;
  }

  .command-palette-footer {
    display: flex;
    gap: 16px;
    padding: 8px 14px;
    border-top: 1px solid var(--line);
    color: var(--muted-2);
    font-size: 11px;
  }

  .command-palette-footer span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  /* Phones: a sheet pinned under the status bar that ends above the keyboard. */
  @media (max-width: 640px), (hover: none) and (pointer: coarse) {
    .command-palette[open] {
      padding: calc(8px + var(--safe-area-top, 0px)) calc(8px + var(--safe-area-right, 0px)) 8px
        calc(8px + var(--safe-area-left, 0px));
    }

    .command-palette-panel {
      width: 100%;
      max-height: calc(
        var(--app-vh, 100dvh) - var(--safe-area-top, 0px) - 16px -
          var(--palette-keyboard-inset, 0px) / var(--ui-scale, 1)
      );
    }

    .command-palette-search input {
      height: 54px;
      /* 16px keeps mobile browsers from zooming into the field. */
      font-size: 16px;
    }

    .command-palette-option {
      min-height: 46px;
    }

    .command-palette-label {
      font-size: 15px;
    }
  }
</style>
