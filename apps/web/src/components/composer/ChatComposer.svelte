<script lang="ts">
  import { Editor } from "@tiptap/core";
  import { Image } from "@tiptap/extension-image";
  import { Placeholder } from "@tiptap/extension-placeholder";
  import { Markdown } from "@tiptap/markdown";
  import { StarterKit } from "@tiptap/starter-kit";
  import { avatarInitial, handleLabel } from "../../lib/chat/people";
  import {
    clipboardImageFiles,
    MAX_MESSAGE_ATTACHMENTS,
    type PendingAttachment,
  } from "../../lib/attachments";
  import type { ComposerInputElement } from "../../lib/chat/typeToFocus";
  import { desktop } from "../../lib/desktop";
  import { formatBytes, isImageUpload, uploadURL } from "../../lib/uploads";
  import type { GifItem } from "../../lib/gifs";
  import type { Message, SlashCommand, User, WorkspaceBotCommand } from "../../lib/types";
  import type { VoiceInputStatus, VoiceStatus } from "../../lib/voice";
  import VoiceVisualizer from "../VoiceVisualizer.svelte";
  import ComposerToolbar from "./ComposerToolbar.svelte";
  import GifPicker from "./GifPicker.svelte";
  import ReplyPreview from "./ReplyPreview.svelte";

  type ActiveToken = {
    kind: "slash" | "mention";
    start: number;
    end: number;
    query: string;
    raw: string;
  };

  type ComposerSuggestion = {
    id: string;
    kind: "slash" | "mention";
    label: string;
    detail: string;
    insertText: string;
    sortText: string;
    hint?: string;
    source?: string;
  };

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

  const emptyFormatState = (): FormatState => ({
    bold: false,
    italic: false,
    strike: false,
    code: false,
    heading1: false,
    heading2: false,
    bulletList: false,
    orderedList: false,
    blockquote: false,
    codeBlock: false,
    link: false,
    canUndo: false,
    canRedo: false,
  });

  type Props = {
    value: string;
    placeholder: string;
    ariaLabel: string;
    submitLabel: string;
    formClass?: string;
    pendingAttachments?: PendingAttachment[];
    replyTarget?: Message | null;
    showUpload?: boolean;
    showToolbar?: boolean;
    showVoice?: boolean;
    voiceStatus?: VoiceStatus;
    voiceInputStatus?: VoiceInputStatus;
    voiceError?: string;
    voiceWaiting?: boolean;
    voiceDraftAvailable?: boolean;
    voiceTranscript?: string;
    voiceResponseText?: string;
    voiceOutputMuted?: boolean;
    voiceAutoSend?: boolean;
    voiceStream?: MediaStream | null;
    showGifPicker?: boolean;
    gifQuery?: string;
    filteredGifs?: GifItem[];
    slashCommands?: SlashCommand[];
    botCommands?: WorkspaceBotCommand[];
    mentionPeople?: User[];
    disabled?: boolean;
    submitDisabled?: boolean;
    onValue: (value: string) => void;
    onSubmit: () => void;
    onKeydown: (event: KeyboardEvent) => void;
    onFocus: () => void;
    onInputRef: (node: ComposerInputElement | null) => void;
    onUploadFile?: (event: Event) => void;
    onPasteFiles?: (files: File[]) => void;
    onRemoveUpload?: (key: string) => void;
    onRetryUpload?: (key: string) => void;
    onClearReply?: () => void;
    onApplyMarkdownWrap?: (before: string, after?: string) => void;
    onAppendToComposer?: (snippet: string) => void;
    onToggleGif?: () => void;
    onToggleVoice?: () => void;
    onToggleVoiceOutput?: () => void;
    onToggleVoiceAutoSend?: () => void;
    onEndVoice?: () => void;
    onSendVoice?: () => void;
    onGifQuery?: (value: string) => void;
    onPickGif?: (url: string, title: string) => void;
  };

  let {
    value,
    placeholder,
    ariaLabel,
    submitLabel,
    formClass = "composer",
    pendingAttachments = [],
    replyTarget = null,
    showUpload = false,
    showToolbar = false,
    showVoice = false,
    voiceStatus = "idle",
    voiceInputStatus = "live",
    voiceError = "",
    voiceWaiting = false,
    voiceDraftAvailable = false,
    voiceTranscript = "",
    voiceResponseText = "",
    voiceOutputMuted = false,
    voiceAutoSend = true,
    voiceStream = null,
    showGifPicker = false,
    gifQuery = "",
    filteredGifs = [],
    slashCommands = [],
    botCommands = [],
    mentionPeople = [],
    disabled = false,
    submitDisabled = false,
    onValue,
    onSubmit,
    onKeydown,
    onFocus,
    onInputRef,
    onUploadFile = () => {},
    onPasteFiles,
    onRemoveUpload = () => {},
    onRetryUpload = () => {},
    onClearReply = () => {},
    onApplyMarkdownWrap = () => {},
    onAppendToComposer = () => {},
    onToggleGif = () => {},
    onToggleVoice = () => {},
    onToggleVoiceOutput = () => {},
    onToggleVoiceAutoSend = () => {},
    onEndVoice = () => {},
    onSendVoice = () => {},
    onGifQuery = () => {},
    onPickGif = () => {},
  }: Props = $props();

  let editorInstance: Editor | null = $state(null);
  let input: ComposerInputElement | null = $state(null);
  let activeToken: ActiveToken | null = $state(null);
  let dismissedToken = $state("");
  let selectedSuggestionIndex = $state(0);
  let formatState = $state<FormatState>(emptyFormatState());
  let fileDragActive = $state(false);
  let toolbarExpanded = $state(false);

  const voiceMode = $derived(
    showVoice &&
      (voiceStatus === "connecting" || voiceStatus === "listening" || voiceStatus === "speaking"),
  );
  const voicePaused = $derived(
    voiceInputStatus === "paused" || voiceInputStatus === "pausing",
  );

  const activeSuggestions = $derived.by(() => {
    if (!activeToken || tokenKey(activeToken) === dismissedToken) return [];
    return activeToken.kind === "slash"
      ? slashSuggestions(activeToken)
      : mentionSuggestions(activeToken);
  });

  type EditorActionOptions = {
    value: string;
    disabled: boolean;
    placeholder: string;
  };

  function mountEditor(node: HTMLDivElement, options: EditorActionOptions) {
    let previousPlaceholder = options.placeholder;
    const mountedEditor = new Editor({
      element: node,
      extensions: [
        StarterKit,
        Image.configure({ inline: true }),
        Markdown.configure({ indentation: { style: "space", size: 4 } }),
        Placeholder.configure({ placeholder: () => placeholder }),
      ],
      content: options.value,
      contentType: "markdown",
      editable: !options.disabled,
      editorProps: {
        attributes: {
          class: "composer-editor__content",
          role: "textbox",
          "aria-label": ariaLabel,
          "aria-multiline": "true",
        },
        handleKeyDown: (_view, event) => handleKeydown(event),
        handlePaste: (_view, event) => handlePaste(event),
        handleDOMEvents: {
          beforeinput: (_view, event) => {
            const inputEvent = event as InputEvent;
            if (
              inputEvent.inputType !== "insertText" ||
              inputEvent.isComposing ||
              !inputEvent.data ||
              inputEvent.data.length <= 1
            ) {
              return false;
            }
            const editor = editorInstance;
            if (!editor) return false;
            event.preventDefault();
            editor.view.dispatch(editor.state.tr.insertText(inputEvent.data));
            return true;
          },
          focus: () => {
            handleFocus();
            return false;
          },
        },
      },
      onUpdate: ({ editor: current }) => {
        const markdown = current.getMarkdown();
        if (markdown !== value) onValue(markdown);
        refreshActiveToken(current);
        refreshFormatState(current);
      },
      onTransaction: ({ editor: current }) => {
        refreshActiveToken(current);
        refreshFormatState(current);
      },
    });
    editorInstance = mountedEditor;
    input = mountedEditor.view.dom;
    refreshActiveToken(mountedEditor);
    refreshFormatState(mountedEditor);

    return {
      update(next: EditorActionOptions) {
        const editable = !next.disabled;
        if (mountedEditor.isEditable !== editable) mountedEditor.setEditable(editable);
        if (mountedEditor.getMarkdown() !== next.value) {
          mountedEditor.commands.setContent(next.value, {
            contentType: "markdown",
            emitUpdate: false,
          });
          refreshActiveToken(mountedEditor);
          refreshFormatState(mountedEditor);
        }
        if (next.placeholder !== previousPlaceholder) {
          previousPlaceholder = next.placeholder;
          mountedEditor.view.dispatch(mountedEditor.state.tr);
        }
      },
      destroy() {
        input = null;
        editorInstance = null;
        formatState = emptyFormatState();
        mountedEditor.destroy();
      },
    };
  }

  $effect(() => {
    onInputRef(input);
    return () => onInputRef(null);
  });

  $effect(() =>
    desktop?.onPasteText((text) => {
      if (editorInstance?.isFocused) insertPastedText(text, true);
    }),
  );

  $effect(() => {
    if (activeSuggestions.length === 0) {
      selectedSuggestionIndex = 0;
      return;
    }
    if (selectedSuggestionIndex >= activeSuggestions.length) selectedSuggestionIndex = 0;
  });

  function refreshFormatState(editor: Editor) {
    formatState = {
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      heading1: editor.isActive("heading", { level: 1 }),
      heading2: editor.isActive("heading", { level: 2 }),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      blockquote: editor.isActive("blockquote"),
      codeBlock: editor.isActive("codeBlock"),
      link: editor.isActive("link"),
      canUndo: editor.can().chain().undo().run(),
      canRedo: editor.can().chain().redo().run(),
    };
  }

  function refreshActiveToken(editor: Editor) {
    const { selection } = editor.state;
    if (!selection.empty) {
      activeToken = null;
      return;
    }
    const selectionHead = selection.$from;
    const { from } = selection;
    const before = selectionHead.parent.textBetween(
      0,
      selectionHead.parentOffset,
      "\n",
      "\ufffc",
    );
    const match = /(^|\s)([/@][^\s]*)$/.exec(before);
    if (!match) {
      activeToken = null;
      return;
    }
    const raw = match[2];
    const start = from - raw.length;
    if (raw.startsWith("/") && start !== 1) {
      activeToken = null;
      return;
    }
    activeToken = {
      kind: raw.startsWith("/") ? "slash" : "mention",
      start,
      end: from,
      query: raw.slice(1).toLowerCase(),
      raw,
    };
  }

  function tokenKey(token: ActiveToken): string {
    return `${token.kind}:${token.start}:${token.raw}`;
  }

  function normalizedCommand(command: string): string {
    return command.startsWith("/") ? command : `/${command}`;
  }

  function slashSuggestions(token: ActiveToken): ComposerSuggestion[] {
    const query = token.query;
    const registered = slashCommands
      .filter((command) => !command.revoked_at)
      .map((command) => {
        const label = normalizedCommand(command.command);
        return {
          id: command.id,
          kind: "slash" as const,
          label,
          detail: command.description || "Slash command",
          insertText: `${label} `,
          sortText: label.slice(1).toLowerCase(),
        };
      });
    // Bot-declared menu entries merge in behind HTTP-registered commands:
    // on a name collision the registered command wins (it is the one the
    // send path dispatches).
    const taken = new Set(registered.map((suggestion) => suggestion.label));
    const declared = botCommands
      .filter((command) => !taken.has(normalizedCommand(command.command)))
      .map((command) => {
        const label = normalizedCommand(command.command);
        return {
          id: command.id,
          kind: "slash" as const,
          label,
          detail: command.description,
          insertText: `${label} `,
          sortText: label.slice(1).toLowerCase(),
          hint: command.args_hint || undefined,
          source: command.bot.handle ? `@${command.bot.handle}` : command.bot.display_name,
        };
      });
    return [...registered, ...declared]
      .filter((suggestion) => !query || suggestion.sortText.includes(query))
      .sort((a, b) => Number(!a.sortText.startsWith(query)) - Number(!b.sortText.startsWith(query)) || a.sortText.localeCompare(b.sortText))
      .slice(0, 6);
  }

  function mentionText(person: User): string {
    return handleLabel(person.handle || person.display_name.replace(/\s+/g, ""));
  }

  function mentionSuggestions(token: ActiveToken): ComposerSuggestion[] {
    const query = token.query;
    const seen = new Set<string>();
    const peopleSuggestions = mentionPeople
      .filter((person) => {
        if (!person.id || !person.handle?.trim() || seen.has(person.id)) return false;
        seen.add(person.id);
        return true;
      })
      .map((person) => {
        const label = mentionText(person);
        const searchable = `${person.handle || ""} ${person.display_name}`.trim().toLowerCase();
        return {
          id: person.id,
          kind: "mention" as const,
          label,
          detail: person.kind === "bot" ? `${person.display_name} · bot` : person.display_name,
          insertText: `${label} `,
          sortText: searchable,
        };
      });
    return peopleSuggestions
      .filter((suggestion) => !query || suggestion.sortText.includes(query))
      .sort((a, b) => Number(!a.sortText.startsWith(query)) - Number(!b.sortText.startsWith(query)) || a.sortText.localeCompare(b.sortText))
      .slice(0, 6);
  }

  function pickSuggestion(suggestion: ComposerSuggestion) {
    const editor = editorInstance;
    if (!editor || !activeToken) return;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: activeToken.start, to: activeToken.end },
        { type: "text", text: suggestion.insertText },
      )
      .run();
  }

  function handleFocus() {
    onFocus();
  }

  function insertPastedText(text: string, forcePlainText = false): boolean {
    const editor = editorInstance;
    if (!editor || !text) return false;
    const containsBlockMarkdown = /(^|\n)(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|```[\w.+-]*\s*$)/m.test(text);
    if (!containsBlockMarkdown) {
      if (!forcePlainText) return false;
      return editor.view.pasteText(text);
    }
    if (editor.isEmpty) editor.commands.setContent(text, { contentType: "markdown" });
    else editor.commands.insertContent(text, { contentType: "markdown" });
    return true;
  }

  function handlePaste(event: ClipboardEvent): boolean {
    const files = event.clipboardData
      ? clipboardImageFiles(event.clipboardData.items)
      : [];
    if (files.length > 0 && onPasteFiles) {
      event.preventDefault();
      onPasteFiles(files);
      return true;
    }
    if (!event.clipboardData) return false;
    const text = event.clipboardData.getData("text/plain");
    if (!insertPastedText(text)) return false;
    event.preventDefault();
    return true;
  }

  function dragContainsFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  function handleFileDragOver(event: DragEvent) {
    if (!onPasteFiles || !dragContainsFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    fileDragActive = true;
  }

  function handleFileDragLeave(event: DragEvent) {
    const current = event.currentTarget as HTMLElement;
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !current.contains(next)) fileDragActive = false;
  }

  function handleFileDrop(event: DragEvent) {
    fileDragActive = false;
    if (!onPasteFiles || !event.dataTransfer || event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    onPasteFiles(Array.from(event.dataTransfer.files));
  }

  function convertOpeningCodeFence(event: KeyboardEvent): boolean {
    const editor = editorInstance;
    if (!editor || event.key !== "Enter" || !event.shiftKey) return false;
    const selectionFrom = editor.state.selection.$from;
    if (selectionFrom.parent.type.name === "codeBlock") {
      event.preventDefault();
      const beforeCursor = selectionFrom.parent.textBetween(0, selectionFrom.parentOffset, "\n");
      if (/(^|\n)```$/.test(beforeCursor)) {
        editor.view.dispatch(editor.state.tr.delete(selectionFrom.pos - 3, selectionFrom.pos));
        editor.chain().focus().exitCode().run();
      } else {
        editor.view.dispatch(editor.state.tr.insertText("\n"));
      }
      return true;
    }
    if (
      selectionFrom.parent.type.name !== "paragraph" ||
      selectionFrom.parentOffset !== selectionFrom.parent.content.size ||
      !/^```[\w.+-]*$/.test(selectionFrom.parent.textContent.trim())
    ) {
      return false;
    }
    event.preventDefault();
    editor
      .chain()
      .focus()
      .setTextSelection({ from: selectionFrom.start(), to: selectionFrom.end() })
      .deleteSelection()
      .setCodeBlock()
      .run();
    return true;
  }

  function handleKeydown(event: KeyboardEvent): boolean {
    if (activeSuggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        selectedSuggestionIndex = (selectedSuggestionIndex + 1) % activeSuggestions.length;
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        selectedSuggestionIndex =
          (selectedSuggestionIndex - 1 + activeSuggestions.length) % activeSuggestions.length;
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pickSuggestion(activeSuggestions[selectedSuggestionIndex]);
        return true;
      }
      if (event.key === "Escape" && activeToken) {
        event.preventDefault();
        dismissedToken = tokenKey(activeToken);
        return true;
      }
    }
    if (convertOpeningCodeFence(event)) return true;
    const clearAfterSend =
      event.key === "Enter" &&
      !event.shiftKey &&
      !disabled &&
      !submitDisabled &&
      value.trim().length > 0;
    onKeydown(event);
    if (clearAfterSend && event.defaultPrevented) editorInstance?.commands.clearContent();
    return event.defaultPrevented;
  }

  function submitFromComposer() {
    if (disabled || submitDisabled) return;
    onSubmit();
    editorInstance?.commands.clearContent();
  }

  function applyFormat(action: ComposerFormatAction) {
    const editor = editorInstance;
    if (!editor) {
      if (action === "bold") onApplyMarkdownWrap("**");
      else if (action === "italic") onApplyMarkdownWrap("_");
      else if (action === "code") onApplyMarkdownWrap("`");
      else if (action === "code-block") onApplyMarkdownWrap("```", "\n```");
      else if (action === "bullet-list") onAppendToComposer("\n- ");
      else if (action === "ordered-list") onAppendToComposer("\n1. ");
      else if (action === "blockquote") onAppendToComposer("\n> ");
      return;
    }

    const chain = editor.chain().focus();
    switch (action) {
      case "bold":
        chain.toggleBold().run();
        break;
      case "italic":
        chain.toggleItalic().run();
        break;
      case "strike":
        chain.toggleStrike().run();
        break;
      case "code":
        chain.toggleCode().run();
        break;
      case "heading-1":
        chain.toggleHeading({ level: 1 }).run();
        break;
      case "heading-2":
        chain.toggleHeading({ level: 2 }).run();
        break;
      case "bullet-list":
        chain.toggleBulletList().run();
        break;
      case "ordered-list":
        chain.toggleOrderedList().run();
        break;
      case "blockquote":
        chain.toggleBlockquote().run();
        break;
      case "code-block":
        chain.toggleCodeBlock().run();
        break;
      case "horizontal-rule":
        chain.setHorizontalRule().run();
        break;
      case "link": {
        const currentHref = editor.getAttributes("link").href as string | undefined;
        const href = window.prompt("Link URL", currentHref ?? "https://");
        if (href === null) break;
        if (!href.trim()) chain.extendMarkRange("link").unsetLink().run();
        else chain.extendMarkRange("link").setLink({ href: href.trim() }).run();
        break;
      }
      case "clear":
        chain.unsetAllMarks().clearNodes().run();
        break;
      case "undo":
        chain.undo().run();
        break;
      case "redo":
        chain.redo().run();
        break;
    }
  }

  function pickGif(url: string, title: string) {
    onPickGif(url, title);
  }
</script>

<form
  class={formClass}
  onsubmit={(event) => {
    event.preventDefault();
    submitFromComposer();
  }}
>
  {#if showGifPicker}
    <GifPicker
      gifs={filteredGifs}
      query={gifQuery}
      onQuery={onGifQuery}
      onPick={pickGif}
    />
  {/if}
  {#if activeSuggestions.length > 0}
    <div class="composer-suggestions" role="listbox" aria-label={activeToken?.kind === "slash" ? "Slash command suggestions" : "Mention suggestions"}>
      {#each activeSuggestions as suggestion, index (suggestion.id)}
        <button
          type="button"
          class:active={index === selectedSuggestionIndex}
          role="option"
          aria-selected={index === selectedSuggestionIndex}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => pickSuggestion(suggestion)}
        >
          <span class="suggestion-mark" aria-hidden="true">
            {#if suggestion.kind === "slash"}
              /
            {:else}
              {avatarInitial(suggestion.detail)}
            {/if}
          </span>
          <span class="suggestion-copy">
            <strong>{suggestion.label}{#if suggestion.hint}<em class="suggestion-hint"> {suggestion.hint}</em>{/if}</strong>
            <span>{suggestion.detail}</span>
          </span>
          <span class="suggestion-kind">{suggestion.source ?? (suggestion.kind === "slash" ? "command" : "mention")}</span>
        </button>
      {/each}
    </div>
  {/if}
  <div
    class="composer-card"
    class:is-dragging={fileDragActive}
    role="group"
    aria-label="Message composer"
    ondragover={handleFileDragOver}
    ondragleave={handleFileDragLeave}
    ondrop={handleFileDrop}
  >
    {#if fileDragActive}
      <div class="composer-drop-overlay" aria-hidden="true">
        <span>
          <svg viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m-4 4 4-4 4 4M5 14v5h14v-5"/></svg>
          Drop files to attach
        </span>
      </div>
    {/if}
    <div class="composer-text-view" class:is-hidden={voiceMode} aria-hidden={voiceMode}>
    {#if pendingAttachments.length > 0}
      <div class="composer-attachments" aria-label="Pending attachments">
        <div class="composer-attachments__header">
          <span>Attachments</span>
          <span>{pendingAttachments.length}/{MAX_MESSAGE_ATTACHMENTS}</span>
        </div>
        <div class="composer-attachments__list" role="list">
          {#each pendingAttachments as attachment (attachment.key)}
            <div class="composer-attachment" class:is-failed={attachment.state === "failed"} class:is-uploading={attachment.state === "uploading"} role="listitem">
              <span class="attachment-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M21.44 11.05 12.5 20a6 6 0 0 1-8.49-8.49l8.49-8.48a4 4 0 0 1 5.66 5.66l-8.49 8.49a2 2 0 0 1-2.83-2.83L13.41 7.5"/></svg>
              </span>
              {#if attachment.upload && isImageUpload(attachment.upload)}
                <img class="pending-image" src={uploadURL(attachment.upload)} alt={attachment.file.name} />
              {/if}
              <span class="attachment-copy">
                <span class="attachment-name">{attachment.file.name}</span>
                <span class="attachment-state" role="status">
                  {#if attachment.state === "uploading"}
                    Uploading · {formatBytes(attachment.file.size)}
                  {:else if attachment.state === "failed"}
                    Upload failed · {formatBytes(attachment.file.size)}
                  {:else}
                    Ready · {formatBytes(attachment.upload?.byte_size ?? attachment.file.size)}
                  {/if}
                </span>
              </span>
              {#if attachment.state === "failed"}
                <button
                  type="button"
                  class="attachment-retry"
                  aria-label={`Retry attachment ${attachment.file.name}`}
                  onclick={() => onRetryUpload(attachment.key)}
                >Retry</button>
              {/if}
              <button
                type="button"
                class="attachment-remove"
                aria-label={`Remove attachment ${attachment.file.name}`}
                onclick={() => onRemoveUpload(attachment.key)}
              >×</button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
    {#if replyTarget}
      <ReplyPreview target={replyTarget} onClear={onClearReply} />
    {/if}
    <div class="composer-editor-shell">
      <div
        class="composer-editor"
        use:mountEditor={{ value, disabled: disabled || voiceMode, placeholder }}
      ></div>
    </div>
    <div class="composer-controls">
      <div class="composer-tools-primary">
        {#if showUpload}
          <label class="composer-tool" title="Attach files">
            <input type="file" aria-label="Upload file" {disabled} multiple onchange={onUploadFile} />
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M21.44 11.05 12.5 20a6 6 0 0 1-8.49-8.49l8.49-8.48a4 4 0 0 1 5.66 5.66l-8.49 8.49a2 2 0 0 1-2.83-2.83L13.41 7.5"/>
            </svg>
          </label>
        {/if}
        {#if showToolbar}
          <button
            type="button"
            class="composer-tool composer-format-toggle"
            class:is-active={toolbarExpanded}
            title="Formatting"
            aria-label="Toggle formatting tools"
            aria-expanded={toolbarExpanded}
            onclick={() => (toolbarExpanded = !toolbarExpanded)}
          >Aa</button>
          <span class="composer-quick-divider" aria-hidden="true"></span>
          <button
            type="button"
            class="composer-tool composer-quick-tool"
            title="Blockquote"
            aria-label="Blockquote"
            aria-pressed={formatState.blockquote}
            onclick={() => applyFormat("blockquote")}
          >“</button>
          <button
            type="button"
            class="composer-tool composer-quick-tool"
            title="Code block"
            aria-label="Code block"
            aria-pressed={formatState.codeBlock}
            onclick={() => applyFormat("code-block")}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.5 4 12l3.5 3.5M16.5 8.5 20 12l-3.5 3.5M14 5l-4 14"/>
            </svg>
          </button>
          <span class="composer-quick-divider" aria-hidden="true"></span>
          <button
            type="button"
            class="composer-tool"
            title="Emoji"
            aria-label="Add emoji"
            onclick={() => onAppendToComposer("🙂")}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>
              <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8.5 10h.01M15.5 10h.01M8.5 14.5c1.1 1.3 2.2 1.9 3.5 1.9s2.4-.6 3.5-1.9"/>
            </svg>
          </button>
          <button
            type="button"
            class="composer-tool composer-gif-tool"
            class:is-active={showGifPicker}
            title="GIF"
            aria-label="Add GIF"
            onclick={onToggleGif}
          >GIF</button>
        {/if}
      </div>
      <div class="composer-actions">
        {#if showVoice}
          <button
            type="button"
            class="composer-voice-entry"
            class:is-failed={voiceStatus === "failed"}
            title={voiceStatus === "failed" ? "Retry voice conversation" : "Start live voice conversation"}
            aria-label={voiceStatus === "failed" ? "Retry voice conversation" : "Start live voice conversation"}
            onclick={onToggleVoice}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-3 0h6"/>
            </svg>
            <span>Voice</span>
          </button>
        {/if}
        <button type="submit" class="send" aria-label={submitLabel} disabled={disabled || submitDisabled || !value.trim()}>
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m4 12 15-8-4.5 16-3.2-6.1L4 12Zm7.3 1.9 3.9-4.1"/>
          </svg>
        </button>
      </div>
    </div>
    {#if showToolbar && toolbarExpanded}
      <div class="composer-format-tray">
        <ComposerToolbar
          showGifPicker={showGifPicker}
          {disabled}
          state={formatState}
          onFormat={applyFormat}
          onToggleGif={onToggleGif}
        />
      </div>
    {/if}
    {#if showVoice && voiceStatus === "failed"}
      <div class="composer-voice-inline-error" role="status">{voiceError || "Voice connection failed"}</div>
    {/if}
    </div>

    {#if showVoice}
      <section
        class="composer-live-voice"
        class:is-visible={voiceMode}
        aria-hidden={!voiceMode}
        aria-label="Live voice conversation"
      >
        <header class="composer-live-voice__header">
          <span class="composer-live-voice__identity">
            <span class="composer-live-voice__dot" aria-hidden="true"></span>
            <span>
              <strong>Live with OpenClaw</strong>
              <small>
                {voiceStatus === "connecting"
                  ? "Connecting…"
                  : voicePaused
                    ? "Mic paused"
                    : voiceInputStatus === "resuming"
                      ? "Resuming…"
                      : voiceWaiting
                        ? "Thinking"
                        : voiceStatus === "speaking"
                          ? "Speaking"
                          : voiceTranscript.trim()
                            ? "Transcribing"
                            : "Listening"}
              </small>
            </span>
          </span>
          <span class="composer-live-voice__draft">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z"/>
            </svg>
            {value.trim() ? "Typed draft preserved" : "Text input paused"}
          </span>
        </header>

        <div
          class="composer-live-voice__stage"
          class:is-listening={voiceStatus === "listening" && !voiceWaiting && !voicePaused}
          class:is-thinking={voiceWaiting}
          class:is-speaking={voiceStatus === "speaking"}
          class:is-paused={voicePaused}
        >
          <div class="composer-live-voice__visualizer" aria-hidden="true">
            {#if voiceStream}
              <VoiceVisualizer stream={voiceStream} barCount={20} gap={2} maxHeight={46} />
            {:else}
              <span class="composer-live-voice__fallback-wave"></span>
            {/if}
          </div>
          <div class="composer-live-voice__copy" role="status" aria-live="polite">
            {#if voiceStatus === "connecting"}
              <span>Opening voice channel</span>
              <strong>Connecting to OpenClaw…</strong>
              <p>Your typed draft is safe while the live session opens.</p>
            {:else if voicePaused}
              <span>Input paused</span>
              <strong>Take your time</strong>
              <p>The session stays open, but no microphone audio is being sent.</p>
            {:else if voiceStatus === "speaking"}
              <span>OpenClaw is responding</span>
              <strong>Response playing</strong>
              <p>{voiceResponseText || "The answer is playing through your selected output."}</p>
            {:else if voiceWaiting}
              <span>Turn received</span>
              <strong>OpenClaw is thinking</strong>
              <p>Your transcript is already in the conversation. The response will play here.</p>
            {:else if voiceTranscript.trim()}
              <span>Live transcription</span>
              <strong>I’m listening</strong>
              <p class="composer-live-voice__transcript">“{voiceTranscript}”</p>
            {:else}
              <span>Mic is live</span>
              <strong>I’m listening</strong>
              <p>Start speaking whenever you’re ready.</p>
            {/if}
          </div>
        </div>

        <div class="composer-live-voice__controls">
          <button
            type="button"
            class="composer-live-voice__control composer-live-voice__control--icon"
            class:is-muted={voiceOutputMuted}
            title={voiceOutputMuted ? "Unmute assistant audio" : "Mute assistant audio"}
            aria-label={voiceOutputMuted ? "Unmute assistant audio" : "Mute assistant audio"}
            aria-pressed={voiceOutputMuted}
            disabled={voiceStatus === "connecting"}
            onclick={onToggleVoiceOutput}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 10v4h4l5 4V6L9 10H5Zm12-1a4 4 0 0 1 0 6m2-8.5a8 8 0 0 1 0 11"/>
              {#if voiceOutputMuted}<path fill="none" stroke="currentColor" stroke-width="2" d="M4 4l16 16"/>{/if}
            </svg>
          </button>
          <button
            type="button"
            class="composer-live-voice__control composer-live-voice__control--mic"
            class:is-paused={voicePaused}
            title={`${voicePaused ? "Resume" : "Pause"} microphone (Space)`}
            aria-label={voicePaused ? "Resume microphone" : "Pause microphone"}
            aria-keyshortcuts="Space"
            aria-pressed={voicePaused}
            disabled={voiceStatus === "connecting" || voiceInputStatus === "pausing" || voiceInputStatus === "resuming"}
            onclick={onToggleVoice}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
              <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"/>
            </svg>
            <span>{voicePaused ? "Resume mic" : "Pause mic"}</span>
          </button>
          <button
            type="button"
            class="composer-live-voice__control composer-live-voice__control--auto-send"
            class:is-manual={!voiceAutoSend}
            title={`${voiceAutoSend ? "Disable" : "Enable"} VAD auto-send (A)`}
            aria-label={`${voiceAutoSend ? "Disable" : "Enable"} VAD auto-send`}
            aria-keyshortcuts="A"
            aria-pressed={voiceAutoSend}
            disabled={voiceStatus === "connecting"}
            onclick={onToggleVoiceAutoSend}
          >{voiceAutoSend ? "Auto send" : "Manual send"}</button>
          {#if voiceDraftAvailable}
            <button
              type="button"
              class="composer-live-voice__control"
              title="Send dictated message"
              aria-label="Send dictated message"
              onclick={onSendVoice}
            >Send now</button>
          {/if}
          <button
            type="button"
            class="composer-live-voice__control composer-live-voice__control--end"
            aria-label="End live conversation"
            onclick={onEndVoice}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M5.5 16.5c4.3-3.2 8.7-3.2 13 0M7.5 14.9l-1.7-2.4M16.5 14.9l1.7-2.4"/>
            </svg>
            <span>End live</span>
          </button>
        </div>
      </section>
    {/if}
  </div>
</form>
