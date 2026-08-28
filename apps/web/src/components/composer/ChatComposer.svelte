<script lang="ts">
  import { Editor } from "@tiptap/core";
  import { Image } from "@tiptap/extension-image";
  import { Placeholder } from "@tiptap/extension-placeholder";
  import { Markdown } from "@tiptap/markdown";
  import { StarterKit } from "@tiptap/starter-kit";
  import {
    avatarInitial,
    handleLabel,
    type ChannelProfileShortcut,
  } from "../../lib/chat/people";
  import {
    clipboardImageFiles,
    MAX_MESSAGE_ATTACHMENTS,
    type PendingAttachment,
  } from "../../lib/attachments";
  import type { ComposerInputElement } from "../../lib/chat/typeToFocus";
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
    voiceStream?: MediaStream | null;
    showGifPicker?: boolean;
    gifQuery?: string;
    filteredGifs?: GifItem[];
    slashCommands?: SlashCommand[];
    botCommands?: WorkspaceBotCommand[];
    mentionPeople?: User[];
    mentionProfiles?: ChannelProfileShortcut[];
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
    voiceStream = null,
    showGifPicker = false,
    gifQuery = "",
    filteredGifs = [],
    slashCommands = [],
    botCommands = [],
    mentionPeople = [],
    mentionProfiles = [],
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
              !inputEvent.data ||
              inputEvent.data.length <= 1
            ) {
              return false;
            }
            const editor = editorInstance;
            if (!editor) return false;
            event.preventDefault();
            if (editor.isEmpty) {
              editor.commands.setContent(inputEvent.data, { contentType: "markdown" });
            } else {
              editor.commands.insertContent(inputEvent.data, { contentType: "markdown" });
            }
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
    const profileSuggestions = mentionProfiles.map((profile) => ({
      id: profile.id,
      kind: "mention" as const,
      label: `@${profile.display_name}`,
      detail: `profile · inserts @${profile.handle}`,
      insertText: `@${profile.handle} `,
      sortText: `${profile.display_name} ${profile.channel_name} ${profile.handle}`.toLowerCase(),
    }));
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
    return [...profileSuggestions, ...peopleSuggestions]
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

  function handlePaste(event: ClipboardEvent): boolean {
    if (!event.clipboardData) return false;
    const files = clipboardImageFiles(event.clipboardData.items);
    if (files.length > 0 && onPasteFiles) {
      event.preventDefault();
      onPasteFiles(files);
      return true;
    }
    const text = event.clipboardData.getData("text/plain");
    const containsBlockMarkdown = /(^|\n)(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|```[\w.+-]*\s*$)/m.test(text);
    const editor = editorInstance;
    if (!editor || !text || !containsBlockMarkdown) return false;
    event.preventDefault();
    if (editor.isEmpty) editor.commands.setContent(text, { contentType: "markdown" });
    else editor.commands.insertContent(text, { contentType: "markdown" });
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
                    Ready · {formatBytes(attachment.file.size)}
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
    <div class="composer-row" class:has-voice={showVoice}>
      {#if showUpload}
        <label class="composer-icon" title="Attach files">
          <input type="file" aria-label="Upload file" {disabled} multiple onchange={onUploadFile} />
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M21.44 11.05 12.5 20a6 6 0 0 1-8.49-8.49l8.49-8.48a4 4 0 0 1 5.66 5.66l-8.49 8.49a2 2 0 0 1-2.83-2.83L13.41 7.5"/>
          </svg>
        </label>
      {/if}
      <div class="composer-editor" use:mountEditor={{ value, disabled, placeholder }}></div>
      {#if showVoice}
        <div class="composer-voice-controls">
          <button
            type="button"
            class="composer-voice"
            class:is-active={voiceStatus === "listening" || voiceStatus === "speaking"}
            class:is-paused={voiceInputStatus === "paused" || voiceInputStatus === "pausing"}
            class:is-connecting={voiceStatus === "connecting" || voiceInputStatus === "resuming"}
            class:is-failed={voiceStatus === "failed"}
            title={voiceStatus === "connecting" ? "Cancel voice connection" : voiceStatus !== "listening" && voiceStatus !== "speaking" ? "Start voice conversation" : voiceInputStatus === "paused" ? "Resume microphone" : voiceInputStatus === "pausing" ? "Pausing microphone…" : voiceInputStatus === "resuming" ? "Resuming microphone…" : "Pause microphone"}
            aria-label={voiceStatus === "failed" ? "Retry voice conversation" : voiceStatus === "connecting" ? "Cancel voice connection" : voiceStatus !== "listening" && voiceStatus !== "speaking" ? "Start voice conversation" : voiceInputStatus === "paused" ? "Resume microphone" : "Pause microphone"}
            aria-pressed={voiceInputStatus === "paused" || voiceInputStatus === "pausing"}
            onclick={onToggleVoice}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-3 0h6"/>
              {#if voiceInputStatus === "paused" || voiceInputStatus === "pausing"}
                <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 4l16 16"/>
              {/if}
            </svg>
            <span class="composer-voice__dot" aria-hidden="true"></span>
          </button>
          {#if voiceStatus === "listening" || voiceStatus === "speaking"}
            <button
              type="button"
              class="composer-voice-send"
              title="Send dictated message"
              aria-label="Send dictated message"
              disabled={!voiceDraftAvailable}
              onclick={onSendVoice}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path fill="currentColor" d="M3 3.5 21 12 3 20.5l3.6-7.5L15 12 6.6 11l-3.6-7.5Z"/>
              </svg>
            </button>
            <button
              type="button"
              class="composer-voice-end"
              title="End voice conversation"
              aria-label="End voice conversation"
              onclick={onEndVoice}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path fill="currentColor" d="M7 7h10v10H7z"/>
              </svg>
            </button>
          {/if}
        </div>
      {/if}
      <button type="submit" class="send" aria-label={submitLabel} disabled={disabled || submitDisabled || !value.trim()}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M3 3.5 21 12 3 20.5l3.6-7.5L15 12 6.6 11l-3.6-7.5Z"/>
        </svg>
      </button>
    </div>
    {#if showVoice && voiceStatus !== "idle"}
      <div class:voice-error={voiceStatus === "failed"} class="composer-voice-status" role="status">
        <span class="composer-voice-status__text">
          {voiceStatus === "connecting"
            ? "Connecting to local voice service…"
            : voiceInputStatus === "paused" || voiceInputStatus === "pausing"
              ? "Microphone paused · responses can still play"
              : voiceInputStatus === "resuming"
                ? "Resuming microphone…"
                : voiceStatus === "listening" && voiceWaiting
                  ? "OpenClaw is thinking…"
                  : voiceStatus === "listening"
                    ? "Listening · click the microphone to pause"
                    : voiceStatus === "speaking"
                      ? "OpenClaw is speaking · click the microphone to pause"
                      : voiceError || "Voice connection failed"}
        </span>
        <span class="composer-voice-visualizer-slot" aria-hidden="true">
          {#if voiceStream}
            <VoiceVisualizer stream={voiceStream} barCount={24} gap={1.5} maxHeight={18} />
          {/if}
        </span>
      </div>
    {/if}
    {#if showToolbar}
      <ComposerToolbar
        showGifPicker={showGifPicker}
        {disabled}
        state={formatState}
        onFormat={applyFormat}
        onToggleGif={onToggleGif}
      />
    {/if}
  </div>
</form>
