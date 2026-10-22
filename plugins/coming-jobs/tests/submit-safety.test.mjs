import test from 'node:test';
import assert from 'node:assert/strict';
import {call} from '../src/service.mjs';
import {hook} from '../hooks/lifecycle.mjs';
import {batchFixture,startBatch,approveBatch,executePlan} from './batch-helpers.mjs';
const clear=(e,b,s)=>call(e.store,'jobos1_apply_batch',{operation:'clear_submit',batch_id:b.id,application_id:s.app.id,session_id:'synthetic-session'});
const cases={
 expired_grant:(e,b,s)=>{const grant=e.store.get('apply_grant',e.store.get('apply_batch',b.id).grant_id);e.store.put('apply_grant',grant.id,{...grant,expires_at:'2000-01-01T00:00:00Z'});},
 unexpected_required:(e,b,s)=>{const app=e.store.get('application',s.app.id);e.store.put('application',app.id,{...app,review:{...app.review,controls:[...app.review.controls,{key:'new-required',type:'free_text',required:true}]}});},
 unexpected_agreement:(e,b,s)=>{const app=e.store.get('application',s.app.id);e.store.put('application',app.id,{...app,review:{...app.review,controls:[...app.review.controls,{key:'new-agreement',type:'agreement',required:false,text_hash:'a'.repeat(64)}]}});},
 interrupted_execution:(e,b,s)=>{const batch=e.store.all('execution_batch')[0];e.store.put('execution_batch',batch.id,{...batch,state:'unknown'});},
 unsaved_portal:(e,b,s)=>{const app=e.store.get('application',s.app.id);e.store.put('application',app.id,{...app,review:{...app.review,portal_persistence:'not_verified',single_submit:false}});},
 exhausted_quota:(e,b,s)=>{const q=e.store.all('opportunity')[0];e.store.put('opportunity',q.id,{...q,exhausted:true});},
 off_mode:(e)=>e.store.put('settings','preferences',{batch_submit:'off'}),
 origin_change:(e,b,s)=>{const plan=e.store.get('plan',s.plan.id);e.store.put('plan',plan.id,{...plan,origin:'https://other.example.com'});},
 field_change:(e,b,s)=>{const plan=e.store.get('plan',s.plan.id),groups=structuredClone(plan.groups);groups[0].fields[0].value='Changed synthetic target';e.store.put('plan',plan.id,{...plan,groups});},
 scheduled_session:(e)=>hook({hook_event_name:'UserPromptSubmit',session_id:'synthetic-session',prompt:'Coming Jobs 每日运行'},e.dir)
};
for(const [name,mutate] of Object.entries(cases))test('submit safety: '+name,t=>{const e=batchFixture(t,1),b=startBatch(e),s=e.apps[0];approveBatch(e,b);assert(executePlan(e,s).ready);mutate(e,b,s);assert.equal(clear(e,b,s).ok,false);assert.equal(e.store.all('submit_attempt').length,0);assert.equal(e.store.get('application',s.app.id).stage,'preparing');});
test('required declaration needs actual user completion and independent verification',t=>{const e=batchFixture(t,1,{manual:true}),b=startBatch(e),s=e.apps[0];approveBatch(e,b);assert(executePlan(e,s).ready);assert.equal(clear(e,b,s).error.code,'declaration_pending');const q=e.run('apply_batch',{operation:'human_queue',batch_id:b.id,steps:[{application_id:s.app.id,field_key:'declaration',kind:'declaration',prompt:'Synthetic legal declaration, user only'}]});e.run('apply_batch',{operation:'human_done',batch_id:b.id,human_step_ids:[q.steps[0].id],completed:true,user_ref:'Synthetic manual check'});e.run('apply_batch',{operation:'human_verify',batch_id:b.id,human_step_id:q.steps[0].id,observed_complete:true,verification_ref:'Synthetic declaration readback'});assert(clear(e,b,s).ok);});
test('abort requires explicit fresh official draft evidence before another attempt',t=>{const e=batchFixture(t,1),b=startBatch(e),s=e.apps[0];approveBatch(e,b);executePlan(e,s);assert(clear(e,b,s).ok);const a={operation:'abort_submit',batch_id:b.id,application_id:s.app.id,session_id:'synthetic-session',portal_url:s.plan.origin,job_id:s.job.external_id,observed_at:new Date().toISOString(),observation_ref:'Synthetic draft view',draft_not_submitted:false};assert.equal(call(e.store,'jobos1_apply_batch',a).ok,false);assert.equal(e.store.get('application',s.app.id).stage,'unknown');e.run('apply_batch',{...a,draft_not_submitted:true});assert.equal(e.store.get('application',s.app.id).stage,'preparing');assert.equal(clear(e,b,s).error.code,'review_stale');});
