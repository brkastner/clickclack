<script lang="ts">
  import { tick } from "svelte";
  import { markdown, time } from "../../lib/format";
  import type { User } from "../../lib/types";
  import Avatar from "../avatar/Avatar.svelte";
  import { enhanceMarkdown } from "../../lib/actions/markdown";
  import { enhanceCodeBlockCopy } from "../../lib/actions/code-block-copy";
  import { tangentEndMessage } from "../../lib/tangent";
  import {
    discardTangent,
    hideTangent,
    requestTangent,
    sendTangentMessage,
    showTangent,
    tangentStore,
  } from "../../lib/tangent-state.svelte";
  import AgentResponding from "../messages/AgentResponding.svelte";

  type Props = {
    currentUser?: User | null;
    // Start a fresh tangent from the conversation that's open now. Absent when
    // that conversation has no agent to fork.
    onStartNew?: () => void;
    // Called after the panel hides itself from the keyboard, so chat can take
    // focus back.
    onHidden?: () => void;
  };

  let { currentUser, onStartNew, onHidden }: Props = $props();

  let input: HTMLTextAreaElement | null = $state(null);
  let scroller: HTMLDivElement | null = $state(null);

  const botName = $derived(tangentStore.current.bot?.display_name || tangentStore.current.bot?.handle || "the agent");
  const live = $derived(tangentStore.current.tangent !== null && tangentStore.current.ended === null);
  const canSend = $derived(live && tangentStore.current.draft.trim().length > 0);

  $effect(() => {
    // Focus whenever the panel is shown or a tangent finishes opening.
    void tangentStore.current.focusRequest;
    if (!tangentStore.current.visible) return;
    const chat = tangentStore.current;
    void tick().then(() => {
      if (tangentStore.current === chat && chat.visible) input?.focus();
    });
  });

  $effect(() => {
    // Keep the newest message in view.
    void tangentStore.current.messages.length;
    void tangentStore.current.working;
    void tick().then(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  function submit() {
    if (!canSend) return;
    const body = tangentStore.current.draft;
    tangentStore.current.draft = "";
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
    if (event.target === input && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function openExisting() {
    tangentStore.current.pendingStart = null;
    showTangent();
  }

  function replaceExisting() {
    const pending = tangentStore.current.pendingStart;
    if (!pending) return;
    void requestTangent(pending.source, pending.bot, true);
  }
</script>

<aside
  class="thread tangent-panel"
  class:open={tangentStore.current.visible}
  inert={!tangentStore.current.visible}
  aria-hidden={tangentStore.current.visible ? undefined : "true"}
  aria-label="Tangent"
  data-handles-escape
  onkeydown={handleKeydown}
>
  <header>
    <div>
      <strong>tangent{tangentStore.current.bot ? ` with ${botName}` : ""}</strong>
      {#if tangentStore.current.source}
        <p>from {tangentStore.current.source.label} · private to you</p>
      {/if}
    </div>
    <div class="tangent-panel__actions">
      {#if onStartNew && tangentStore.current.tangent}
        <button type="button" class="ghost-action" onclick={onStartNew} title="Start a new tangent from this conversation">new</button>
      {/if}
      {#if tangentStore.current.tangent}
        <button type="button" class="ghost-action" onclick={discardTangent} title="Discard this tangent">discard</button>
      {/if}
      <button type="button" class="close" aria-label="Hide tangent" title="Hide (Ctrl+L)" onclick={() => { hideTangent(); onHidden?.(); }}>×</button>
    </div>
  </header>

  <div class="thread-scroll tangent-panel__scroll" bind:this={scroller}>
    {#if tangentStore.current.pendingStart}
      <div class="tangent-panel__prompt" role="group" aria-label="Existing tangent">
        <p>
          you already have a tangent with {botName}.
          open it, or replace it with a new one with {tangentStore.current.pendingStart.bot.display_name} from {tangentStore.current.pendingStart.source.label}?
        </p>
        <div class="tangent-panel__prompt-actions">
          <button type="button" class="ghost-action" onclick={openExisting}>open existing</button>
          <button type="button" class="primary-action" onclick={replaceExisting}>replace</button>
        </div>
      </div>
    {/if}

    {#if !tangentStore.current.tangent && !tangentStore.current.opening && !tangentStore.current.error}
      <p class="tangent-panel__empty">
        {onStartNew
          ? "ask this conversation's agent a private side question."
          : "open a DM or channel with an agent to start a tangent."}
      </p>
      {#if onStartNew}
        <button type="button" class="primary-action" onclick={onStartNew}>start tangent</button>
      {/if}
    {:else if tangentStore.current.opening}
      <p class="tangent-panel__empty" role="status">starting a tangent with {botName}…</p>
    {:else if tangentStore.current.messages.length === 0 && tangentStore.current.tangent}
      <p class="tangent-panel__empty">
        ask {botName} a side question about {tangentStore.current.source?.label ?? "this conversation"}.
        nothing here is posted there. reloading the app discards it.
      </p>
    {/if}

    <ol class="tangent-panel__messages">
      {#each tangentStore.current.messages as message (message.client_id ?? message.id)}
        {@const mine = message.author_id === tangentStore.current.tangent?.owner_user_id}
        {@const author = mine ? currentUser : tangentStore.current.bot}
        <li class="tangent-message message-group" class:mine class:is-self={mine} class:is-agent={!mine} class:pending={message.pending} class:failed={message.failed}>
          <Avatar id={message.author_id} name={author?.display_name ?? (mine ? "you" : botName)} src={author?.avatar_url} lightSrc={author?.avatar_url_light} isBot={!mine} size={48} />
          <div class="group-body">
            <header>
              <span class="author-name">{author?.display_name ?? (mine ? "you" : botName)}</span>
              {#if !mine}<span class="bot-chip">bot</span>{/if}
              <time datetime={message.created_at}>{time(message.created_at)}</time>
            </header>
            <div class="message-row">
              <div class="message-content">
                <div class="markdown tangent-message__body" use:enhanceMarkdown use:enhanceCodeBlockCopy={true}>{@html markdown(message.body)}</div>
              </div>
              {#if message.failed && live}
                <button type="button" class="ghost-action tangent-message__retry" onclick={() => void sendTangentMessage(message.body, message)}>retry</button>
              {/if}
            </div>
          </div>
        </li>
      {/each}
    </ol>

    <AgentResponding active={tangentStore.current.working && live} agentNames={[botName]} />

    {#if tangentStore.current.ended}
      <div class="tangent-panel__ended" role="status">
        <p>{tangentEndMessage(tangentStore.current.ended)}</p>
        {#if onStartNew}
          <button type="button" class="primary-action" onclick={onStartNew}>start a new tangent</button>
        {/if}
      </div>
    {/if}
    {#if tangentStore.current.error}
      <p class="composer-notice" role="alert">{tangentStore.current.error}</p>
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
      bind:value={tangentStore.current.draft}
      rows="1"
      placeholder={live ? `ask ${botName} on the side…` : "no live tangent"}
      aria-label="Tangent message"
      disabled={!live}
      enterkeyhint="send"
    ></textarea>
    <button type="submit" class="primary-action tangent-send" aria-label="Send" title="send" disabled={!canSend}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7M12 5v14" /></svg>
    </button>
  </form>
</aside>
