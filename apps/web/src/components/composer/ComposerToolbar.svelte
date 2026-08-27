<script lang="ts">
  type ComposerFormatAction =
    | "bold"
    | "italic"
    | "strike"
    | "code"
    | "heading-1"
    | "heading-2"
    | "bullet-list"
    | "ordered-list"
    | "blockquote"
    | "code-block"
    | "horizontal-rule"
    | "link"
    | "clear"
    | "undo"
    | "redo";

  type FormatState = {
    bold: boolean;
    italic: boolean;
    strike: boolean;
    code: boolean;
    heading1: boolean;
    heading2: boolean;
    bulletList: boolean;
    orderedList: boolean;
    blockquote: boolean;
    codeBlock: boolean;
    link: boolean;
    canUndo: boolean;
    canRedo: boolean;
  };

  type Props = {
    showGifPicker: boolean;
    disabled?: boolean;
    state: FormatState;
    onFormat: (action: ComposerFormatAction) => void;
    onToggleGif: () => void;
  };

  let { showGifPicker, disabled = false, state, onFormat, onToggleGif }: Props = $props();
</script>

<div class="composer-toolbar" role="toolbar" aria-label="Formatting and message tools">
  <div class="composer-toolbar__group" aria-label="Text style">
    <button type="button" title="Bold (Ctrl+B)" aria-label="Bold" aria-pressed={state.bold} class:active={state.bold} {disabled} onclick={() => onFormat("bold")}>
      <strong>B</strong>
    </button>
    <button type="button" title="Italic (Ctrl+I)" aria-label="Italic" aria-pressed={state.italic} class:active={state.italic} {disabled} onclick={() => onFormat("italic")}>
      <em>I</em>
    </button>
    <button type="button" title="Strikethrough" aria-label="Strikethrough" aria-pressed={state.strike} class:active={state.strike} {disabled} onclick={() => onFormat("strike")}>
      <span class="toolbar-strike">S</span>
    </button>
    <button type="button" title="Inline code (Ctrl+E)" aria-label="Inline code" aria-pressed={state.code} class:active={state.code} {disabled} onclick={() => onFormat("code")}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m8 9-3 3 3 3m8-6 3 3-3 3m-3.5-9-3 12"/></svg>
    </button>
  </div>

  <span class="composer-toolbar__divider" aria-hidden="true"></span>

  <div class="composer-toolbar__group" aria-label="Structure">
    <button type="button" title="Heading 1" aria-label="Heading 1" aria-pressed={state.heading1} class:active={state.heading1} {disabled} onclick={() => onFormat("heading-1")}>
      H1
    </button>
    <button type="button" title="Heading 2" aria-label="Heading 2" aria-pressed={state.heading2} class:active={state.heading2} {disabled} onclick={() => onFormat("heading-2")}>
      H2
    </button>
    <button type="button" title="Bulleted list" aria-label="Bulleted list" aria-pressed={state.bulletList} class:active={state.bulletList} {disabled} onclick={() => onFormat("bullet-list")}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1.25" fill="currentColor"/><circle cx="4" cy="12" r="1.25" fill="currentColor"/><circle cx="4" cy="18" r="1.25" fill="currentColor"/></svg>
    </button>
    <button type="button" title="Numbered list" aria-label="Numbered list" aria-pressed={state.orderedList} class:active={state.orderedList} {disabled} onclick={() => onFormat("ordered-list")}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M10 6h10M10 12h10M10 18h10M4 5h1v3M4 11h2l-2 3h2M4 17h2v3H4"/></svg>
    </button>
    <button type="button" title="Quote" aria-label="Quote" aria-pressed={state.blockquote} class:active={state.blockquote} {disabled} onclick={() => onFormat("blockquote")}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M6.7 17.5H3.5v-4.1c0-4.2 1.8-6.5 5.4-7l.5 2.1c-1.8.4-2.7 1.4-2.8 3h2.5v6H6.7Zm9 0h-3.2v-4.1c0-4.2 1.8-6.5 5.4-7l.5 2.1c-1.8.4-2.7 1.4-2.8 3h2.5v6h-2.4Z"/></svg>
    </button>
    <button type="button" title="Code block" aria-label="Code block" aria-pressed={state.codeBlock} class:active={state.codeBlock} {disabled} onclick={() => onFormat("code-block")}>
      <span>{`{ }`}</span>
    </button>
    <button type="button" title="Divider" aria-label="Horizontal divider" {disabled} onclick={() => onFormat("horizontal-rule")}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 12h16"/></svg>
    </button>
  </div>

  <span class="composer-toolbar__divider" aria-hidden="true"></span>

  <div class="composer-toolbar__group" aria-label="Insert and history">
    <button type="button" title="Add or edit link" aria-label="Link" aria-pressed={state.link} class:active={state.link} {disabled} onclick={() => onFormat("link")}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07"/></svg>
    </button>
    <button type="button" title="GIF picker" aria-label="GIF picker" aria-pressed={showGifPicker} class:active={showGifPicker} {disabled} onclick={onToggleGif}>
      GIF
    </button>
    <button type="button" title="Clear formatting" aria-label="Clear formatting" {disabled} onclick={() => onFormat("clear")}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m3 16 8.5-8.5 5 5L8 21H3v-5Zm10-10 2-2 5 5-2 2M13 21h8"/></svg>
    </button>
    <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={disabled || !state.canUndo} onclick={() => onFormat("undo")}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6"/></svg>
    </button>
    <button type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={disabled || !state.canRedo} onclick={() => onFormat("redo")}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m15 7 5 5-5 5m4-5h-8a6 6 0 0 0-6 6"/></svg>
    </button>
  </div>
</div>
