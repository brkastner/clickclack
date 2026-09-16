<script lang="ts">
  import type { GitActivity } from "../../lib/chat/git-activity";

  let { activity }: { activity: GitActivity } = $props();

  const actionLabel = $derived(`git ${activity.action}`);
  const shortSHA = $derived(activity.commit?.sha.slice(0, 7));
  const shortSession = $derived(
    activity.session.id.length > 18
      ? `${activity.session.id.slice(0, 9)}…${activity.session.id.slice(-6)}`
      : activity.session.id,
  );
</script>

<article
  class="git-activity"
  class:git-activity--failed={activity.outcome === "failed"}
  aria-label={`${actionLabel} ${activity.outcome}`}
>
  <header class="git-activity__header">
    <span class="git-activity__mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="17" height="17">
        <circle cx="6" cy="4" r="2.25"></circle>
        <circle cx="6" cy="20" r="2.25"></circle>
        <circle cx="18" cy="8" r="2.25"></circle>
        <path d="M6 6.25v11.5M8.25 6.25c5.5 0 3.5 1.75 7.5 1.75"></path>
      </svg>
    </span>
    <span class="git-activity__action">{actionLabel}</span>
    <span class="git-activity__outcome">
      <span class="git-activity__dot" aria-hidden="true"></span>
      {activity.outcome}
    </span>
  </header>

  <div class="git-activity__context">
    {#if activity.repository.url}
      <a href={activity.repository.url} target="_blank" rel="noreferrer">{activity.repository.name}</a>
    {:else}
      <strong>{activity.repository.name}</strong>
    {/if}
    {#if activity.branch}
      <span class="git-activity__branch">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <circle cx="4" cy="3" r="1.5"></circle><circle cx="4" cy="13" r="1.5"></circle><circle cx="12" cy="5" r="1.5"></circle><path d="M4 4.5v7M5.5 5c3.5 0 3 .1 5 .1"></path>
        </svg>
        {activity.branch}
      </span>
    {/if}
  </div>

  {#if activity.commit}
    <div class="git-activity__commit">
      {#if activity.commit.url}
        <a class="git-activity__sha" href={activity.commit.url} target="_blank" rel="noreferrer">{shortSHA}</a>
      {:else}
        <code class="git-activity__sha">{shortSHA}</code>
      {/if}
      {#if activity.commit.subject}<span>{activity.commit.subject}</span>{/if}
    </div>
  {/if}

  <footer class="git-activity__meta">
    <span>pi / {activity.project}</span>
    <span aria-hidden="true">·</span>
    <span title={activity.session.id}>session {shortSession}</span>
  </footer>
</article>

<style>
  .git-activity {
    --git-accent: var(--green, #3dd68c);
    width: min(34rem, 100%);
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--git-accent) 32%, var(--border, #3a3a46));
    border-radius: 0.75rem;
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--git-accent) 8%, transparent), transparent 45%),
      color-mix(in srgb, var(--surface, #1f1f2a) 94%, black);
    box-shadow: 0 10px 28px rgb(0 0 0 / 0.12);
  }

  .git-activity--failed { --git-accent: var(--red, #eb6f92); }

  .git-activity__header,
  .git-activity__context,
  .git-activity__commit,
  .git-activity__meta {
    display: flex;
    align-items: center;
  }

  .git-activity__header {
    min-height: 2.8rem;
    gap: 0.55rem;
    padding: 0 0.85rem;
    border-bottom: 1px solid color-mix(in srgb, var(--git-accent) 18%, var(--border, #3a3a46));
  }

  .git-activity__mark {
    display: grid;
    width: 1.65rem;
    height: 1.65rem;
    place-items: center;
    border-radius: 0.45rem;
    color: var(--git-accent);
    background: color-mix(in srgb, var(--git-accent) 13%, transparent);
  }

  .git-activity__mark svg,
  .git-activity__branch svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .git-activity__action {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.82rem;
    font-weight: 650;
  }

  .git-activity__outcome {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
    color: var(--git-accent);
    font-size: 0.72rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.055em;
  }

  .git-activity__dot {
    width: 0.42rem;
    height: 0.42rem;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 14%, transparent);
  }

  .git-activity__context {
    flex-wrap: wrap;
    gap: 0.55rem;
    padding: 0.8rem 0.85rem 0.35rem;
    font-size: 0.9rem;
    font-weight: 650;
  }

  .git-activity__context a,
  .git-activity__commit a {
    color: inherit;
    text-decoration: none;
  }

  .git-activity__context a:hover,
  .git-activity__commit a:hover { text-decoration: underline; }

  .git-activity__branch {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 0.28rem;
    color: var(--text-muted, #9898a6);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.76rem;
    font-weight: 500;
  }

  .git-activity__commit {
    gap: 0.55rem;
    min-width: 0;
    padding: 0.35rem 0.85rem 0.85rem;
    color: var(--text-secondary, #c6c6d0);
    font-size: 0.82rem;
  }

  .git-activity__commit > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .git-activity__sha {
    flex: 0 0 auto;
    border: 1px solid color-mix(in srgb, var(--git-accent) 22%, var(--border, #3a3a46));
    border-radius: 0.35rem;
    padding: 0.13rem 0.35rem;
    color: var(--git-accent) !important;
    background: color-mix(in srgb, var(--git-accent) 8%, transparent);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.72rem;
  }

  .git-activity__meta {
    gap: 0.38rem;
    padding: 0.5rem 0.85rem;
    border-top: 1px solid color-mix(in srgb, var(--border, #3a3a46) 72%, transparent);
    color: var(--text-muted, #9898a6);
    background: rgb(0 0 0 / 0.08);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.67rem;
  }
</style>
