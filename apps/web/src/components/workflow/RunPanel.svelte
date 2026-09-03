<script lang="ts">
  import { time } from "../../lib/format";
  import {
    isRunFinished,
    isRunWaiting,
    runStatusLabel,
    type WorkflowRun,
  } from "../../lib/chat/workflow-run";

  // The active workflow run for the conversation you are looking at.
  //
  // Read-only. The bridge holds the workflow's presentation claim, so answering
  // a decision happens in the conversation (on the prompt's own buttons), not
  // here. A second presenter answering the host directly would be a conflict the
  // host is right to reject.
  //
  // Run frames are ephemeral: there is no replay after a reload, and no history.
  // The empty state says so rather than implying nothing is running.

  let {
    run,
    conversationLabel,
    onClose,
  }: {
    run: WorkflowRun | null;
    conversationLabel?: string;
    onClose?: () => void;
  } = $props();

  let finished = $derived(run !== null && isRunFinished(run));
  let waiting = $derived(run !== null && isRunWaiting(run));
  // The host may send a window of steps rather than all of them.
  let hiddenSteps = $derived(run === null ? 0 : Math.max(0, run.stepTotal - run.steps.length));
</script>

<header>
  <div>
    <p>Workflow run</p>
    <strong>{conversationLabel ?? "This conversation"}</strong>
  </div>
  {#if onClose}
    <button class="close" aria-label="Close workflow run" onclick={onClose}>&times;</button>
  {/if}
</header>

<div class="run-scroll" role="region" aria-label="Workflow run">
  {#if run === null}
    <div class="run-empty">
      <strong>No run reported</strong>
      <span>
        A workflow running here reports its state live. Nothing is shown after a
        reload until the next update arrives.
      </span>
    </div>
  {:else}
    <section class="run-summary">
      <h2>{run.workflowName}</h2>
      <div class="run-status" class:run-status--waiting={waiting} class:run-status--done={finished}>
        {runStatusLabel(run)}
      </div>
      {#if run.reason}
        <p class="run-reason">{run.reason}</p>
      {/if}
      {#if waiting}
        <p class="run-hint">Answer it on the prompt in the conversation.</p>
      {/if}
      {#if run.possiblyInterrupted}
        <p class="run-warning" role="status">
          This run may have been interrupted. Its last state could be incomplete.
        </p>
      {/if}
      <dl class="run-meta">
        {#if run.startedAt}
          <div><dt>Started</dt><dd>{time(run.startedAt)}</dd></div>
        {/if}
        {#if run.finishedAt}
          <div><dt>Finished</dt><dd>{time(run.finishedAt)}</dd></div>
        {/if}
        <div><dt>Steps</dt><dd>{run.stepTotal}</dd></div>
      </dl>
    </section>

    <section class="run-steps">
      <h3>Steps</h3>
      {#if run.steps.length === 0}
        <p class="run-steps__empty">No steps recorded yet.</p>
      {:else}
        {#if hiddenSteps > 0}
          <p class="run-steps__window">
            Showing the latest {run.steps.length} of {run.stepTotal}.
          </p>
        {/if}
        <ol>
          {#each run.steps as step (step.attemptId)}
            <li class="run-step" class:run-step--failed={step.outcome !== "ok"}>
              <span class="run-step__node">{step.nodeId}</span>
              <span class="run-step__type">{step.nodeType}</span>
              <span class="run-step__outcome">{step.outcome}</span>
              <span class="run-step__time">{time(step.finishedAt)}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}
</div>

<style>
  header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--line, rgba(16, 21, 29, 0.1));
  }

  header p {
    margin: 0;
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted, #666);
  }

  header strong {
    display: block;
    font-size: 14px;
    color: var(--text-strong, #10151d);
  }

  header div {
    flex: 1;
    min-width: 0;
  }

  .close {
    border: none;
    background: none;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    color: var(--muted, #666);
    padding: 0 4px;
  }

  .run-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
  }

  .run-empty {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 28px 12px;
    text-align: center;
    color: var(--muted, #666);
  }

  .run-empty strong {
    color: var(--text-strong, #10151d);
    font-size: 14px;
  }

  .run-empty span {
    font-size: 12.5px;
    line-height: 1.5;
  }

  .run-summary h2 {
    margin: 0 0 6px;
    font-size: 15px;
    color: var(--text-strong, #10151d);
  }

  .run-status {
    display: inline-block;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    background: var(--accent-soft, rgba(0, 128, 196, 0.13));
    color: var(--text-strong, #10151d);
  }

  /* Waiting is the one status that needs the operator, so it reads loudest. */
  .run-status--waiting {
    background: color-mix(in srgb, var(--accent, #0080c4) 28%, transparent);
  }

  .run-status--done {
    background: var(--panel-alt, rgba(16, 21, 29, 0.06));
    color: var(--muted, #666);
  }

  .run-reason,
  .run-hint,
  .run-warning {
    margin: 8px 0 0;
    font-size: 12.5px;
    line-height: 1.5;
  }

  .run-reason {
    color: var(--text, #10151d);
  }

  .run-hint {
    color: var(--muted, #666);
  }

  .run-warning {
    color: var(--danger, #b3261e);
  }

  .run-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin: 12px 0 0;
  }

  .run-meta div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .run-meta dt {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted, #666);
  }

  .run-meta dd {
    margin: 0;
    font-size: 12.5px;
    color: var(--text-strong, #10151d);
  }

  .run-steps {
    margin-top: 18px;
    border-top: 1px solid var(--line, rgba(16, 21, 29, 0.1));
    padding-top: 14px;
  }

  .run-steps h3 {
    margin: 0 0 8px;
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted, #666);
  }

  .run-steps__empty,
  .run-steps__window {
    margin: 0 0 8px;
    font-size: 12.5px;
    color: var(--muted, #666);
  }

  .run-steps ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .run-step {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 8px;
    padding: 7px 9px;
    border-radius: 6px;
    background: var(--panel-alt, rgba(16, 21, 29, 0.04));
    font-size: 12.5px;
  }

  .run-step__node {
    font-weight: 600;
    color: var(--text-strong, #10151d);
  }

  .run-step__type,
  .run-step__outcome,
  .run-step__time {
    color: var(--muted, #666);
    font-size: 11.5px;
  }

  .run-step__outcome {
    grid-column: 1;
  }

  .run-step__time {
    grid-column: 2;
    text-align: right;
  }

  .run-step--failed .run-step__outcome {
    color: var(--danger, #b3261e);
    font-weight: 600;
  }
</style>
