<script lang="ts">
 import { onMount } from "svelte";
 import { api, APIError, apiURL, readableAPIError } from "../../lib/api";
 import { uploadURL } from "../../lib/uploads";
 import type { Upload } from "../../lib/types";
 import { defaultGalleryActionValues, validateGalleryActionSchema, validateGalleryActionValues, type GalleryActionDiscovery, type GalleryActionResult, type GalleryActionValues } from "../../lib/gallery-actions";
 let { action, upload, workspaceID, actorID, destinationID, onClose, onStatus }: {action:GalleryActionDiscovery;upload:Upload;workspaceID:string;actorID:string;destinationID:string;onClose:()=>void;onStatus?:(message:string,failed:boolean)=>void}=$props();
 let dialog = $state<HTMLDialogElement>();
 let result=$state<GalleryActionResult>();let values=$state<GalleryActionValues>({});let error=$state("");let busy=$state(true);let submission=$state("");let sessionID="";let timer:ReturnType<typeof setTimeout>;let alive=true;let serial=0;
 let retryInput = $state<{request_id:string;schema_revision:number;values:GalleryActionValues}>();
 let instantStarted=false;
 const instant=$derived(action.descriptor.fields.length===0);
 const storageKey=$derived(`gallery-action:${actorID}:${workspaceID}:${action.installation_id}:${action.descriptor.id}:${upload.id}:${destinationID}`);
 const fields=$derived(result?.session.descriptor.fields??action.descriptor.fields);
 const state=$derived(result?.request.state??"pending");
 function accept(next:GalleryActionResult){
  if(!alive||next.session.id!==sessionID)return;
  const authorized=new Set<string>();for(const f of next.session.descriptor.fields)if("choices" in f)for(const c of f.choices)if(c.upload_id)authorized.add(c.upload_id);
  if(next.session.preview_upload_id)authorized.add(next.session.preview_upload_id);
  const schema=validateGalleryActionSchema({revision:next.session.descriptor.schema_revision,fields:next.session.descriptor.fields,...(next.session.preview_upload_id?{preview:next.session.preview_upload_id}:{})},authorized);
  if(!schema)throw new Error("Unsupported action schema");
  if(!result)values=defaultGalleryActionValues(schema);
  result=next;submission=next.session.submission_id??submission;
  if(next.request.kind==="submit"&&"values" in next.request.payload)values=next.request.payload.values;
  if(instant&&next.request.kind==="open"&&next.request.state==="accepted"&&!instantStarted){instantStarted=true;queueMicrotask(()=>void submit());}
  if(instant&&next.request.kind==="submit"&&(next.request.state==="accepted"||next.request.state==="failed")){onStatus?.(next.request.state==="accepted"?`${action.descriptor.label} complete`:`${action.descriptor.label} failed`,next.request.state==="failed");queueMicrotask(onClose);}
 }
 async function poll(requestID?:string){const current=++serial;try{const next=await api<GalleryActionResult>(`/api/gallery-actions/sessions/${encodeURIComponent(sessionID)}${requestID?`?request_id=${encodeURIComponent(requestID)}`:""}`);if(!alive||current!==serial)return;accept(next);busy=next.request.state==="pending";error=next.request.state==="uncertain"?(next.request.kind==="open"?"The action provider could not be reached. Start a new panel to try again.":"The action provider did not confirm the request. Its outcome is unknown."):"";if(next.request.state==="pending")timer=setTimeout(()=>void poll(requestID),1500);}catch(e){if(!alive||current!==serial)return;busy=false;error=readableAPIError(e,"Could not check action status");if(!(e instanceof APIError)||e.status>=500)timer=setTimeout(()=>void poll(requestID),3000);}}
 async function start(){
  try{let saved: {sessionID?:string;submission?:typeof retryInput}={};try{saved=JSON.parse(sessionStorage.getItem(storageKey)??"{}");}catch{/* New local session. */}
   sessionID=saved.sessionID??`${Math.floor(Date.now()/1000)}.${crypto.randomUUID()}`;retryInput=saved.submission;submission=retryInput?.request_id??"";sessionStorage.setItem(storageKey,JSON.stringify({sessionID,submission:retryInput}));
   try{accept(await api<GalleryActionResult>(`/api/gallery-actions/sessions/${encodeURIComponent(sessionID)}`));}catch(e){if(!(e instanceof APIError)||e.status!==404)throw e;accept(await api<GalleryActionResult>(`/api/workspaces/${encodeURIComponent(workspaceID)}/gallery-actions/open`,{method:"POST",body:JSON.stringify({session_id:sessionID,installation_id:action.installation_id,action_id:action.descriptor.id,source_upload_id:upload.id,destination_id:destinationID})}));}
   await poll(submission||undefined);
  }catch(e){if(alive){error=readableAPIError(e,"Could not open action");busy=false;if(instant){onStatus?.(error,true);onClose();}}}
 }
 function reset(){if(submission&&state!=="accepted"&&state!=="failed")return;clearTimeout(timer);serial++;sessionStorage.removeItem(storageKey);result=undefined;submission="";retryInput=undefined;values={};error="";busy=true;void start();}
 async function submit(){if(busy)return;error="";
  if(!retryInput){const invalid=validateGalleryActionValues({revision:action.descriptor.schema_revision,fields},values);if(invalid){error=invalid;return;}submission=crypto.randomUUID();retryInput={request_id:submission,schema_revision:action.descriptor.schema_revision,values:structuredClone($state.snapshot(values))};sessionStorage.setItem(storageKey,JSON.stringify({sessionID,submission:retryInput}));}
  busy=true;try{accept(await api<GalleryActionResult>(`/api/gallery-actions/sessions/${encodeURIComponent(sessionID)}/submit`,{method:"POST",body:JSON.stringify(retryInput)}));}catch(e){error=readableAPIError(e,"Submission outcome unknown; checking the original identity.");}finally{if(alive){busy=false;await poll(submission);}}
 }
 async function loadChoices(fieldID:string,offset:number){if(busy||submission)return;busy=true;error="";const requestID=crypto.randomUUID();try{accept(await api<GalleryActionResult>(`/api/gallery-actions/sessions/${encodeURIComponent(sessionID)}/choices`,{method:"POST",body:JSON.stringify({request_id:requestID,schema_revision:action.descriptor.schema_revision,field_id:fieldID,offset,limit:Math.min(25,500-offset)})}));await poll(requestID);}catch(e){if(alive){error=readableAPIError(e,"Could not load choices");busy=false;}}}
 function toggle(fieldID:string,id:string,checked:boolean){const prior=values[fieldID];if(Array.isArray(prior))values={...values,[fieldID]:checked?[...prior,id]:prior.filter(value=>value!==id)};}
 onMount(()=>{const opener=document.activeElement as HTMLElement|null;if (!instant) dialog?.showModal();void start();return()=>{alive=false;serial++;clearTimeout(timer);opener?.focus({preventScroll:true});};});
</script>
{#if !instant}<dialog bind:this={dialog} aria-label={action.descriptor.label} oncancel={(event)=>{event.preventDefault();onClose();}}>
 <header>
  <div><span class="eyebrow">gallery action</span><h2>{action.descriptor.label}</h2></div>
  <button class="icon-button" type="button" aria-label="Close action" onclick={onClose}>×</button>
 </header>
 <div class="panel-body">
  <div class="source-preview">
   <span class="eyebrow">source</span>
   {#if upload.content_type.startsWith("video/")}<video class="preview" src={uploadURL(upload)} aria-label="Source" controls preload="metadata"><track kind="captions" /></video>
   {:else}<img class="preview" src={uploadURL(upload)} alt="Source" />{/if}
  </div>
  {#if result?.session.preview_upload_id}<div class="source-preview"><span class="eyebrow">preview</span><img class="preview" src={apiURL(`/api/gallery-actions/sessions/${encodeURIComponent(sessionID)}/uploads/${encodeURIComponent(result.session.preview_upload_id)}`)} alt="Action preview" /></div>{/if}
 </div>
 <form onsubmit={(event)=>{event.preventDefault();void submit();}}>
  <fieldset disabled={busy||!!submission||state!=="accepted"}>
   {#each fields as field (field.id)}
    {#if field.kind==="boolean"}<label class="toggle-row"><input type="checkbox" checked={values[field.id]===true} onchange={(e)=>values={...values,[field.id]:e.currentTarget.checked}} /><span>{field.label}</span></label>
    {:else if field.kind==="number"}<label class="field-row"><span>{field.label}</span><input type="number" min={field.min} max={field.max} step={field.step??"any"} value={Number(values[field.id])} oninput={(e)=>values={...values,[field.id]:e.currentTarget.valueAsNumber}} /></label>
    {:else if field.kind==="select"}<label class="field-row"><span>{field.label}</span><select value={String(values[field.id]??"")} onchange={(e)=>values={...values,[field.id]:e.currentTarget.value}}>{#each field.choices as choice (choice.id)}<option value={choice.id}>{choice.label}</option>{/each}</select></label>
    {:else}<section class="choice-field" aria-label={field.label}><div class="choice-heading"><div><h3>{field.label}</h3><p>Pick up to {field.max} reference{field.max===1?"":"s"}.</p></div>{#if field.dynamic&&field.choices.length<500}<button class="secondary-button" type="button" onclick={()=>void loadChoices(field.id,field.choices.length)}>{busy?"Loading…":field.choices.length?"Load more":"Load choices"}</button>{/if}</div>{#if field.choices.length}<div class="choices">{#each field.choices as choice (choice.id)}<label class:selected={Array.isArray(values[field.id])&&(values[field.id] as string[]).includes(choice.id)}><input type="checkbox" checked={Array.isArray(values[field.id])&&(values[field.id] as string[]).includes(choice.id)} onchange={(e)=>toggle(field.id,choice.id,e.currentTarget.checked)} />{#if choice.upload_id}<img src={apiURL(`/api/gallery-actions/sessions/${encodeURIComponent(sessionID)}/uploads/${encodeURIComponent(choice.upload_id)}`)} alt="" />{/if}<span>{choice.label}</span></label>{/each}</div>{:else}<p class="empty-choices">Load choices to pick reference images.</p>{/if}</section>{/if}
   {/each}
  </fieldset>
  <div class="status-row"><span class:working={busy}></span><p role="status">{submission?`Submission ${state}`:busy?"Connecting to action provider…":state==="accepted"?"Ready":"Panel unavailable"}</p></div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <footer>
   <button class="primary-button" type="submit" disabled={busy||(!retryInput&&state!=="accepted")||(!!submission&&result?.request.kind==="submit")}>{submission?"Retry original submission":"Run action"}</button>
   {#if !busy && ((!submission && (!!error || state==="failed")) || (!!submission && (state==="accepted" || state==="failed")))}<button class="secondary-button" type="button" onclick={reset}>Start new panel</button>{/if}
   <button class="ghost-button" type="button" onclick={onClose}>Cancel</button>
  </footer>
 </form>
</dialog>{/if}
<style>
 dialog{width:min(680px,calc(100vw - 2rem));max-height:min(88vh,760px);overflow:auto;border:1px solid var(--line-strong);border-radius:var(--radius-xl,16px);padding:0;background:var(--panel);color:var(--text);box-shadow:var(--key-edge),0 28px 80px rgb(0 0 0 / .45)}
 dialog::backdrop{background:color-mix(in srgb,var(--bg) 38%,transparent);backdrop-filter:blur(8px)}
 header{position:sticky;z-index:2;top:0;display:flex;align-items:center;justify-content:space-between;padding:1rem 1.15rem;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--panel) 94%,transparent);backdrop-filter:blur(14px)}
 h2,h3,p{margin:0}h2{margin-top:.15rem;color:var(--text-strong);font-size:1.2rem;letter-spacing:-.02em}h3{color:var(--text-strong);font-size:.95rem}.eyebrow{color:var(--muted);font-size:.68rem;font-weight:750;letter-spacing:.09em;text-transform:uppercase}
 .icon-button,.primary-button,.secondary-button,.ghost-button,input,select{font:inherit}.icon-button{display:grid;width:2rem;height:2rem;border:1px solid var(--line);border-radius:50%;background:var(--panel-2);color:var(--muted);font-size:1.25rem;cursor:pointer;place-items:center}.icon-button:hover{border-color:var(--accent);color:var(--text)}
 .panel-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;padding:1rem 1.15rem 0}.source-preview{display:grid;gap:.45rem;min-width:0;padding:.55rem;border:1px solid var(--line);border-radius:var(--radius-lg,12px);background:var(--surface)}.preview{display:block;width:100%;height:150px;border-radius:calc(var(--radius-lg,12px) - 4px);background:var(--bg);object-fit:contain}
 form{padding:1rem 1.15rem 1.15rem}fieldset{display:grid;margin:0;padding:0;border:0;gap:.65rem}fieldset:disabled{opacity:.58}.field-row,.toggle-row{display:flex;min-height:2.8rem;align-items:center;justify-content:space-between;gap:1rem;padding:.6rem .75rem;border:1px solid var(--line);border-radius:var(--radius,8px);background:var(--surface);color:var(--text)}.toggle-row{justify-content:flex-start}.toggle-row input{accent-color:var(--accent)}input[type=number],select{min-height:2.1rem;max-width:12rem;padding:0 .6rem;border:1px solid var(--line-strong);border-radius:6px;background:var(--panel-2);color:var(--text)}select option{background:var(--panel-2);color:var(--text)}
 .choice-field{display:grid;gap:.75rem;padding:.8rem;border:1px solid var(--line);border-radius:var(--radius-lg,12px);background:var(--surface)}.choice-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem}.choice-heading p,.empty-choices{margin-top:.2rem;color:var(--muted);font-size:.78rem}.empty-choices{padding:.9rem;border:1px dashed var(--line-strong);border-radius:8px;text-align:center}.choices{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:.6rem}.choices label{position:relative;display:grid;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);cursor:pointer}.choices label:hover,.choices label.selected{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 20%,transparent)}.choices input{position:absolute;z-index:1;top:.45rem;right:.45rem;width:1rem;height:1rem;accent-color:var(--accent)}.choices img{display:block;width:100%;height:96px;background:var(--bg);object-fit:cover}.choices span{overflow:hidden;padding:.5rem .55rem;color:var(--text);font-size:.78rem;text-overflow:ellipsis;white-space:nowrap}
 .status-row{display:flex;align-items:center;gap:.5rem;min-height:2rem;margin-top:.75rem;color:var(--muted);font-size:.78rem}.status-row>span{width:.5rem;height:.5rem;border-radius:50%;background:var(--success,var(--accent))}.status-row>span.working{animation:pulse 1.2s infinite;background:var(--accent)}.error{margin:.2rem 0 .75rem;padding:.65rem .75rem;border:1px solid color-mix(in srgb,var(--danger) 40%,var(--line));border-radius:8px;background:color-mix(in srgb,var(--danger) 9%,var(--panel));color:var(--danger)}
 footer{display:flex;align-items:center;gap:.55rem;padding-top:.45rem}.primary-button,.secondary-button,.ghost-button{min-height:2.35rem;padding:0 .8rem;border-radius:7px;cursor:pointer}.primary-button{border:1px solid var(--accent);background:var(--accent);color:var(--accent-contrast);font-weight:750}.primary-button:hover:not(:disabled){background:var(--accent-hover)}.secondary-button{border:1px solid var(--line-strong);background:var(--panel-2);color:var(--text)}.secondary-button:hover:not(:disabled),.ghost-button:hover:not(:disabled){border-color:var(--accent);background:var(--hover-strong)}.ghost-button{margin-left:auto;border:1px solid transparent;background:transparent;color:var(--muted)}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button:disabled{cursor:not-allowed;opacity:.5}
 @keyframes pulse{50%{opacity:.35;transform:scale(.8)}}@media(max-width:540px){.panel-body{grid-template-columns:1fr}.choice-heading{align-items:flex-start;flex-direction:column}.choices{grid-template-columns:repeat(2,minmax(0,1fr))}footer{align-items:stretch;flex-direction:column}.ghost-button{margin-left:0}}
</style>
