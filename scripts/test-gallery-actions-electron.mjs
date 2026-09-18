import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile, mkdtemp } from 'node:fs/promises';
import { _electron as electron, expect } from '@playwright/test';
const webRequire=createRequire(new URL('../apps/web/package.json',import.meta.url));
const desktopRequire=createRequire(new URL('../apps/desktop/package.json',import.meta.url));
const {createServer}=await import(webRequire.resolve('vite'));
const {svelte}=await import(webRequire.resolve('@sveltejs/vite-plugin-svelte'));
const root=fileURLToPath(new URL('../apps/web/tests/electron/gallery-actions',import.meta.url));
const server=await createServer({configFile:false,root,plugins:[svelte({configFile:false})],resolve:{alias:[{find:'$app/navigation',replacement:`${root}/navigation.ts`},{find:/.*\/lib\/realtime\.svelte$/,replacement:`${root}/realtime.ts`}]},server:{host:'127.0.0.1',port:0,fs:{allow:[fileURLToPath(new URL('..',import.meta.url))]}}});
let app;
const evidence=await mkdtemp('/tmp/clickclack-gallery-actions-electron-');
try{
 await server.listen();
 app=await electron.launch({executablePath:desktopRequire('electron'),args:['--no-sandbox','--ozone-platform=x11',`--user-data-dir=${evidence}/profile`,`${root}/main.cjs`],env:{...process.env,WAYLAND_DISPLAY:'',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const user={id:'owner',kind:'human',display_name:'Owner',handle:'owner'};
 const bot={id:'bot',kind:'bot',display_name:'Synthetic photo lab',handle:'lab'};
 const upload={id:'source',filename:'sample.png',content_type:'image/png',width:320,height:180,byte_size:1};
 const message={id:'output',workspace_id:'workspace',channel_id:'channel',author_id:'bot',author:bot,body:'Synthetic',created_at:'2026-09-13T00:00:00Z',attachments:[upload]};
 const ownUpload={id:'own-source',filename:'mine.png',content_type:'image/png',width:320,height:180,byte_size:1};
 const ownMessage={id:'own-output',workspace_id:'workspace',channel_id:'channel',author_id:'owner',author:user,body:'Mine',created_at:'2026-09-13T00:00:01Z',attachments:[ownUpload]};
 const descriptor={version:1,id:'synthetic.adjust',label:'Adjust image',accepted_media_types:['image/png'],schema_revision:1,fields:[{id:'confirm',kind:'boolean',label:'Confirm',default:true},{id:'amount',kind:'number',label:'Amount',min:0,max:10,step:.5,default:1},{id:'format',kind:'select',label:'Format',choices:[{id:'png',label:'PNG'}]},{id:'images',kind:'images',label:'References',choices:[],min:0,max:2,dynamic:true}]};
 let enabled=true;let manyOutputs=false;let delayOutputs=false;let providerUnavailable=true;let session;const requests=new Map();const submissions=[];
 await page.route('**/api/**',async route=>{
 const r=route.request();const url=new URL(r.url());const path=url.pathname;let json;
 if(path==='/api/me')json={user};
 else if(path==='/api/workspaces')json={workspaces:[{id:'workspace',route_id:'w',name:'Synthetic'}]};
 else if(path.endsWith('/members'))json={members:[{user:bot,role:'bot'}],has_more:false};
 else if(path.endsWith('/channels'))json={channels:[{id:'channel',name:'outputs'}]};
 else if(path==='/api/dms')json={conversations:[{id:'dm-lab',route_id:'dm-lab',workspace_id:'workspace',created_at:'2026-09-13T00:00:00Z',members:[user,bot],can_send:true}]};
 else if(path.endsWith('/outputs')){if(delayOutputs)await new Promise(resolve=>setTimeout(resolve,500));const outputs=manyOutputs?Array.from({length:24},(_,index)=>({...message,id:`output-${index}`,created_at:`2026-09-13T00:00:${String(index).padStart(2,'0')}Z`})):[message];json={outputs:url.searchParams.get('include_own')==='true'?[ownMessage,...outputs]:outputs,next_cursor:null};}
 else if(path.startsWith('/api/uploads/')){const video=upload.content_type.startsWith('video/')&&path.endsWith('/source');return route.fulfill({contentType:video?'video/webm':'image/png',body:await readFile(`${root}/${video?'preview.webm':'preview.png'}`)});}
 else if(path.endsWith('/gallery-actions'))json={gallery_actions:enabled?[{installation_id:'app',descriptor}]:[]};
 else if(path.endsWith('/gallery-actions/open')){const b=r.postDataJSON();session={id:b.session_id,actor_id:'owner',workspace_id:'workspace',installation_id:'app',source_upload_id:'source',destination_id:'channel',descriptor:structuredClone(descriptor),expires_at:Math.floor(Date.now()/1000)+1800,capability_revision:'one'};const request={request_id:`${session.id}.open`,session_id:session.id,kind:'open',state:providerUnavailable?'uncertain':'accepted',payload:b,subscription_id:'sub'};requests.set(request.request_id,request);json={session,request};}
 else if(path.endsWith('/choices')){const b=r.postDataJSON();session.descriptor.fields[3].choices=[{id:'reference',label:'Reference',upload_id:'preview'}];session.preview_upload_id='preview';const request={request_id:b.request_id,session_id:session.id,kind:'choices',state:'accepted',payload:b,subscription_id:'sub'};requests.set(b.request_id,request);json={session,request};}
 else if(path.endsWith('/submit')){const b=r.postDataJSON();submissions.push(b);session.submission_id=b.request_id;const request={request_id:b.request_id,session_id:session.id,kind:'submit',state:'uncertain',payload:b,subscription_id:'sub'};requests.set(b.request_id,request);json={session,request};}
 else if(path.includes('/gallery-actions/sessions/')){if(!session)return route.fulfill({status:404,json:{error:'not found'}});const request=requests.get(url.searchParams.get('request_id')||session.submission_id||`${session.id}.open`);json={session,request};}
 else return route.fulfill({status:404,json:{error:'fixture route missing'}});
 return route.fulfill({json});
 });
 await page.goto(server.resolvedUrls.local[0]);
 await page.getByLabel('gallery source account').selectOption('bot');
 const card=page.locator('.output-card');await expect(card).toHaveCount(1);
 const showMine=page.getByLabel('show mine');await expect(showMine).not.toBeChecked();await showMine.check();await expect(card).toHaveCount(2);await showMine.uncheck();await expect(card).toHaveCount(1);
 manyOutputs=true;await page.getByRole('button',{name:'refresh',exact:true}).click();await expect(card).toHaveCount(24);
 const gallery=page.locator('.output-gallery');await gallery.evaluate(element=>{element.style.height='280px';element.scrollTop=element.scrollHeight;});const beforeRefresh=await gallery.evaluate(element=>element.scrollTop);assert.ok(beforeRefresh>0);
 delayOutputs=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(100);await expect(card).toHaveCount(24);await expect.poll(()=>gallery.evaluate(element=>element.scrollTop)).toBeGreaterThan(beforeRefresh*.8);delayOutputs=false;
 manyOutputs=false;await page.getByRole('button',{name:'refresh',exact:true}).click();await expect(card).toHaveCount(1);
 const options=page.getByRole('button',{name:'Media options for sample.png'});
 await options.click();await page.getByRole('menuitem',{name:'Adjust image'}).click();
 const panel=page.getByRole('dialog',{name:'Adjust image'});await expect(panel).toBeVisible();
 await expect(panel.getByRole('alert')).toContainText('provider could not be reached');
 providerUnavailable=false;session=undefined;requests.clear();await panel.getByRole('button',{name:'Start new panel'}).click();
 await expect(panel.getByRole('button',{name:'Run action',exact:true})).toBeEnabled();
 await panel.getByLabel('Amount').fill('2.5');await panel.getByRole('button',{name:'Load choices'}).click();
 await panel.getByLabel('Reference',{exact:true}).check();await expect(panel.getByAltText('Action preview')).toBeVisible();
 await page.screenshot({path:`${evidence}/panel.png`});
 await panel.getByRole('button',{name:'Run action',exact:true}).dblclick();await expect(panel.getByRole('status')).toContainText('uncertain');assert.equal(submissions.length,1);assert.deepEqual(submissions[0].values,{confirm:true,amount:2.5,format:'png',images:['reference']});
 await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(options).toBeFocused();
 await options.press('Shift+F10');await page.getByRole('menuitem',{name:'Adjust image'}).click();await expect(panel.getByRole('status')).toContainText('uncertain');assert.equal(submissions.length,1);
 await page.keyboard.press('Escape');enabled=false;
 await options.click();await expect(page.getByRole('menuitem',{name:'Adjust image'})).toHaveCount(0);
 await page.getByRole('menuitem',{name:'Add to pending message'}).click();const pending=page.getByLabel('Pending gallery attachments');await expect(pending).toContainText('1 pending');await expect(pending.getByRole('button',{name:'add to @lab message'})).toBeVisible();
 await page.screenshot({path:`${evidence}/no-plugin.png`});assert.deepEqual(errors,[]);
 // A video descriptor must render a native video source preview, never an img.
 enabled=true;session=undefined;requests.clear();
 await page.evaluate(()=>sessionStorage.clear());
 upload.filename='sample.webm';upload.content_type='video/webm';
 descriptor.label='Adjust video';descriptor.accepted_media_types=['video/webm'];
 await page.reload();await page.getByLabel('gallery source account').selectOption('bot');
 await page.getByRole('button',{name:'Media options for sample.webm'}).click();
 await page.getByRole('menuitem',{name:'Adjust video'}).click();
 const videoPanel=page.getByRole('dialog',{name:'Adjust video'});
 const sourceVideo=videoPanel.locator('video[aria-label="Source"]');
 await expect(sourceVideo).toBeVisible();await expect(sourceVideo).toHaveAttribute('controls','');
 await expect(sourceVideo).toHaveAttribute('preload','metadata');
 await expect(sourceVideo).toHaveAttribute('src',/\/api\/uploads\/source/);
 await expect.poll(()=>sourceVideo.evaluate(video=>video.readyState)).toBeGreaterThanOrEqual(1);
 assert.equal(await sourceVideo.evaluate(video=>video.videoWidth),320);
 await expect(videoPanel.locator('img[alt="Source"]')).toHaveCount(0);
 await page.screenshot({path:`${evidence}/video-panel.png`});assert.deepEqual(errors,[]);

 console.log(`gallery action Electron passed: ${evidence}`);
}finally{await app?.close();await server.close();}
