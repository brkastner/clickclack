<script lang="ts">
  import MediaAttachment from "../MediaAttachment.svelte";
  import { uploadURL } from "../../lib/uploads";
  import type { Message } from "../../lib/types";
  let { message, label, onOpen }: { message: Message; label: string; onOpen: (message: Message) => void } = $props();
  let unavailable = $state(false);
</script>
<article class="output-card" data-output-id={message.id}>
  <header><span>{label}</span><time datetime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time></header>
  <div onerrorcapture={() => unavailable = true}>
    {#each message.attachments ?? [] as upload (upload.id)}
      <MediaAttachment {upload} url={uploadURL(upload)} eager={false}
        onOpenImage={(url) => window.open(url, "_blank", "noopener,noreferrer")}
        onOpenArtifact={(file) => window.open(uploadURL(file), "_blank", "noopener,noreferrer")} />
      <a href={uploadURL(upload)} target="_blank" rel="noopener noreferrer">{upload.filename}</a>
    {/each}
  </div>
  {#if unavailable}<p role="status">Media unavailable. Open the source to check access.</p>{/if}
  {#if message.body}<p class="output-body">{message.body}</p>{/if}
  <button type="button" data-output-focus={message.id} onclick={() => onOpen(message)}>Open {message.parent_message_id ? "thread response" : "source"}</button>
</article>
<style>
  .output-card { border: 1px solid var(--border); border-radius: 10px; padding: 1rem; min-width: 0; background: var(--bg); }
  header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .5rem; color: var(--text-muted); font-size: .8rem; margin-bottom: .75rem; }
  .output-body { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 24rem; overflow: auto; }
  a { display: block; overflow-wrap: anywhere; margin: .5rem 0; }
  button { margin-top: .75rem; }
</style>
