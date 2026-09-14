import test from 'node:test';
import assert from 'node:assert/strict';
import { ClickClackClient } from '../dist/index.js';
test('gallery SDK sends scoped registration, exact request bodies and stable identities',async()=>{
 const calls=[];
 const client=new ClickClackClient({baseUrl:'https://host.example',token:'synthetic-token',fetch:async(url,init)=>{calls.push({url:String(url),...init});return new Response(JSON.stringify({gallery_actions:[],request:{},session:{}}),{headers:{'Content-Type':'application/json'}});}});
 const sessionId=client.galleryActions.newSessionId();
 await client.bots.setGalleryActions('app-1',[]);
 await client.galleryActions.list('w','u','destination');
 await client.galleryActions.open('w',{session_id:sessionId,installation_id:'app-1',action_id:'synthetic.adjust',source_upload_id:'u',destination_id:'destination'});
 await client.galleryActions.choices(sessionId,{request_id:'c',schema_revision:1,field_id:'images',offset:0,limit:25});
 const submit={request_id:'original-submission',schema_revision:1,values:{confirm:true}};
 await client.galleryActions.submit(sessionId,submit);await client.galleryActions.submit(sessionId,submit);
 await client.galleryActions.status(sessionId,'original-submission');
 await client.galleryActions.respond('original-submission',{session_id:sessionId,schema_revision:1,state:'accepted'});
 assert.deepEqual(JSON.parse(calls[0].body),{installation_id:'app-1',gallery_actions:[]});
 assert.match(calls[1].url,/source_upload_id=u&destination_id=destination/);
 assert.deepEqual(JSON.parse(calls[3].body),{request_id:'c',schema_revision:1,field_id:'images',offset:0,limit:25});
 assert.equal(calls[4].body,calls[5].body);
 assert.ok(calls[6].url.endsWith(`/sessions/${sessionId}?request_id=original-submission`));
 assert.match(calls[7].url,/bots\/self\/gallery-actions\/requests\/original-submission\/response$/);
 assert.deepEqual(JSON.parse(calls[7].body),{session_id:sessionId,schema_revision:1,state:'accepted'});
});

test("session identity carries a bounded issue time",()=>{const client=new ClickClackClient({baseUrl:"https://example.com"});const id=client.galleryActions.newSessionId();assert.match(id,/^\d+\.[a-f0-9-]{36}$/);assert.ok(Math.abs(Number(id.split(".")[0])-Date.now()/1000)<2);});
