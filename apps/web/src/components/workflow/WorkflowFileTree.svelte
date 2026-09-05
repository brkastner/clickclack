<script lang="ts">
  import { workflowFileTree, type WorkflowFiles, type WorkflowFileNode } from "../../lib/chat/workflow-snapshots";
  let { files }: { files: WorkflowFiles | null } = $props();
  let tree = $derived(files ? workflowFileTree(files) : []);
</script>

{#snippet nodes(entries: WorkflowFileNode[])}
  <ul>
    {#each entries as node (node.path)}
      <li>
        {#if node.children.length}
          <details>
            <summary>{node.name}/</summary>
            {@render nodes(node.children)}
          </details>
        {/if}
        {#if node.entry}
          <span title={node.path}>{node.name}</span>
          <small>{node.entry.change}</small>
          {#if node.entry.oldPath}<small>from {node.entry.oldPath}</small>{/if}
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<section aria-label="Changed files">
  <h3>Changed files</h3>
  {#if files === null}
    <p>File evidence unavailable. No clean workspace is implied.</p>
  {:else}
    <p>Cumulative changes since base <code>{files.baseRevision}</code>.</p>
    {#if files.attribution === "includes-preexisting-changes"}
      <p role="status">Includes pre-existing changes; not all changes belong to this run.</p>
    {/if}
    {#if files.truncated}<p role="status">File list truncated.</p>{/if}
    {#if !files.complete}<p role="status">File evidence incomplete.</p>{/if}
    {#if !tree.length}
      <p>{files.complete ? "No changed files reported since base." : "No file entries supplied."}</p>
    {:else}
      {@render nodes(tree)}
    {/if}
  {/if}
</section>

<style>
  section { padding: 14px; border-top: 1px solid var(--line); font-size: 12.5px; }
  h3 { font-size: 12px; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
  p { color: var(--muted); overflow-wrap: anywhere; }
  ul { list-style: none; padding-left: 12px; margin: 6px 0; }
  li { margin: 6px 0; overflow-wrap: anywhere; }
  summary { cursor: pointer; color: var(--text-strong); }
  small { color: var(--muted); margin-left: 6px; }
</style>
