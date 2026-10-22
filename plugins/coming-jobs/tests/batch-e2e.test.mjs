import test from 'node:test';
import assert from 'node:assert/strict';
import {batchFixture,executePlan,approveBatch} from './batch-helpers.mjs';
import {call} from '../src/service.mjs';
import {now} from '../src/core.mjs';
for(const host of ['codex','claude'])test(`${host}: target list to outcomes stays within touchpoint budget and records actual SHA`,t=>{
 const old=process.env.JOBOS_HOST;process.env.JOBOS_HOST=host;t.after(()=>old===undefined?delete process.env.JOBOS_HOST:process.env.JOBOS_HOST=old);
 const e=batchFixture(t,4),targets=e.run('apply_batch',{operation:'targets',job_ids:e.apps.map(s=>s.job.id)});e.run('apply_batch',{operation:'targets',target_list_id:targets.id,numbers:[1,2,3,4],confirmed:true,user_ref:'Synthetic reusable target-list approval'});
 const b=e.run('apply_batch',{operation:'start',target_list_id:targets.id,session_id:'synthetic-session'}),touchpoints=new Set();
 const queue={operation:'human_queue',batch_id:b.id,steps:e.apps.flatMap(s=>[{application_id:s.app.id,kind:'login',prompt:'Synthetic login for '+s.job.company},...(host==='claude'?[{application_id:s.app.id,kind:'upload',prompt:'Synthetic drag approved PDF for '+s.job.company}]:[])])};
 const first=e.run('apply_batch',queue);if(first.should_ask)touchpoints.add(first.confirmation_key);assert.equal(e.run('apply_batch',queue).should_ask,false);
 e.run('apply_batch',{operation:'human_done',batch_id:b.id,human_step_ids:first.steps.map(h=>h.id),completed:true,user_ref:'Synthetic grouped user completion'});for(const h of first.steps)e.run('apply_batch',{operation:'human_verify',batch_id:b.id,human_step_id:h.id,observed_complete:true,verification_ref:'Synthetic readback'});
 const approved=approveBatch(e,b,[1,2,3]);touchpoints.add(approved.confirmation_key);assert(touchpoints.size<=2);
 for(const s of e.apps.slice(0,3))assert(executePlan(e,s).ready);
 const changed=e.apps[2];e.store.put('job',changed.job.id,{...e.store.get('job',changed.job.id),content_hash:'synthetic-new-jd'});
 for(const s of e.apps.slice(0,2)){const args={operation:'clear_submit',batch_id:b.id,application_id:s.app.id,session_id:'synthetic-session'},clear=call(e.store,'jobos1_apply_batch',args);assert(clear.ok,JSON.stringify(clear));assert(!call(e.store,'jobos1_apply_batch',args).ok);e.run('outcome',{application_id:s.app.id,source:'official_portal',job_id:s.job.external_id,observation_ref:'Synthetic unique result',stage:'submitted',observed_at:now()});assert.equal(e.store.get('application',s.app.id).actual_resume_sha256,s.material.asset.sha256);}
 for(const s of e.apps.slice(2))assert(!call(e.store,'jobos1_apply_batch',{operation:'clear_submit',batch_id:b.id,application_id:s.app.id,session_id:'synthetic-session'}).ok);
 const attempts=e.store.all('submit_attempt');assert.equal(attempts.length,2);for(const s of e.apps.slice(0,2))assert.equal(attempts.filter(a=>a.application_id===s.app.id).length,1);assert(attempts.every(a=>a.actual_resume_sha256));
 const status=e.run('apply_batch',{operation:'status',batch_id:b.id});assert(status.paused_items?.some(i=>i.application_id===changed.app.id));
 assert.equal(e.run('apply_batch',queue).should_ask,false);assert.equal(touchpoints.size,2);
});
