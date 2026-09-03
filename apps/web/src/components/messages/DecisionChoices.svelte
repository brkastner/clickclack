<script lang="ts">
  import type { DecisionPrompt } from "../../lib/chat/decision-prompt";

  // Buttons for a workflow decision that is waiting on a person.
  //
  // These sit inside the message bubble, under the prompt text, because the
  // buttons are the prompt: the workflow is asking, not the client offering an
  // extra affordance. The prose above them stays authoritative and answering by
  // typing keeps working.
  //
  // Clicking sends an ordinary message. The bridge holds the workflow's
  // presentation claim and matches the reply the same way it matches a typed
  // one, so nothing here talks to the workflow host.

  let {
    prompt,
    answered = false,
    onAnswer,
    onPrefill,
  }: {
    prompt: DecisionPrompt;
    /** True once this decision has been answered, or a later reply superseded it. */
    answered?: boolean;
    onAnswer: (reply: string) => void;
    /** Puts a reply in the composer for a choice that still needs the operator's text. */
    onPrefill: (reply: string) => void;
  } = $props();

  let sending = $state(false);
  let disabled = $derived(answered || sending);

  function choose(reply: string, needsInput: boolean) {
    if (disabled) return;
    // A choice that collects text is unmatched without it, so a bare click
    // cannot answer it. Hand it to the composer instead of sending something
    // the bridge would drop.
    if (needsInput) {
      onPrefill(`${reply} `);
      return;
    }
    sending = true;
    onAnswer(reply);
  }
</script>

<div class="decision" role="group" aria-label="Decision choices">
  {#each prompt.choices as choice (choice.reply)}
    <button
      class="decision__choice"
      class:decision__choice--input={choice.needsInput}
      {disabled}
      onclick={() => choose(choice.reply, choice.needsInput)}
      title={choice.needsInput ? "Needs your answer in the composer" : undefined}
    >
      {choice.label}{#if choice.needsInput}<span class="decision__ellipsis" aria-hidden="true">…</span>{/if}
    </button>
  {/each}
  <button
    class="decision__dismiss"
    {disabled}
    onclick={() => choose(prompt.dismiss, false)}
    title="Leave this decision pending"
  >
    {prompt.dismiss}
  </button>
</div>

<style>
  .decision {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin-top: 10px;
  }

  .decision__choice,
  .decision__dismiss {
    padding: 5px 12px;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.4;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s, opacity 0.1s;
  }

  .decision__choice {
    border: 1px solid color-mix(in srgb, var(--accent, #0080c4) 45%, transparent);
    background: var(--accent-soft, rgba(0, 128, 196, 0.13));
    color: var(--text-strong, #10151d);
    font-weight: 600;
  }

  .decision__choice:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent, #0080c4) 22%, transparent);
    border-color: var(--accent, #0080c4);
  }

  .decision__dismiss {
    border: 1px solid var(--line-strong, rgba(16, 21, 29, 0.17));
    background: var(--panel, #fff);
    color: var(--muted, #666);
  }

  .decision__dismiss:hover:not(:disabled) {
    border-color: var(--line-strong, rgba(16, 21, 29, 0.3));
    color: var(--text-strong, #10151d);
  }

  .decision__choice:disabled,
  .decision__dismiss:disabled {
    cursor: default;
    opacity: 0.5;
  }

  /* Marks a choice that opens the composer rather than sending immediately. */
  .decision__ellipsis {
    margin-left: 1px;
    opacity: 0.7;
  }
</style>
