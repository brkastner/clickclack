# PROTOTYPE — assistant-ui thread island

Question: can assistant-ui own ClickClack's thread and message interactions while the existing Svelte shell and Tiptap composer remain authoritative?

This is an architecture and interaction prototype, not production code.

**Status: partly delivered.** The visual design below shipped, built in Svelte.
The island migration described under "Production direction" did not happen, and
the thread still renders on the original path. The mount contract the migration
would use now exists and is used by two other panels
(`docs/architecture/react-islands.md`). Whether to finish the migration or drop
the intent is tracked as KAS-766.

## Run

```bash
cd examples/assistant-ui-island-prototype
pnpm exec vite --host 127.0.0.1 --port 4175
```

## Boundary under test

- **Svelte owns:** workspace/channel routing, durable ClickClack messages, unread state, realtime events, the existing Tiptap composer, attachments, and voice controls.
- **React/assistant-ui owns:** thread rendering, message parts, streaming presentation, collapsible OpenClaw activity, hover actions, right-click menus, and message-level interaction state.
- **External-store runtime:** converts ClickClack messages into assistant-ui messages without moving persistence or OpenClaw execution into React.

## Included interactions

- Markdown message rendering
- OpenClaw thinking activity that opens while live and collapses when settled
- Individually expandable tool rows
- assistant-ui copy and regenerate actions
- Assistant-only Play aloud action with generating, autoplay, pause, and cached replay states
- Reply, reaction, pin, edit, copy-link, and delete menu affordances
- Right-click message context menu
- Reaction chips
- Simulated immutable external-store streaming
- Dedicated host-composer design with contenteditable input, expandable formatting tools, responsive quote and code-block shortcuts, attachments, voice entry, and reactive send state, still outside the React mount
- Live voice transformation with connecting, listening, thinking, speaking, and paused states; typed editor content remains untouched while live

## Production direction

Mount the island where `MessageList.svelte` currently renders, not around `ChatComposer.svelte`. The real bridge should project the existing coalesced `Message.preamble_block` and message metadata, then route message actions back through ClickClack's existing handlers. No assistant-ui composer migration is required.

## Implementation handoff

1. Translate the accepted thread and composer designs into the Svelte shell plus React island without changing ClickClack's authority boundaries.
2. Wire live voice states to Kassette and keep the existing Tiptap document mounted but non-editable while voice mode is active.
3. Add a server-side on-demand TTS endpoint and keep generated message audio in a client-side cache for replay.
