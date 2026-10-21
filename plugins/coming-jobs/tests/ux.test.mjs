import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { environment, seedApplication, seedPlan, seedProfile, checkpointArgs, correctObservations, collectionFixture, seedCollection } from './helpers.mjs';
import { call } from '../src/service.mjs';
import { now, hash, Fault } from '../src/core.mjs';
import { facts } from '../src/profile.mjs';
import { authorizationState } from '../src/authorization.mjs';
import { fillGroup, browserCapabilities } from '../src/browser.mjs';
import { hook } from '../hooks/lifecycle.mjs';
const url = 'https://jobs.example.com/application';
function planArgs(s, plan) {
 return { application_id:s.app.id,portal_url:url,page_fingerprint:'new-observation',required_groups:plan.required_groups,
  groups:plan.groups.map(g=>({...g,fields:g.fields.map(f=>Object.fromEntries(Object.entries(f).filter(([k])=>!['material','local_file','evidence_versions'].includes(k))))})) };
}
function setup(t) { const e=environment(t), s=seedApplication(e), p=seedPlan(e,s); return {e,s,p}; }
test('locator/order changes reuse consent and preserve recoverable observations',t=>{
 const {e,s,p}=setup(t);e.run('checkpoint',checkpointArgs(s,p));
 const a=planArgs(s,p);a.groups.reverse();a.groups.find(g=>g.key==='identity').fields[0].locator={kind:'label',value:'当前姓名'};
 const result=e.run('plan',a);assert(result.authorization_status.content_authorized);
 assert(e.run('context',{scope:'application',application_id:s.app.id}).drafts.some(d=>d.observed.length));
 const original=e.store.get('application',s.app.id).authorization.user_ref;
 e.run('authorize',{application_id:s.app.id,plan_hash:result.plan.content_hash,portal_url:url,session_id:'session',reuse:true,confirmed:false,user_ref:'复用'});
 assert.equal(e.store.get('application',s.app.id).authorization.user_ref,original);
});
test('new target requires only changed field consent; independent authorized group remains writable',t=>{
 const {e,s,p}=setup(t);const name=e.store.all('fact').find(f=>f.key==='name');
 e.run('remember',{mode:'user_statement',confirmed:true,user_ref:'合成纠正',facts:[{key:'name',value:'新名字'}]});
 const a=planArgs(s,p);a.groups[0].fields[0].value='新名字';
 const r=e.run('plan',a);assert.deepEqual(r.authorization_status.missing_fields,['name']);
 assert.equal(call(e.store,'jobos1_authorize',{application_id:s.app.id,plan_hash:r.plan.content_hash,portal_url:url,session_id:'session',reuse:true,confirmed:false,user_ref:'复用'}).error.code,'approval_required');
 e.run('checkpoint',checkpointArgs(s,r.plan,[correctObservations(s)[1]]));
 assert.equal(call(e.store,'jobos1_checkpoint',checkpointArgs(s,r.plan,[correctObservations(s)[0]])).error.code,'approval_required');
});
test('expired execution lease renews from consent without asking the user again',t=>{
 const {e,s,p}=setup(t);let app=e.store.get('application',s.app.id);app.authorization.expires_at='2000-01-01T00:00:00Z';e.store.put('application',app.id,app);
 assert.equal(call(e.store,'jobos1_context',{scope:'application',application_id:app.id}).flow.next.action,'renew_lease');
 e.run('authorize',{application_id:app.id,plan_hash:p.content_hash,portal_url:url,session_id:'new-session',reuse:true,confirmed:false,user_ref:'现有授权'});
 assert(authorizationState(e.store.get('application',app.id),p).lease_active);
});
test('plan changes cannot release another active writer or expand the recipient',t=>{
 const {e,s,p}=setup(t);const a=planArgs(s,p);a.groups.reverse();const n=e.run('plan',a).plan;
 assert.equal(call(e.store,'jobos1_authorize',{application_id:s.app.id,plan_hash:n.content_hash,portal_url:url,session_id:'other',reuse:true,confirmed:false,user_ref:'复用'}).error.code,'writer_busy');
 const moved=e.run('plan',{...a,portal_url:'https://other.example.com/application'});
 assert.equal(moved.authorization_status.content_authorized,false);
});
test('fact correction invalidates old plan even when authorization has not expired',t=>{
 const {e,s,p}=setup(t);e.run('remember',{mode:'user_statement',confirmed:true,user_ref:'纠正',facts:[{key:'school',value:'新学校'}]});
 assert.equal(call(e.store,'jobos1_checkpoint',checkpointArgs(s,p)).error.code,'fact_changed');
});
test('same bytes formal rename preserves material review; different bytes do not',t=>{
 const {e,s}=setup(t);const named=path.join(e.dir,'正式简历.pdf');copyFileSync(s.file,named);
 const m=e.run('material',{operation:'register',material_id:s.material.id,file:named,kind:'resume',authorized:true,user_ref:'仅正式改名'});
 assert(m.approved);assert.equal(m.asset.sha256,s.material.asset.sha256);
 writeFileSync(named,Buffer.concat([readFileSync(named),Buffer.from('\n% changed generation') ]));
 const changed=e.run('material',{operation:'register',material_id:m.id,file:named,kind:'resume',authorized:true,user_ref:'内容变更'});assert(!changed.approved);
});
test('company-specific answer shadows global only in the same company',t=>{
 const e=environment(t);seedProfile(e);
 e.run('remember',{mode:'user_statement',confirmed:true,user_ref:'本公司下拉选项',facts:[{key:'school',value:'公司标准大学',scope:'company:甲公司',purposes:['form']}]});
 assert.equal(facts(e.store,'form','company:甲公司').filter(f=>f.key==='school').length,1);
 assert.equal(facts(e.store,'form','company:甲公司').find(f=>f.key==='school').value,'公司标准大学');
 assert.equal(facts(e.store,'form','company:乙公司').find(f=>f.key==='school').value,'合成大学');
});
test('unreadable fields require observation rather than asking or overwriting',t=>{
 const {e,s,p}=setup(t);e.run('checkpoint',checkpointArgs(s,p));
 const r=e.run('recover',{application_id:s.app.id,fields:[{key:'school',read_state:'unreadable'}]});
 assert.equal(r.operations.length,0);assert.equal(r.conflicts.length,0);assert(r.unread_fields.includes('school'));assert(r.unread_fields.includes('name'));
});
test('explicitly unsaved portal and pending exchange inventory cannot pass review',t=>{
 const {e,s,p}=setup(t);const a=planArgs(s,p);a.checklist=[{key:'exchange',label:'交换经历',required:true,state:'pending'}];
 const n=e.run('plan',a).plan;
 e.run('checkpoint',{...checkpointArgs(s,n),portal_saved:false});
 let r=e.run('review',{application_id:s.app.id,portal_url:url});assert(!r.ready);assert(r.blockers.some(b=>b.key==='exchange'));
 e.run('checkpoint',{...checkpointArgs(s,n),portal_saved:true});r=e.run('review',{application_id:s.app.id,portal_url:url});assert(!r.ready);assert.equal(r.portal_persistence,'saved_observed');
});
test('registered portfolio is required even if the portal marks it optional',t=>{
 const {e,s,p}=setup(t);e.run('material',{operation:'register',file:s.file,kind:'portfolio',authorized:true,user_ref:'有作品集'});
 e.run('checkpoint',checkpointArgs(s,p));const r=e.run('review',{application_id:s.app.id,portal_url:url});assert(!r.ready);assert(r.blockers.some(x=>x.key==='portfolio'));
});
test('legacy plan remains compatible but cannot claim complete inventory or portal persistence',t=>{
 const {e,s,p}=setup(t);e.run('checkpoint',checkpointArgs(s,p));const r=e.run('review',{application_id:s.app.id,portal_url:url});assert(r.ready);assert.equal(r.completeness,'legacy_inventory_unverified');assert.equal(r.portal_persistence,'not_verified');
});
function job(n) {return {company:'合成公司',title:n===2?'用户体验工程师':'产品经理',external_id:String(n),url:`https://jobs.example.com/roles/${n}`,jd:'职责：进行用户研究与交互原型设计，分析体验问题。\n要求：能够协作研究和验证解决方案。',track:'campus',mode:'demo',source:'official',observed_at:now()};}
function collection() {return collectionFixture({company:'合成公司',external_ids:['1','2']});}
test('complete listing with missing full JD remains incomplete and blocks shortlist selection',t=>{
 const e=environment(t);seedProfile(e);const r=e.run('jobs',{operation:'ingest',jobs:[job(1)],coverage:'partial',collection:collection()});
 assert.equal(r.collection.state,'incomplete');assert.deepEqual(r.collection.missing_external_ids,['2']);
 let b=e.run('shortlist',{operation:'daily',companies:['合成公司'],mode:'demo',search_complete:true,search_note:'两岗列表已读'});
 assert(b.discovery.collection_pending);assert.equal(call(e.store,'jobos1_shortlist',{operation:'choose',batch_id:b.id,numbers:[],confirmed:true,user_ref:'选择'}).error.code,'collection_incomplete');
 const complete=e.run('jobs',{operation:'ingest',jobs:[job(2)],coverage:'explicit_scope_complete',collection:collection()});assert(complete.collection.complete);
 b=e.run('shortlist',{operation:'daily',companies:['合成公司'],mode:'demo'});assert(!b.discovery.collection_pending);assert(b.discovery.review_pending);assert.equal(b.discovery.known_scope_count,2);
});
test('open cursor cannot be asserted complete and failed ingest is rolled back',t=>{
 const e=environment(t);const r=call(e.store,'jobos1_jobs',{operation:'ingest',jobs:[job(1)],coverage:'explicit_scope_complete',collection:{...collection(),has_more:true}});
 assert.equal(r.error.code,'collection_incomplete');assert.equal(e.store.all('job').length,0);
});
test('context revision suppresses identical payload and changes after new facts',t=>{
 const e=environment(t);seedProfile(e);const first=e.run('context',{}), next=e.run('context',{since:first.context_revision});assert(next.unchanged);assert(JSON.stringify(next).length<JSON.stringify(first).length/4);
 e.run('remember',{mode:'user_statement',confirmed:true,user_ref:'更正',facts:[{key:'name',value:'另一个合成名字'}]});assert(!e.run('context',{since:first.context_revision}).unchanged);
});
test('maintenance stays exempt after diagnostic business tool and English implementation reply',t=>{
 const e=environment(t);const base={session_id:'s',turn_id:'t'};
 hook({...base,hook_event_name:'UserPromptSubmit',prompt:'优化整个插件减少投递摩擦'},e.dir);
 hook({...base,hook_event_name:'PostToolUse',tool_name:'jobos1_context'},e.dir);
 hook({...base,hook_event_name:'UserPromptSubmit',prompt:'Implement the proposed plan.'},e.dir);
 assert.deepEqual(hook({...base,hook_event_name:'Stop'},e.dir),{});
});
test('same schedule preserves real host binding; failure is visible in generated progress',t=>{
 const e=environment(t);const a={operation:'configure',timezone:'Asia/Shanghai',times:['09:00'],include_email:true,include_sms:true,confirmed:true,user_ref:'每日九点'};
 e.run('followup',a);e.run('followup',{operation:'bind',host_success:true,provider:'host',provider_task_id:'synthetic-task',result_ref:'合成成功'});
 assert.equal(e.run('followup',a).state,'host_reported_active');
 let page=e.run('workspace',{operation:'dashboard'}).presentation;assert(readFileSync(page.file,'utf8').includes('已有调度绑定'));
 e.run('followup',{operation:'schedule_status',state:'failed',result_ref:'宿主报告失败'});page=e.run('workspace',{operation:'dashboard'}).presentation;assert(readFileSync(page.file,'utf8').includes('执行失败'));
});
test('progress generation and host opening are separately recorded and stale acknowledgments rejected',t=>{
 const e=environment(t);const p=e.run('workspace',{operation:'dashboard'}).presentation;
 assert.equal(e.store.get('settings','presentation').status,'generated');
 e.run('workspace',{operation:'presentation',status:'opened',view_hash:p.view_hash,result_ref:'合成宿主成功打开'});assert.equal(e.store.get('settings','presentation').status,'opened');
 assert.equal(call(e.store,'jobos1_workspace',{operation:'presentation',status:'opened',view_hash:hash('wrong'),result_ref:'过期'}).error.code,'presentation_changed');
});
function browserFixture() {
 const values={one:'',two:''}, writes=[];let preserved=0;
 const tab={url:async()=>url,markHandoff:async()=>{preserved++;}};
 const group={key:'group',fields:['one','two'].map(key=>({key,label:key,type:'free_text',value:key}))};
 const saves=[];
 const options={origin:new URL(url).origin,authorization:{origin:new URL(url).origin,expires_at:new Date(Date.now()+60000).toISOString()},saveBefore:async x=>saves.push({before:x}),saveAfter:async x=>saves.push(structuredClone(x)),readField:async f=>({key:f.key,value:values[f.key]}),writeField:async f=>{writes.push(f.key);values[f.key]=f.value;}};
 return {values,writes,tab,group,options,saves,preserved:()=>preserved};
}
test('partial failure preserves successful fields and unknown action without replay',async()=>{
 const f=browserFixture();f.options.writeField=async field=>{f.writes.push(field.key);f.values[field.key]=field.value;if(field.key==='two')throw new Fault('result_ambiguous','结果未知');};
 await assert.rejects(fillGroup(f.tab,f.group,f.options),{code:'result_ambiguous'});
 assert.deepEqual(f.writes,['one','two']);assert.equal(f.saves.at(-1).fields.find(x=>x.key==='one').value,'one');assert.equal(f.saves.at(-1).fields.find(x=>x.key==='two').read_state,'unreadable');assert.equal(f.preserved(),1);
 f.options.writeField=async field=>{f.writes.push(field.key);};await fillGroup(f.tab,f.group,f.options);assert.deepEqual(f.writes,['one','two']);
});
test('changed origin between fields prevents next write and preserves progress',async()=>{
 const f=browserFixture();f.options.writeField=async field=>{f.writes.push(field.key);f.values[field.key]=field.value;f.tab.url=async()=> 'https://different.example.com/';};
 await assert.rejects(fillGroup(f.tab,f.group,f.options),{code:'origin_changed'});assert.deepEqual(f.writes,['one']);assert.equal(f.preserved(),1);
});
test('unreadable AX value performs no writes and uses a recoverable error',async()=>{
 const f=browserFixture();f.options.readField=async x=>({key:x.key,read_state:'unreadable'});
 await assert.rejects(fillGroup(f.tab,f.group,f.options),{code:'field_unreadable'});assert.equal(f.writes.length,0);
});
test('portal save that clears a field cannot be announced complete',async()=>{
 const f=browserFixture();f.options.savePortal=async()=>{f.values.two='';};
 await assert.rejects(fillGroup(f.tab,f.group,f.options),{code:'portal_save_not_verified'});assert.equal(f.saves.at(-1).fields.find(x=>x.key==='two').value,'');
});
test('bounded readiness wait observes delayed values without repeating writes',async()=>{
 const f=browserFixture();f.options.writeField=async field=>{f.writes.push(field.key);};f.options.settle=async field=>{f.values[field.key]=field.value;};
 await fillGroup(f.tab,f.group,f.options);assert.deepEqual(f.writes,['one','two']);
});
test('user edits survive recovery and unsupported DOM is reported as a capability',async()=>{
 const f=browserFixture();f.values.one='用户新改';f.options.priorObservations=[{key:'one',value:''}];
 await assert.rejects(fillGroup(f.tab,f.group,f.options),{code:'user_edit_conflict'});assert.equal(f.writes.length,0);assert(!browserCapabilities(f.tab).dom);
});
test('failed upload card is never mistaken for completed upload',async()=>{
 const f=browserFixture();f.group.fields=[{key:'cv',type:'file_upload',label:'CV',local_file:'/tmp/正式.pdf',material:{sha256:'synthetic'}}];
 f.options.readUpload=async()=>({key:'cv',file_name:'正式.pdf',upload_complete:false});
 await assert.rejects(fillGroup(f.tab,f.group,f.options),{code:'upload_not_verified'});assert.equal(f.saves.at(-1).fields[0].upload_complete,false);
});

test('empty option identity and rejected empty filename remain recordable observations',t=>{
 const {e,s,p}=setup(t);const groups=correctObservations(s);groups[1].fields=[{key:'school',value:'请选择',selected:true,option_id:''}];groups[2].fields=[{key:'cv',file_name:'',file_count:0,upload_complete:false}];
 const r=e.run('checkpoint',checkpointArgs(s,p,groups));assert(r.groups.some(g=>!g.passed));
});
test('compact ingest retains stored full JD while avoiding duplicate output',t=>{
 const e=environment(t);const r=e.run('jobs',{operation:'ingest',jobs:[job(1)],coverage:'partial',compact:true});assert(!('jd' in r.jobs[0]));assert.equal(e.store.get('job',r.jobs[0].id).jd,job(1).jd);
});
test('private referral preference appears in resumable context',t=>{
 const e=environment(t);seedProfile(e);const prior=e.run('context',{scope:'profile'}).context_revision;
 e.run('profile',{operation:'preferences',preferences:{referral_source:'https://referrals.example.com/current'},confirmed:true,user_ref:'指定来源'});
 assert.notEqual(e.run('context',{scope:'profile'}).context_revision,prior);assert.equal(e.store.get('settings','preferences').referral_source,'https://referrals.example.com/current');
});
test('another campaign collection cannot block the explicitly selected cohort',t=>{
 const e=environment(t);seedProfile(e);
 e.run('jobs',{operation:'ingest',jobs:[{...job(1),campaign:'old'}],coverage:'partial',collection:{...collection(),campaign:'old'}});
 seedCollection(e,{company:'合成公司',campaign:'current',mode:'demo'});
 const b=e.run('shortlist',{operation:'daily',mode:'demo',companies:['合成公司'],campaign:'current',search_complete:true,search_note:'当前届别暂无岗位'});
 assert(!b.discovery.collection_pending);assert.equal(b.discovery.known_scope_count,0);assert.equal(b.discovery.collections.length,1);assert(b.discovery.collections[0].live_verified);
});
