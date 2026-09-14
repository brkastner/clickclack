<script lang="ts">
  import PreambleBlock from "../../../src/components/messages/PreambleBlock.svelte";
  import { coalesceAgentActivity } from "../../../src/lib/chat/agent-activity";
  import type { Message } from "../../../src/lib/types";

  // The same projection called by ChatApp, rendered with the production tool
  // disclosure component. Synthetic rows only; no server or account state.
  function row(id: string, body: string, kind: Message["kind"] = "agent_tool"): Message {
    return {
      id, workspace_id: "fixture", channel_id: "channel", author_id: "bot",
      thread_root_id: id, turn_id: "turn", body, body_format: "markdown", kind,
      created_at: "2026-09-01T00:00:00.000Z",
    };
  }
  let rows = $state<Message[]>([
    row("tool-1", "**read**"),
    row("tool-2", "**exec**"),
    { ...row("human", "Human interruption", "message"), author_id: "human" },
    row("tool-3", "**grep**"),
    row("final", "Final answer", "message"),
  ]);
  let appended = $state(false);
  let projected = $derived(coalesceAgentActivity(rows, {
    hideCommentary: false, hideToolCalls: false,
  }, Date.parse("2026-09-01T00:00:01.000Z")));

  function append() {
    rows = [...rows, row("late", "Late commentary", "agent_commentary"), row("late-tool", "**read**")];
    appended = true;
  }
</script>

<button onclick={append} disabled={appended}>Append late activity</button>
<main aria-label="Conversation fixture">
  {#each projected as message (message.id)}
    <article data-message-id={message.id}>
      {#if message.preamble_block}
        <PreambleBlock block={message.preamble_block} />
      {:else}
        <p>{message.body}</p>
      {/if}
    </article>
  {/each}
</main>
