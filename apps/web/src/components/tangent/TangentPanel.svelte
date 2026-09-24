<script lang="ts">
  import { tick } from "svelte";
  import { markdown } from "../../lib/format";
  import { tangentEndMessage } from "../../lib/tangent";
  import {
    discardTangent,
    hideTangent,
    requestTangent,
    sendTangentMessage,
    showTangent,
    tangentChat,
  } from "../../lib/tangent-state.svelte";
  import AgentResponding from "../messages/AgentResponding.svelte";

  type Props = {
    // Start a fresh tangent from the conversation that's open now. Absent when
    // that conversation has no agent to fork.
    onStartNew?: () => void;
    // Called after the panel hides itself from the keyboard, so chat can take
    // focus back.
    onHidden?: () => void;
  };

  let { onStartNew, onHidden }: Props = $props();

  let input: HTMLTextAreaElement | null = $state(null);
  let scroller: HTMLDivElement | null = $state(null);

  const botName = $derived(tangentChat.bot?.display_name || tangentChat.bot?.handle || "the agent");
  const live = $derived(tangentChat.tangent !== null && tangentChat.ended === null);
  const canSend = $derived(live && tangentChat.draft.trim().length > 0);

  $effect(() => {
    // Focus whenever the panel is shown or a tangent finishes opening.
    void tangentChat.focusRequest;
    if (!tangentChat.visible) return;
    void tick().then(() => input?.focus());
  });

  $effect(() => {
    // Keep the newest message in view.
    void tangentChat.messages.length;
    void tangentChat.working;
    void tick().then(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  function submit() {
    if (!canSend) return;
    const body = tangentChat.draft;
    tangentChat.draft = "";
    void sendTangentMessage(body);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hideTangent();
      onHidden?.();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function openExisting() {
    tangentChat.pendingStart = null;
    showTangent();
  }

  function replaceExisting() {
    const pending = tangentChat.pendingStart;
    if (!pending) return;
    void requestTangent(pending.source, pending.bot, true);
  }
</script>

<aside
  class="thread tangent-panel"
  class:open={tangentChat.visible}
  inert={!tangentChat.visible}
  aria-hidden={tangentChat.visible ? undefined : "true"}
  aria-label="Tangent"
  data-handles-escape
  onkeydown={handleKeydown}
>
  <header>
    <div>
      <strong>Tangent{tangentChat.bot ? ` with ${botName}` : ""}</strong>
      {#if tangentChat.source}
        <p>from {tangentChat.source.label} · private to you</p>
      {/if}
    </div>
    <div class="tangent-panel__actions">
      {#if onStartNew && tangentChat.tangent}
        <button type="button" class="ghost-action" onclick={onStartNew} title="Start a new tangent from this conversation">New</button>
      {/if}
      {#if tangentChat.tangent}
        <button type="button" class="ghost-action" onclick={discardTangent} title="Discard this tangent">Discard</button>
      {/if}
      <button type="button" class="close" aria-label="Hide tangent" title="Hide (Ctrl+L)" onclick={() => { hideTangent(); onHidden?.(); }}>×</button>
    </div>
  </header>

  <div class="thread-scroll tangent-panel__scroll" bind:this={scroller}>
    {#if tangentChat.pendingStart}
      <div class="tangent-panel__prompt" role="group" aria-label="Existing tangent">
        <p>
          You already have a tangent with {botName}.
          Open it, or replace it with a new one with {tangentChat.pendingStart.bot.display_name} from {tangentChat.pendingStart.source.label}?
        </p>
        <div class="tangent-panel__prompt-actions">
          <button type="button" class="ghost-action" onclick={openExisting}>Open existing</button>
          <button type="button" class="primary-action" onclick={replaceExisting}>Replace</button>
        </div>
      </div>
    {/if}

    {#if !tangentChat.tangent && !tangentChat.opening && !tangentChat.error}
      <p class="tangent-panel__empty">
        {onStartNew
          ? "Start a tangent to ask this conversation's agent a side question."
          : "Tangents need an agent in the conversation. Open a DM or channel with one."}
      </p>
      {#if onStartNew}
        <button type="button" class="primary-action" onclick={onStartNew}>Start tangent</button>
      {/if}
    {:else if tangentChat.opening}
      <p class="tangent-panel__empty" role="status">Starting a tangent with {botName}…</p>
    {:else if tangentChat.messages.length === 0 && tangentChat.tangent}
      <p class="tangent-panel__empty">
        Ask {botName} a side question. It starts from what {botName} knew in {tangentChat.source?.label ?? "the conversation"} just now,
        and nothing here is posted there. Reloading the app discards it.
      </p>
    {/if}

    <ol class="tangent-panel__messages">
      {#each tangentChat.messages as message (message.client_id ?? message.id)}
        {@const mine = message.author_id === tangentChat.tangent?.owner_user_id}
        <li class="tangent-message" class:mine class:pending={message.pending} class:failed={message.failed}>
          <span class="tangent-message__author">{mine ? "You" : botName}</span>
          <div class="markdown tangent-message__body">{@html markdown(message.body)}</div>
          {#if message.failed && live}
            <button type="button" class="ghost-action tangent-message__retry" onclick={() => void sendTangentMessage(message.body, message)}>Retry</button>
          {/if}
        </li>
      {/each}
    </ol>

    <AgentResponding active={tangentChat.working && live} agentNames={[botName]} />

    {#if tangentChat.ended}
      <div class="tangent-panel__ended" role="status">
        <p>{tangentEndMessage(tangentChat.ended)}</p>
        {#if onStartNew}
          <button type="button" class="primary-action" onclick={onStartNew}>Start a new tangent</button>
        {/if}
      </div>
    {/if}
    {#if tangentChat.error}
      <p class="composer-notice" role="alert">{tangentChat.error}</p>
    {/if}
  </div>

  <form
    class="tangent-panel__composer"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    <textarea
      bind:this={input}
      bind:value={tangentChat.draft}
      rows="1"
      placeholder={live ? `Ask ${botName} on the side…` : "No live tangent"}
      aria-label="Tangent message"
      disabled={!live}
      enterkeyhint="send"
    ></textarea>
    <button type="submit" class="primary-action" disabled={!canSend}>Send</button>
  </form>
</aside>
