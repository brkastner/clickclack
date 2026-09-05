<script lang="ts">
  import { untrack } from "svelte";
  import { api, APIError } from "../../lib/api";
  import { mergeWorkflowRecords, snapshotRun, type WorkflowRunPage, type WorkflowRunRecord } from "../../lib/chat/workflow-snapshots";
  import type { WorkflowRun } from "../../lib/chat/workflow-run";
  import RunPanel from "./RunPanel.svelte";
  import WorkflowFileTree from "./WorkflowFileTree.svelte";

  let { channelID, directID, conversationLabel, liveRun, refreshVersion, onClose }: {
    channelID: string;
    directID: string;
    conversationLabel?: string;
    liveRun: WorkflowRun | null;
    refreshVersion: number;
    onClose: () => void;
  } = $props();
  let records = $state<WorkflowRunRecord[]>([]);
  let selectedID = $state("");
  let cursor = $state("");
  let loading = $state(false);
  let error = $state("");
  let serial = 0;
  let selected = $derived(selectedID
    ? records.find((record) => record.id === selectedID) ?? null
    : liveRun && liveRun.runId !== records[0]?.snapshot.source.runId ? null : records[0] ?? null);
  let displayedRun = $derived(selected ? snapshotRun(selected) : liveRun);
  let target = $derived(directID ? `dms/${encodeURIComponent(directID)}` : `channels/${encodeURIComponent(channelID)}`);

  let activeScope = "";
  let seenVersion = 0;
  let refreshPending = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  // Fixed window (not trailing debounce): bursts cannot postpone a refresh
  // indefinitely. Updates during a request queue only one follow-up.
  function scheduleRefresh(scope: string) {
    refreshPending = true;
    if (loading || refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (scope !== activeScope || loading) return;
      refreshPending = false;
      void refresh(scope);
    }, 100);
  }

  $effect(() => {
    const scope = target;
    const version = refreshVersion;
    untrack(() => {
      if (scope !== activeScope) {
        serial += 1;
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
        refreshPending = false;
        activeScope = scope;
        seenVersion = version;
        records = [];
        selectedID = "";
        cursor = "";
        void load(scope, false);
      } else if (version !== seenVersion) {
        seenVersion = version;
        scheduleRefresh(scope);
      }
    });
  });
  $effect(() => () => {
    serial += 1;
    clearTimeout(refreshTimer);
  });

  function finishRequest(request: number, scope: string) {
    if (request !== serial) return;
    loading = false;
    if (refreshPending) scheduleRefresh(scope);
  }

  async function load(scope: string, more: boolean) {
    const request = ++serial;
    loading = true;
    error = "";
    try {
      const page = await api<WorkflowRunPage>(`/api/${scope}/workflow-runs?limit=10${more ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (request !== serial) return;
      records = mergeWorkflowRecords(more ? records : [], page.runs);
      cursor = page.next_cursor ?? "";
    } catch {
      if (request === serial) error = "Workflow history unavailable. Retry to load recorded runs.";
    } finally {
      finishRequest(request, scope);
    }
  }

  // Re-read all currently displayed pages after reconnect or a scoped update,
  // including an older selected run. Do not let a late response cross targets.
  async function refresh(scope: string) {
    const request = ++serial;
    const wanted = Math.max(10, records.length);
    const keepSelected = selectedID;
    loading = true;
    error = "";
    try {
      let next = "";
      let fresh: WorkflowRunRecord[] = [];
      do {
        const page = await api<WorkflowRunPage>(`/api/${scope}/workflow-runs?limit=10${next ? `&cursor=${encodeURIComponent(next)}` : ""}`);
        if (request !== serial) return;
        fresh = mergeWorkflowRecords(fresh, page.runs);
        next = page.next_cursor ?? "";
      } while (next && (fresh.length < wanted || (keepSelected && !fresh.some((record) => record.id === keepSelected))));
      records = fresh;
      cursor = next;
    } catch (cause) {
      if (request === serial) {
        if (cause instanceof APIError && (cause.status === 401 || cause.status === 403 || cause.status === 404)) {
          records = [];
          cursor = "";
          selectedID = "";
          error = "Workflow history is no longer accessible.";
        } else {
          error = "Workflow history unavailable. Showing previously loaded records.";
        }
      }
    } finally {
      finishRequest(request, scope);
    }
  }
</script>

<div class="history" aria-label="Workflow history">
  <nav aria-label="Recorded runs">
    <strong>Recorded runs</strong>
    {#if loading}<p role="status">Loading workflow history…</p>{/if}
    {#if error}<p role="alert">{error}</p><button disabled={loading} onclick={() => refresh(target)}>Retry</button>{/if}
    {#each records as record (record.id)}
      <button class:selected={selected?.id === record.id} onclick={() => selectedID = record.id}>
        <span>{record.snapshot.run.workflowName} · {record.snapshot.run.status}</span>
        <small>{record.snapshot.source.runId} · {record.producer_id}</small>
      </button>
    {/each}
    {#if cursor}<button disabled={loading} onclick={() => load(target, true)}>Load older runs</button>{/if}
    {#if !loading && !error && !records.length}<p>No durable runs reported for this conversation.</p>{/if}
  </nav>
  {#if selected}
    <p class="recorded-state">Recorded host state · revision {selected.snapshot.source.revision}. Not a live connection or decision claim.</p>
    {#if !selected.snapshot.run.stepsComplete}
      <p class="recorded-state" role="status">Step history incomplete: {selected.snapshot.steps.length} of {selected.snapshot.run.stepTotal} attempts supplied.</p>
    {/if}
  {:else if liveRun}
    <p class="recorded-state">Live-only report. Durable history has not been supplied.</p>
  {/if}
  <RunPanel run={displayedRun} {conversationLabel} {onClose} />
  {#if selected}<WorkflowFileTree files={selected.snapshot.files} />{/if}
</div>

<style>
  .history { grid-row: 1 / -1; min-height: 0; overflow-y: auto; }
  nav { padding: 12px 14px; border-bottom: 1px solid var(--line); }
  nav strong { font-size: 12px; color: var(--muted); }
  nav button { display: block; width: 100%; margin-top: 6px; padding: 7px 9px; text-align: left; border: 1px solid var(--line); border-radius: 6px; background: var(--panel-alt); color: var(--text-strong); cursor: pointer; }
  nav button.selected { border-color: var(--accent); }
  nav small { display: block; color: var(--muted); overflow-wrap: anywhere; }
  nav p, .recorded-state { font-size: 12px; color: var(--muted); }
  .recorded-state { margin: 10px 14px 0; }
</style>
