<script lang="ts">
 import { onMount } from "svelte";
 import { api, APIError, apiURL, readableAPIError } from "../../lib/api";
 import { uploadURL } from "../../lib/uploads";
 import type { Upload } from "../../lib/types";
 import { defaultGalleryActionValues, validateGalleryActionSchema, validateGalleryActionValues, type GalleryActionDiscovery, type GalleryActionResult, type GalleryActionValues } from "../../lib/gallery-actions";
 let { action, upload, workspaceID, actorID, destinationID, onClose }: {action:GalleryActionDiscovery;upload:Upload;workspaceID:string;actorID:string;destinationID:string;onClose:()=>void}=$props();
 let dialog:HTMLDialogElement;
 let result=$state<GalleryActionResult>();let values=$state<GalleryActionValues>({});let error=$state("");let busy=$state(true);let submission=$state("");let sessionID="";let timer:ReturnType<typeof setTimeout>;let alive=true;let serial=0;
 let retryInput = $state<{request_id:string;schema_revision:number;values:GalleryActionValues}>();
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
 }
 async function poll(requestID?:string){const current=++serial;try{const next=await api<GalleryActionResult>(`/api/gallery-actions/sessions/${encodeURIComponent(sessionID)}${requestID?`?request_id=${encodeURIComponent(requestID)}`:""}`);if(!alive||current!==serial)return;accept(next);busy=next.request.state==="pending";error="";if(["pending","uncertain"].includes(next.request.state))timer=setTimeout(()=>void poll(requestID),1500);}catch(e){if(!alive||current!==serial)return;busy=false;error=readableAPIError(e,"Could not check action status");if(!(e instanceof APIError)||e.status>=500)timer=setTimeout(()=>void poll(requestID),3000);}}
 async function start(){
  try{let saved: {sessionID?:string;submission?:typeof retryInput}={};try{saved=JSON.parse(sessionStorage.getItem(storageKey)??"{}");}catch{/* New local session. */}
   sessionID=saved.sessionID??`${Math.floor(Date.now()/1000)}.${crypto.randomUUID()}`;retryInput=saved.submission;submission=retryInput?.request_id??"";sessionStorage.setItem(storageKey,JSON.stringify({sessionID,submission:retryInput}));
   try{accept(await api<GalleryActionResult>(`/api/gallery-actions/sessions/${encodeURIComponent(sessionID)}`));}catch(e){if(!(e instanceof APIError)||e.status!==404)throw e;accept(await api<GalleryActionResult>(`/api/workspaces/${encodeURIComponent(workspaceID)}/gallery-actions/open`,{method:"POST",body:JSON.stringify({session_id:sessionID,installation_id:action.installation_id,action_id:action.descriptor.id,source_upload_id:upload.id,destination_id:destinationID})}));}
   await poll(submission||undefined);
  }catch(e){if(alive){error=readableAPIError(e,"Could not open action");busy=false;}}
 }
 function reset(){if(submission&&state!=="accepted"&&state!=="failed")return;clearTimeout(timer);serial++;sessionStorage.removeItem(storageKey);result=undefined;submission="";retryInput=undefined;values={};error="";busy=true;void start();}
 async function submit(){if(busy)return;error="";
  if(!retryInput){const invalid=validateGalleryActionValues({revision:action.descriptor.schema_revision,fields},values);if(invalid){error=invalid;return;}submission=crypto.randomUUID();retryInput={request_id:submission,schema_revision:action.descriptor.schema_revision,values:structuredClone($state.snapshot(values))};sessionStorage.setItem(storageKey,JSON.stringify({sessionID,submission:retryInput}));}
  busy=true;try{accept(await api<GalleryActionResult>(`/api/gallery-actions/sessions/${encodeURIComponent(sessionID)}/submit`,{method:"POST",body:JSON.stringify(retryInput)}));}catch(e){error=readableAPIError(e,"Submission outcome unknown; checking the original identity.");}finally{if(alive){busy=false;await poll(submission);}}
 }
 async function loadChoices(fieldID:string,offset:number){if(busy||submission)return;busy=true;error="";const requestID=crypto.randomUUID();try{accept(await api<GalleryActionResult>(`/api/gallery-actions/sessions/${encodeURIComponent(sessionID)}/choices`,{method:"POST",body:JSON.stringify({request_id:requestID,schema_revision:action.descriptor.schema_revision,field_id:fieldID,offset,limit:Math.min(25,100-offset)})}));await poll(requestID);}catch(e){if(alive){error=readableAPIError(e,"Could not load choices");busy=false;}}}
 function toggle(fieldID:string,id:string,checked:boolean){const prior=values[fieldID];if(Array.isArray(prior))values={...values,[fieldID]:checked?[...prior,id]:prior.filter(value=>value!==id)};}
 onMount(()=>{const opener=document.activeElement as HTMLElement|null;dialog.showModal();void start();return()=>{alive=false;serial++;clearTimeout(timer);opener?.focus({preventScroll:true});};});
</script>
<dialog bind:this={dialog} aria-label={action.descriptor.label} oncancel={(event)=>{event.preventDefault();onClose();}}>
 <header><h2>{action.descriptor.label}</h2><button aria-label="Close action" onclick={onClose}>×</button></header>
 {#if upload.content_type.startsWith("video/")}
 <video class="preview" src={uploadURL(upload)} aria-label="Source" controls preload="metadata"><track kind="captions" /></video>
 {:else}<img class="preview" src={uploadURL(upload)} alt="Source" />{/if}
 {#if result?.session.preview_upload_id}<img class="preview" src={apiURL(`/api/uploads/${encodeURIComponent(result.session.preview_upload_id)}`)} alt="Action preview" />{/if}
 <form onsubmit={(event)=>{event.preventDefault();void submit();}}>
 <fieldset disabled={busy||!!submission||state!=="accepted"}>
 {#each fields as field (field.id)}
  {#if field.kind==="boolean"}<label><input type="checkbox" checked={values[field.id]===true} onchange={(e)=>values={...values,[field.id]:e.currentTarget.checked}} />{field.label}</label>
  {:else if field.kind==="number"}<label>{field.label}<input type="number" min={field.min} max={field.max} step={field.step??"any"} value={Number(values[field.id])} oninput={(e)=>values={...values,[field.id]:e.currentTarget.valueAsNumber}} /></label>
  {:else if field.kind==="select"}<label>{field.label}<select value={String(values[field.id]??"")} onchange={(e)=>values={...values,[field.id]:e.currentTarget.value}}>{#each field.choices as choice (choice.id)}<option value={choice.id}>{choice.label}</option>{/each}</select></label>
  {:else}<section aria-label={field.label}><h3>{field.label}</h3><div class="choices">{#each field.choices as choice (choice.id)}<label><input type="checkbox" checked={Array.isArray(values[field.id])&&(values[field.id] as string[]).includes(choice.id)} onchange={(e)=>toggle(field.id,choice.id,e.currentTarget.checked)} />{#if choice.upload_id}<img src={apiURL(`/api/uploads/${encodeURIComponent(choice.upload_id)}`)} alt={choice.label} />{/if}<span>{choice.label}</span></label>{/each}</div>{#if field.dynamic&&field.choices.length<100}<button type="button" onclick={()=>void loadChoices(field.id,field.choices.length)}>Load choices</button>{/if}</section>{/if}
 {/each}
 </fieldset>
 <p role="status">{submission?`Submission ${state}`:busy?"Waiting for action…":`Panel ${state}`}</p>
 {#if error}<p role="alert">{error}</p>{/if}
 <button type="submit" disabled={busy||(!retryInput&&state!=="accepted")||(!!submission&&result?.request.kind==="submit")}>{submission?"Retry original submission":"Submit"}</button>
 {#if !busy && ((!submission && !!error) || (!!submission && (state==="accepted" || state==="failed")))}<button type="button" onclick={reset}>Start new panel</button>{/if}
 <button type="button" onclick={onClose}>Close</button>
 </form>
</dialog>
<style>
 dialog{width:min(600px,90vw);max-height:85vh;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:1.2rem;background:var(--panel);color:var(--text)}dialog::backdrop{background:rgb(0 0 0 / .55)}header{display:flex;justify-content:space-between;align-items:center}h2{font-size:1.15rem}fieldset{border:0;padding:0;display:grid;gap:1rem}label{display:flex;align-items:center;gap:.6rem}input[type=number],select{margin-left:auto;max-width:12rem}button,input,select{font:inherit}button{padding:.45rem .7rem;margin:.25rem}.preview{max-width:100%;max-height:180px;object-fit:contain}.choices{display:flex;flex-wrap:wrap;gap:.7rem}.choices label{display:grid;max-width:100px}.choices img{width:80px;height:80px;object-fit:contain}[role=alert]{color:var(--danger,#e88)}
</style>
