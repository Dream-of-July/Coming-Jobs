#!/usr/bin/env node
/** Optional real-browser QA. All user actions and uploads here are explicitly synthetic simulations. */
import assert from 'node:assert/strict';
import {rmSync} from 'node:fs';
import {batchFixture,approveBatch} from '../plugins/coming-jobs/tests/batch-helpers.mjs';
import {startSyntheticPortal} from './synthetic-portal.mjs';
import {itinerary} from '../plugins/coming-jobs/src/execution.mjs';
import {browserExecutable} from '../plugins/coming-jobs/src/materials.mjs';
import {call} from '../plugins/coming-jobs/src/service.mjs';
import {now} from '../plugins/coming-jobs/src/core.mjs';
const args=process.argv.slice(2),host=args[args.indexOf('--host')+1];if(!['codex','claude'].includes(host))throw Error('Use --host codex|claude');process.env.JOBOS_HOST=host;
let chromium;try{({chromium}=await import(process.env.JOBOS_PLAYWRIGHT||'playwright'));}catch{throw Error('Optional Playwright is unavailable. Select an installed module with JOBOS_PLAYWRIGHT; no dependency is installed.');}
const e=batchFixture(null,3),portals=[],pages=[],browser=await chromium.launch({headless:true,executablePath:browserExecutable()??undefined});
try{
 for(const [i,variant] of ['parsing_overwrite','single_submit','result'].entries()){
  const portal=await startSyntheticPortal({variant,requireOtp:variant==='single_submit'});portals.push(portal);const page=await browser.newPage();pages.push(page);await page.goto(portal.url);
  const s=e.apps[i],groups=s.plan.groups.map(g=>({...g,fields:g.fields.map(({material,local_file,evidence_versions,value_kind,manual,...f})=>f)}));if(variant==='single_submit')groups[0].fields.push({key:'declaration',label:'合成诚信承诺书（本人处理）',type:'sensitive_user_owned',required:true});
  s.plan=e.run('plan',{application_id:s.app.id,portal_url:portal.url,page_fingerprint:'synthetic-browser-v1',groups}).plan;
 }
 const b=e.run('apply_batch',{operation:'start',application_ids:e.apps.map(s=>s.app.id),session_id:'synthetic-session'});approveBatch(e,b);
 for(const [i,s] of e.apps.entries()){
  const page=pages[i],plan=s.plan,fieldList=plan.groups.flatMap(g=>g.fields),single=portals[i].state.variant==='single_submit',persistence=single?{single_submit:true,persistence_ref:'Synthetic actual form has no save button or save endpoint'}:{},read=async()=>await page.locator('input,select,textarea').evaluateAll(es=>es.filter(e=>e.id!=='synthetic_otp').map(e=>({key:e.id,type:e.id==='declaration'?'sensitive_user_owned':e.type==='file'?'file_upload':e.tagName==='SELECT'?'portal_select':'free_text',required:e.required,label:e.id,value:e.type==='checkbox'?e.checked:e.value,read_state:'known'})));
  if(single)assert.equal(await page.locator('#save').count(),0);
  for(const spec of itinerary(plan)){
   let controls=await read();const before=spec.field_keys.map(key=>{const o=controls.find(c=>c.key===key);return {key,read_state:'known',...(key==='cv'?{file_count:0}:{value:o.value})};});const protectedBefore=controls.filter(c=>c.key!=='cv'&&c.key!=='declaration').map(({key,value,read_state})=>({key,value,read_state}));
   const base={application_id:s.app.id,plan_hash:plan.content_hash,session_id:'synthetic-session',portal_url:portals[i].url,page_fingerprint:plan.page_fingerprint,observed_at:now(),batch_number:spec.number,controls,...persistence};
   e.run('checkpoint',{...base,phase:'prepare',protected_fields:protectedBefore,groups:[{key:spec.group_key,fields:before}]});
   for(const key of spec.field_keys){const f=fieldList.find(f=>f.key===key);if(key==='cv'){
    // In the Claude profile this is the test harness simulating the user's grouped drag/drop, not a Claude upload capability.
    await page.locator('#cv').setInputFiles(f.local_file);await page.locator('#upload[data-complete="true"]').waitFor();
   }else if(f.type==='agreement')await page.locator('#'+key).check();else await page.locator('#'+key).fill(String(f.value));}
   if(!single){await page.locator('#save').click();await page.locator('#status').filter({hasText:'已暂存'}).waitFor();}
   const fields=await Promise.all(spec.field_keys.map(async key=>{const f=fieldList.find(f=>f.key===key);if(key!=='cv')return {key,value:await page.locator('#'+key).inputValue(),read_state:'known'};return {key,read_state:'known',upload_complete:true,local_sha256:f.material.sha256,file_name:portals[i].state.attachment.name,file_bytes:portals[i].state.attachment.bytes,file_count:1,file_selected:true,parse_complete:true,attachment_associated:true,...(!single?{portal_saved:true}:{})};}));
   controls=await read();e.run('checkpoint',{...base,observed_at:now(),controls,...(!single?{portal_saved:true}:{}),phase:'complete',protected_fields:controls.filter(c=>c.key!=='cv'&&c.key!=='declaration').map(({key,value,read_state})=>({key,value,read_state})),groups:[{key:spec.group_key,fields}]});
  }
  if(portals[i].state.variant==='single_submit'){
   const q=e.run('apply_batch',{operation:'human_queue',batch_id:b.id,steps:[{application_id:s.app.id,kind:'declaration',field_key:'declaration',prompt:'Synthetic user handles declaration and OTP'}]});await page.locator('#declaration').check();await page.locator('#synthetic_otp').fill('000000');e.run('apply_batch',{operation:'human_done',batch_id:b.id,human_step_ids:[q.steps[0].id],completed:true,user_ref:'Synthetic human simulation'});e.run('apply_batch',{operation:'human_verify',batch_id:b.id,human_step_id:q.steps[0].id,observed_complete:true,verification_ref:'Synthetic browser declaration checked'});
  }
  const controls=await read();assert(e.run('review',{application_id:s.app.id,portal_url:portals[i].url,controls,...persistence}).ready);if(single)assert.equal(portals[i].state.saves,0);
  const request={operation:'clear_submit',batch_id:b.id,application_id:s.app.id,session_id:'synthetic-session'};let clear=call(e.store,'jobos1_apply_batch',request);
  if(i===0){assert.equal(clear.ok,false);assert.equal(portals[i].state.submits,0);approveBatch(e,b,[1,2,3]);clear=call(e.store,'jobos1_apply_batch',request);}
  assert(clear.ok,JSON.stringify(clear));await page.locator('#submit').click();await page.waitForFunction(()=>document.body.innerText.includes('合成结果：已提交'));assert.equal(portals[i].state.submits,1);assert.equal(portals[i].state.submitted_sha,s.material.asset.sha256);assert(!call(e.store,'jobos1_apply_batch',request).ok);
  e.run('outcome',{application_id:s.app.id,source:'official_portal',job_id:s.job.external_id,stage:'submitted',observed_at:now(),observation_ref:'Synthetic real-browser result'});assert.equal(e.store.get('application',s.app.id).actual_resume_sha256,portals[i].state.submitted_sha);
 }
 console.log(JSON.stringify({host,portals:portals.length,submits:portals.map(p=>p.state.submits),actual_resume_sha_verified:true,uploads:host==='claude'?'synthetic_user_simulation':'synthetic_host_upload',private_data_used:false}));
}finally{await browser.close();for(const p of portals)await p.close();e.store.close();rmSync(e.dir,{recursive:true,force:true});}
