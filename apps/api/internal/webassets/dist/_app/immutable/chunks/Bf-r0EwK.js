import{n as e,r as t,t as n}from"./DnshVVRE.js";var r=[{id:`bot:read`,label:`Read`,hint:`View channels, messages, and threads. No write access.`},{id:`bot:write`,label:`Read & write`,hint:`Post and edit messages, send DMs, upload attachments, and publish command menus.`},{id:`bot:admin`,label:`Admin`,hint:`Read & write, publish command menus, and manage channels. Use sparingly.`}],i={"bot:read":[`workspaces:read`,`channels:read`,`messages:read`,`threads:read`,`dms:read`,`realtime:read`,`profile:read`],"bot:write":[`workspaces:read`,`channels:read`,`messages:read`,`messages:write`,`threads:read`,`threads:write`,`dms:read`,`dms:write`,`realtime:read`,`uploads:write`,`profile:read`,`commands:write`],"bot:admin":[`workspaces:read`,`channels:read`,`channels:write`,`messages:read`,`messages:write`,`threads:read`,`threads:write`,`dms:read`,`dms:write`,`realtime:read`,`uploads:write`,`profile:read`,`commands:write`]};function a(e){let t=new Set;for(let n of e){t.add(n);let e=i[n];if(e)for(let n of e)t.add(n)}for(let n of[`bot:admin`,`bot:write`,`bot:read`]){let a=i[n];if(!a.every(e=>t.has(e)))continue;let o=new Set(a);return{bundle:n,bundleLabel:r.find(e=>e.id===n)?.label??n,extras:e.filter(e=>{if(e===n)return!1;let t=i[e];return t?!t.every(e=>o.has(e)):!o.has(e)})}}return{bundle:null,bundleLabel:null,extras:e}}function o(e){let t=[],n=new Set;for(let r of e){let e=i[r];for(let i of e??[r])n.has(i)||(n.add(i),t.push(i))}return t}async function s(t){return(await e(`/api/workspaces/${t}/bots`)).bots??[]}async function c(t,n){return e(`/api/workspaces/${t}/bots`,{method:`POST`,body:JSON.stringify(n)})}async function l(t,n){return(await e(`/api/workspaces/${t}/bots/${n}/tokens`)).bot_tokens??[]}async function u(t,n,r){return(await e(`/api/workspaces/${t}/bots/${n}/tokens`,{method:`POST`,body:JSON.stringify(r)})).bot_token}async function d(t,n,r){return(await e(`/api/workspaces/${t}/bots/${n}/setup-codes`,{method:`POST`,body:JSON.stringify(r)})).setup_code}async function f(t){return(await e(`/api/bot-tokens/${t}/revoke`,{method:`POST`,body:JSON.stringify({})})).bot_token}async function p(t,n){await e(`/api/workspaces/${t}/bots/${n}/membership`,{method:`DELETE`})}async function m(t,n){return(await e(`/api/bots/${t}`,{method:`PATCH`,body:JSON.stringify(n)})).bot}async function h(t){return(await e(`/api/bots/${t}`,{method:`DELETE`})).deleted_bot}async function g(){return(await e(`/api/me/bots`)).bots??[]}function _(e){if(e instanceof n){if(e.status===401)return`Sign in to manage bots.`;if(e.status===403)return`You don't have permission to manage bots in this workspace.`;if(e.status===404)return`That bot or workspace is no longer available.`;if(e.status===409)return`That handle is already taken. Try another.`;if(e.status===400)return e.message||`That request is invalid.`}return e instanceof Error?e.message:`Something went wrong`}function v(e){return!e.owner_user_id}function y(e){return e?e.filter(e=>!e.revoked_at):[]}function b(e){return e.toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-+|-+$/g,``).slice(0,32)}function x(e){return e.slug.trim()||e.id}function S(e){return JSON.stringify(e)}function C(e){let t=e.replace(/^@/,``).toUpperCase().replace(/[^A-Z0-9]+/g,`_`).replace(/^_+|_+$/g,``);return t?`CLICKCLACK_${t}_BOT_TOKEN`:`CLICKCLACK_BOT_TOKEN`}function w(e){return`'${e.replaceAll(`'`,`'"'"'`)}'`}function T(e){let n=(e.baseURL||t()||(typeof window<`u`?window.location.origin:``)).replace(/\/$/,``),r=e.botHandle.replace(/^@/,``),i=e.mode===`single`?`CLICKCLACK_BOT_TOKEN`:C(r),a=n||`https://your-clickclack.example.com`,o=e.defaultTo?.trim()||`channel:general`,s=t=>{let n=[`workspace: ${S(e.workspace)},`,`botUserId: ${S(e.botUserID)},`,`defaultTo: ${S(o)},`];return e.allowFrom&&e.allowFrom.length>0&&!e.allowFrom.includes(`*`)&&n.push(`allowFrom: [${e.allowFrom.map(S).join(`, `)}],`),e.agentActivity&&n.push(`agentActivity: true,`),n.map(e=>t+e).join(`
`)};return e.mode===`named`?`{
  channels: {
    clickclack: {
      enabled: true,
      baseUrl: ${S(a)},
      defaultAccount: ${S(r)},
      accounts: {
        ${S(r)}: {
          token: { source: "env", provider: "default", id: ${S(i)} },
${s(`          `)}
        },
      },
    },
  },
}`:`{
  channels: {
    clickclack: {
      enabled: true,
      baseUrl: ${S(a)},
      token: { source: "env", provider: "default", id: ${S(i)} },
${s(`      `)}
    },
  },
}`}function E(e){let n=e.frontendURL||(typeof window<`u`?window.location.origin:``),r=(e.apiBaseURL||t()).replace(/\/$/,``),i=(e.baseURL||r||n).replace(/\/$/,``),a=(e.claimURL||``).replace(/\/$/,``),o=a&&r&&r!==n?a:i||`https://your-clickclack.example.com/`,s=e.botHandle.replace(/^@/,``),c=e.mode===`named`?` --account ${w(s)}`:``,l=o.endsWith(`/`)?`#`:`/#`;return`openclaw channels add clickclack${c} --code ${w(a&&o===a?`${o}#${e.code}`:`${o}${l}${e.code}`)}`}function D(e){let n=(e.baseURL||t()||(typeof window<`u`?window.location.origin:``)).replace(/\/$/,``)||`https://your-clickclack.example.com`,r=e.botHandle.replace(/^@/,``);return`openclaw channels add clickclack${e.mode===`named`?` \\\n  --account ${w(r)}`:``} \\
  --base-url ${w(n)} \\
  --token ${w(e.token)} \\
  --workspace ${w(e.workspace)}`}export{p as _,T as a,a as b,d as c,o as d,v as f,x as g,s as h,E as i,u as l,l as m,y as n,D as o,g as p,_ as r,c as s,r as t,h as u,f as v,m as x,b as y};