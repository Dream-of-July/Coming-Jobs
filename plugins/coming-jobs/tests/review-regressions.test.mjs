import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {batchFixture,startBatch,approveBatch,executePlan} from './batch-helpers.mjs';
import {environment,seedProfile,seedJob,reviewedFitFields} from './helpers.mjs';
import {call} from '../src/service.mjs';
import {now,hash} from '../src/core.mjs';
import {readAssessment} from '../src/jobs.mjs';
import {assessmentCurrent} from '../src/validity.mjs';
import {materialApproved,assertMaterialCurrent} from '../src/materials.mjs';
import {READBACK_SCRIPT} from '../src/hosts/claude-procedure.mjs';
import {claudeProcedure} from '../src/hosts/claude-procedure.mjs';
import {itinerary} from '../src/execution.mjs';

const clear=(e,b,s)=>call(e.store,'jobos1_apply_batch',{operation:'clear_submit',batch_id:b.id,application_id:s.app.id,session_id:'synthetic-session'});
const rawGroups=plan=>plan.groups.map(g=>({...g,fields:g.fields.map(({material,local_file,evidence_versions,value_kind,manual,...f})=>f)}));

test('a changed optional approved field blocks final submission',t=>{
 const e=batchFixture(t,1),s=e.apps[0],f=e.store.all('fact').find(f=>f.key==='project.anchor'),groups=rawGroups(s.plan);
 groups.push({key:'optional',label:'Optional intro',required:false,fields:[{key:'intro',label:'项目简介',type:'free_text',required:false,value:'Approved synthetic introduction',evidence_ids:[f.id]}]});
 s.plan=e.run('plan',{application_id:s.app.id,portal_url:s.plan.origin,page_fingerprint:'synthetic-v1',groups}).plan;
 const b=startBatch(e);approveBatch(e,b);executePlan(e,s);
 e.run('checkpoint',{application_id:s.app.id,plan_hash:s.plan.content_hash,session_id:'synthetic-session',portal_url:s.plan.origin,page_fingerprint:s.plan.page_fingerprint,observed_at:now(),portal_saved:true,groups:[{key:'optional',fields:[{key:'intro',value:'Changed actual synthetic introduction',read_state:'known'}]}]});
 assert.equal(e.run('review',{application_id:s.app.id,portal_url:s.plan.origin}).ready,false);
 assert.equal(clear(e,b,s).ok,false);
});

test('unapproved optional controls cannot silently enter the submitted payload',t=>{
 const e=batchFixture(t,1),s=e.apps[0],b=startBatch(e);approveBatch(e,b);executePlan(e,s);
 const controls=s.plan.groups.flatMap(g=>g.fields).map(f=>({key:f.key,type:f.type,required:f.required}));
 controls.push({key:'salary',type:'free_text',required:false});
 assert.equal(e.run('review',{application_id:s.app.id,portal_url:s.plan.origin,controls}).ready,false);
 assert.equal(clear(e,b,s).ok,false);
});

test('regenerating review cannot refresh fourteen-minute-old actual observations',t=>{
 const e=batchFixture(t,1),s=e.apps[0],b=startBatch(e);approveBatch(e,b);executePlan(e,s);
 for(const d of e.store.all('draft'))e.store.put('draft',d.id,{...d,observed_at:new Date(Date.now()-14*60000).toISOString()});
 e.run('review',{application_id:s.app.id,portal_url:s.plan.origin});
 assert.equal(clear(e,b,s).ok,false);
});

test('partial reapproval preserves unchanged items without extending their approval',t=>{
 const e=batchFixture(t,2),b=startBatch(e),first=approveBatch(e,b).grant;for(const s of e.apps)executePlan(e,s);
 const view=e.run('apply_batch',{operation:'sheet',batch_id:b.id,application_id:e.apps[0].app.id});
 e.run('apply_batch',{operation:'approve',batch_id:b.id,application_id:e.apps[0].app.id,sheet_code:view.code,sheet_issued_at:view.issued_at,session_id:'synthetic-session',reply:`批准 ${view.code} 全部`,confirmed:true,user_ref:'Synthetic partial refresh'});
 const retained=e.run('apply_batch',{operation:'status',batch_id:b.id}).grant.items.find(i=>i.application_id===e.apps[1].app.id);assert.equal(retained.authorization.expires_at,first.expires_at);assert.equal(retained.authorization.mode,first.mode);
 const result=clear(e,b,e.apps[1]);assert(result.ok,JSON.stringify(result));assert.equal(result.data.sheet_code,first.sheet_code);
 const attempt=e.store.get('submit_attempt',result.data.attempt_id);assert.equal(attempt.sheet_code,first.sheet_code);
});

test('identical selections in three paths still produce a low-difference warning',t=>{
 const e=batchFixture(t,2);for(const s of e.apps){const m=e.store.get('material',s.material.id);e.store.put('material',m.id,{...m,composition:{selection_paths:['a','b','c'],selection_claims:[{path:'a',digest:'same-a'},{path:'b',digest:'same-b'},{path:'c',digest:'same-c'}]}});}
 const b=startBatch(e),sheet=e.run('apply_batch',{operation:'sheet',batch_id:b.id});assert(sheet.items.every(i=>i.warnings.includes('selection_difference_below_3')));
});

test('a changed retained item pauses without blocking scoped approval of an unchanged item',t=>{
 const e=batchFixture(t,2),b=startBatch(e);approveBatch(e,b);for(const s of e.apps)executePlan(e,s);
 const changed=e.apps[1];e.store.put('job',changed.job.id,{...changed.job,content_hash:'synthetic-new-jd'});
 const view=e.run('apply_batch',{operation:'sheet',batch_id:b.id,application_id:e.apps[0].app.id});e.run('apply_batch',{operation:'approve',batch_id:b.id,application_id:e.apps[0].app.id,sheet_code:view.code,sheet_issued_at:view.issued_at,session_id:'synthetic-session',reply:`批准 ${view.code} 全部`,confirmed:true,user_ref:'Synthetic scoped approval'});
 assert(e.run('apply_batch',{operation:'status',batch_id:b.id}).paused_items.some(i=>i.application_id===changed.app.id));assert(clear(e,b,e.apps[0]).ok);assert.equal(clear(e,b,changed).ok,false);
});

test('template claims default to fixed paths including unknown identity shapes',t=>{
 const e=environment(t);seedProfile(e);seedJob(e);const f=e.store.all('fact').find(f=>f.key==='project.anchor');
 const data={headline:'Synthetic headline',unknown_identity:'Synthetic fixed identity',experiences:[{title:'UX intern',organization:'Example employer',period:'2025-2026',icon_src:'employer.png',description:'Synthetic description'}]},file=path.join(e.dir,'source.json'),script=path.join(e.dir,'render.mjs');
 writeFileSync(file,JSON.stringify(data));writeFileSync(script,'function html(d,locale){return d.headline;}\nconst files={};');
 const baseline=e.run('material',{operation:'template_baseline',file,render_script:script,text_paths:['headline'],confirmed:true,user_ref:'Synthetic baseline'});
 for(const field of ['title','organization','period','icon_src'])assert.equal(call(e.store,'jobos1_material',{operation:'claim_propose',claims:[{path:'experiences.0.'+field,text:'Changed synthetic identity',evidence_ids:[f.id]}]}).error?.code,'identity_locked',field);
 assert(!baseline.claims.some(c=>c.path==='unknown_identity'));
 assert.equal(call(e.store,'jobos1_material',{operation:'claim_propose',claims:[{path:'unknown_identity',text:'Changed synthetic',evidence_ids:[f.id]}]}).error?.code,'identity_locked');
 assert(e.run('material',{operation:'claim_propose',claims:[{path:'headline',text:'Revised synthetic headline',evidence_ids:[f.id]}]}).claims.length);
});

test('reused PDF approvals retain evidence through a second job approval',t=>{
 const e=batchFixture(t,2),s=e.apps[0],f=e.store.all('fact').find(f=>f.key==='project.anchor');
 const m=e.store.put('material',s.material.id,{...e.store.get('material',s.material.id),evidence:[{id:f.id,digest:hash(f.value)}]});
 const approve=m=>e.run('material',{operation:'approve',material_id:m.id,sha256:m.asset.sha256,visual_ok:true,content_ok:true,text_quality:'pass',confirmed:true,user_ref:'Synthetic PDF approval'});
 approve(m);const reused=e.run('material',{operation:'register',file:path.join(e.dir,'resume.pdf'),kind:'resume',job_id:e.apps[1].job.id,authorized:true,user_ref:'Synthetic reuse'});approve(reused);
 assert(e.store.get('material_approval',m.asset.sha256).evidence.some(e=>e.id===f.id));
 e.run('remember',{mode:'user_statement',confirmed:true,user_ref:'Synthetic corrected evidence',facts:[{key:f.key,value:'Corrected synthetic evidence'}]});
 assert.equal(materialApproved(e.store,reused),false);assert.throws(()=>assertMaterialCurrent(e.store,reused),e=>e.code==='material_evidence_changed');
});

test('comparison actions reproject current qualifications and retain sealed history',t=>{
 const e=environment(t);seedProfile(e);const j=seedJob(e),f=e.store.all('fact').find(f=>f.key==='project.anchor'),company=e.store.all('company')[0];
 e.run('profile',{operation:'fit_context',availability:{days_per_week:4},confirmed:true,user_ref:'Synthetic four days'});
 const run=e.run('comparison',{operation:'start',comparison_key:'review',company_ids:[company.id],mode:'demo'}).run;
 let task=e.run('comparison',{operation:'next',run_id:run.id}).tasks[0];
 if(task.kind==='collect'){const c=e.store.all('collection')[0],{id,revision,live_verified,listing_complete,details_complete,...collection}=c;const job={company:j.company,title:j.title,url:j.url,jd:j.jd,track:j.track,campaign:j.campaign,external_id:j.external_id,observed_at:j.observed_at,source:j.source,mode:j.mode};e.run('comparison',{operation:'ingest',run_id:run.id,task_id:task.id,jobs:[job],collection});e.run('comparison',{operation:'observe',run_id:run.id,task_id:task.id,state:'done'});task=e.run('comparison',{operation:'next',run_id:run.id}).tasks[0];}
 const job=e.store.get('job',j.id);e.run('comparison',{operation:'assess',run_id:run.id,task_id:task.id,assessments:[{job_id:job.id,job_hash:job.content_hash,mappings:job.requirements.map(r=>({requirement_id:r.id,relation:'direct',evidence_ids:[f.id],reason:'Synthetic'})),advantages:[],gaps:[],reason:'Synthetic',...reviewedFitFields(f.id),hard_gates:[{gate:'availability',source:'requirement',status:'meets',note:'Three days required',criterion:{kind:'days_per_week',min:3}}]}]});
 const before=e.run('comparison',{operation:'seal',run_id:run.id}).snapshot;
 e.run('profile',{operation:'fit_context',availability:{days_per_week:1},confirmed:true,user_ref:'Synthetic one day'});
 assert.equal(readAssessment(e.store,job).hard_gates[0].status,'fails');
 const result=e.run('comparison',{operation:'report',run_id:run.id});
 assert.equal(result.report.items[0].hard_gates[0].status,'fails');assert.notEqual(result.report.items[0].category,'recommendations');
 assert.equal(e.store.get('comparison_snapshot',before.id).items[0].hard_gates[0].status,'meets');
});

test('daily refreshes soft-stale evidence within budget without blocking selection',t=>{
 const e=batchFixture(t,1),s=e.apps[0];e.store.put('application',s.app.id,{...e.store.get('application',s.app.id),stage:'voided'});e.run('remember',{mode:'user_statement',confirmed:true,user_ref:'Synthetic extra evidence',facts:[{key:'project.additional',value:'Additional synthetic evidence'}]});
 e.run('daily',{operation:'configure',confirmed:true,user_ref:'Synthetic daily setup',settings:{target_companies:1,expansion_limit:0,assessment_limit:1}});const run=e.run('daily',{operation:'start',mode:'demo'}).run;
 const company=e.store.all('company')[0],scope=company.scopes[0];e.store.put('daily_source',hash([company.id,hash([scope.track,scope.campaign]),run.mode]),{company_id:company.id,scope,mode:run.mode,state:'verified',checked_date:run.date,checked_at:now(),complete:true});
 assert.equal(readAssessment(e.store,s.job).soft_stale,true);assert.equal(e.run('shortlist',{operation:'daily',mode:'demo',companies:[s.job.company]}).items.length,1);
 const result=e.run('daily',{operation:'next',run_id:run.id,limit:1});assert.equal(result.tasks[0]?.kind,'assess');assert.equal(e.store.get('daily_budget',run.budget_id).assessed,1);
 const a=e.store.get('assessment',s.job.id),task=result.tasks[0];e.run('daily',{operation:'assess',run_id:run.id,task_id:task.id,assessments:[{job_id:s.job.id,job_hash:s.job.content_hash,mappings:a.mappings,advantages:a.advantages,gaps:a.gaps,reason:'Synthetic refreshed',...reviewedFitFields(a.evidence_refs[0].evidence_id)}]});
 assert.equal(readAssessment(e.store,s.job).soft_stale,false);assert.equal(e.run('daily',{operation:'next',run_id:run.id,limit:1}).tasks.length,0);
});

test('legacy migration cannot bless an assessment after an unproven intent change',t=>{
 const e=batchFixture(t,1),s=e.apps[0],a=e.store.get('assessment',s.job.id);delete a.evidence_digest;delete a.intent_digest;delete a.matching_digest;e.store.put('assessment',a.id,a);
 e.run('remember',{mode:'user_statement',confirmed:true,user_ref:'Synthetic changed intent',facts:[{key:'intent.direction',value:'Different synthetic direction'}]});
 assert.equal(assessmentCurrent(e.store,e.store.get('assessment',a.id),s.job),false);const plan=e.run('workspace',{operation:'migration_plan'});assert.equal(plan.assessments.recoverable,0);
 e.run('workspace',{operation:'migrate',plan_code:plan.code,reply:`批准 ${plan.code}`,confirmed:true,user_ref:'Synthetic migration'});
 assert.equal(assessmentCurrent(e.store,e.store.get('assessment',a.id),s.job),false);
});

test('Claude readback never returns OTPs detected by id placeholder or autocomplete',()=>{
 const input=(attributes,value='000000')=>({id:attributes.id??'',type:'text',value,labels:[],tagName:'INPUT',required:true,getAttribute:key=>attributes[key]??null});
 const controls=[input({id:'otp'}),input({placeholder:'验证码'}),input({autocomplete:'one-time-code'}),input({name:'normal-unplanned'},'Unapproved synthetic value')];
 const result=vm.runInNewContext(READBACK_SCRIPT,{location:{origin:'https://example.com',pathname:'/login'},document:{querySelectorAll:()=>controls}});
 assert(result.controls.every(c=>c.value===undefined));
 const scoped=claudeProcedure({origin:'https://example.com',groups:[{fields:[{key:'normal-unplanned',label:'Synthetic normal',type:'free_text',value:'Unapproved synthetic value'},{key:'otp',label:'OTP',type:'free_text',value:'never'}]}]}).readback_script;
 const current=vm.runInNewContext(scoped,{location:{origin:'https://example.com',pathname:'/login'},document:{querySelectorAll:()=>controls}});
 assert.equal(current.controls[0].value,undefined);assert.equal(current.controls[3].value,'Unapproved synthetic value');
});

test('stale control inventory cannot become fresh by regenerating review',t=>{
 const e=batchFixture(t,1),s=e.apps[0],b=startBatch(e);approveBatch(e,b);executePlan(e,s);
 const app=e.store.get('application',s.app.id);e.store.put('application',app.id,{...app,portal_inventory_observed_at:new Date(Date.now()-14*60000).toISOString()});
 assert.equal(e.run('review',{application_id:app.id,portal_url:s.plan.origin}).ready,false);assert.equal(clear(e,b,s).ok,false);
});

test('one group retains the oldest actual observation across execution chunks',t=>{
 const e=batchFixture(t,1),s=e.apps[0],groups=rawGroups(s.plan),name=groups[0].fields[0];
 groups[0].fields=Array.from({length:9},(_,i)=>({...name,key:i?'name'+i:'name'}));s.plan=e.run('plan',{application_id:s.app.id,portal_url:s.plan.origin,page_fingerprint:'synthetic-v1',groups}).plan;
 const b=startBatch(e);approveBatch(e,b);const fields=s.plan.groups.flatMap(g=>g.fields),controls=fields.map(f=>({key:f.key,type:f.type,required:f.required}));
 const old=new Date(Date.now()-4*60000).toISOString();
 for(const spec of itinerary(s.plan)){
  const stamp=spec.kind==='ordinary'&&spec.field_keys.length===8?old:now(),base={application_id:s.app.id,plan_hash:s.plan.content_hash,session_id:'synthetic-session',portal_url:s.plan.origin,page_fingerprint:s.plan.page_fingerprint,observed_at:stamp,batch_number:spec.number,controls,portal_saved:true,protected_fields:fields.filter(f=>f.type!=='file_upload').map(f=>({key:f.key,value:'',read_state:'known'}))};
  e.run('checkpoint',{...base,phase:'prepare',groups:[{key:spec.group_key,fields:spec.field_keys.map(key=>({key,read_state:'known',...(key==='cv'?{file_count:0}:{value:''})}))}]});
  const observed=spec.field_keys.map(key=>key==='cv'?{key,read_state:'known',upload_complete:true,local_sha256:s.material.asset.sha256,file_name:s.material.asset.name,file_bytes:s.material.asset.bytes,file_count:1,file_selected:true,parse_complete:true,attachment_associated:true,portal_saved:true}:{key,value:'陈同学',read_state:'known'});
  e.run('checkpoint',{...base,phase:'complete',groups:[{key:spec.group_key,fields:observed}]});
 }
 assert.equal(e.store.all('draft').find(d=>d.group_key==='identity').observed_at,old);
});

test('true single-submit portals can verify upload without claiming a save',t=>{
 const e=batchFixture(t,1),s=e.apps[0],b=startBatch(e);approveBatch(e,b);
 const fields=s.plan.groups.flatMap(g=>g.fields),controls=fields.map(f=>({key:f.key,type:f.type,required:f.required})),protected_fields=[{key:'name',value:'',read_state:'known'}];
 // The public checkpoint sequence remains the same for both hosts.
 for(const spec of [{number:1,group_key:'resume',field_keys:['cv']},{number:2,group_key:'identity',field_keys:['name']}]){
  const base={application_id:s.app.id,plan_hash:s.plan.content_hash,session_id:'synthetic-session',portal_url:s.plan.origin,page_fingerprint:s.plan.page_fingerprint,observed_at:now(),batch_number:spec.number,controls,protected_fields,single_submit:true,persistence_ref:'Synthetic native page has one final submit and no draft-save action'};
  e.run('checkpoint',{...base,phase:'prepare',groups:[{key:spec.group_key,fields:spec.field_keys.map(key=>({key,read_state:'known',...(key==='cv'?{file_count:0}:{value:''})}))}]});
  const after=spec.field_keys.map(key=>key==='cv'?{key,read_state:'known',upload_complete:true,local_sha256:s.material.asset.sha256,file_name:s.material.asset.name,file_bytes:s.material.asset.bytes,file_count:1,file_selected:true,parse_complete:true,attachment_associated:true}:{key,value:'陈同学',read_state:'known'});
  const result=e.run('checkpoint',{...base,phase:'complete',groups:[{key:spec.group_key,fields:after}]});assert.equal(result.state,'complete');
 }
 assert.equal(e.run('review',{application_id:s.app.id,portal_url:s.plan.origin,controls,single_submit:true,persistence_ref:'Synthetic actual no-save page'}).ready,true);
 assert(clear(e,b,s).ok);assert(e.store.all('draft').every(d=>d.portal_saved!==true));
});
