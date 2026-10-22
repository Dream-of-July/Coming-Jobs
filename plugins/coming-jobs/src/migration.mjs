import {assert,consent,hash,id,now} from './core.mjs';
import {factRole,facts} from './profile.mjs';
import {assessmentCurrent,assessmentStamp,evidenceIds} from './validity.mjs';
import {normalizeFitAssessment} from './fit-assessment.mjs';
import {candidateFitContext,saveFitProfile} from './fit-profile.mjs';
const clean=r=>{if(!r)return null;const {revision,...value}=r;return value;};
function legacyRecoverable(store,a,job){
 if(a.evidence_digest)return assessmentCurrent(store,a,job);
 if(a.job_hash!==job?.content_hash||!Number.isFinite(Date.parse(a.evaluated_at)))return false;
 const available=new Map(facts(store,'matching').map(f=>[f.id,f]));
 return evidenceIds(a).length>0&&evidenceIds(a).every(k=>{const f=available.get(k),updated=store.db.prepare('SELECT updated_at FROM records WHERE kind=? AND id=?').get('fact',k)?.updated_at;return f&&updated&&Date.parse(updated)<=Date.parse(a.evaluated_at);});
}
export function migrationPlan(store){
 const apps=store.all('application'),fs=store.all('fact'),assessments=store.all('assessment');
 const activeIds=new Set(store.all('apply_batch').filter(b=>b.state==='active').flatMap(b=>b.application_ids??[]));
 const void_candidates=apps.filter(a=>a.stage==='preparing'&&!activeIds.has(a.id)&&!(a.authorization&&Date.parse(a.authorization.expires_at)>Date.now())&&Date.parse(a.created_at)<Date.now()-7*86400000).map(a=>({id:a.id,company:a.company,title:a.title,created_at:a.created_at,reason:'stale_preparing_no_active_writer'}));
 const bookkeeping=fs.filter(f=>factRole(f)==='bookkeeping'&&f.purposes.includes('matching')).map(f=>({id:f.id,key:f.key,remove_purpose:'matching'}));
 const login_decisions=fs.filter(f=>factRole(f)==='bookkeeping'&&/login|final_submit|verification/i.test(f.key)&&!( /^workflow\.login\.(email|sms)_read$/.test(f.key)&&typeof f.value==='boolean'&&f.evidence_level==='self_statement')).map(f=>({id:f.id,key:f.key,choices:['keep','revoke','update'],reason:'legacy_authentication_policy_requires_user_choice'}));
 const current=[],recoverable=[],reassess=[];
 for(const a of assessments){const job=store.get('job',a.job_id??a.id,false);if(job&&assessmentCurrent(store,a,job))current.push(a.id);else if(job&&legacyRecoverable(store,a,job))recoverable.push(a.id);else reassess.push(a.id);}
 const questions=new Map();for(const a of assessments)for(const gate of a.hard_gates??[])if(gate.status==='unknown'&&gate.criterion){const kind=gate.criterion.kind,ids=questions.get(kind)??new Set();ids.add(a.job_id??a.id);questions.set(kind,ids);}
 const fit_questions=[...questions].slice(0,5).map(([kind,ids])=>({kind,affected_jobs:ids.size}));
 const code='M-'+hash([store.workspace,apps.map(a=>[a.id,a.revision]),fs.map(f=>[f.id,f.revision]),assessments.map(a=>[a.id,a.revision]),void_candidates.map(a=>a.id)]).slice(0,6).toUpperCase();
 return {code,read_only:true,void_candidates,bookkeeping,login_decisions,assessments:{current:current.length,recoverable:recoverable.length,reassess:reassess.length,recoverable_ids:recoverable},fit_questions,
  summary:{void_candidates:void_candidates.length,bookkeeping:bookkeeping.length,login_decisions:login_decisions.length,current:current.length,recoverable:recoverable.length,reassess:reassess.length,fit_questions:fit_questions.length},
  next:`审阅清单后回复“批准 ${code}”；有登录策略冲突时逐项选择。真实工作区本次仅生成此清单，不执行迁移。`};
}
export function migrationAction(store,a,backup){
 if(a.operation==='migration_plan')return migrationPlan(store);
 consent(a.confirmed,a.user_ref);
 if(a.operation==='migration_revert'){
  const m=store.get('migration',a.migration_id);assert(m.state==='applied','migration_state','迁移已撤回。');
  assert(m.after.every(x=>hash(clean(store.get(x.kind,x.id,false)))===x.digest),'migration_conflict','迁移后记录有新修改，禁止覆盖；先单独处理冲突。');
  return store.transaction(()=>{for(const x of m.before){if(x.value===null)store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(x.kind,x.id);else store.put(x.kind,x.id,x.value);}return store.put('migration',m.id,{...m,state:'reverted',reverted_at:now(),revert_ref:a.user_ref});});
 }
 assert(a.operation==='migrate','invalid_operation','不支持的迁移操作。');const plan=migrationPlan(store);assert(a.plan_code===plan.code,'migration_plan_changed','迁移清单已变化，重新审阅当前清单。');assert(a.reply?.trim()===`批准 ${plan.code}`,'migration_code_required','迁移批准回复需要当前清单码。');
 const decisions=a.login_decisions??[];assert(plan.login_decisions.every(f=>decisions.some(d=>d.fact_id===f.id)),'migration_decision_required','先逐项选择旧登录规则保留、撤销或更新。');
 assert(decisions.every(d=>plan.login_decisions.some(f=>f.id===d.fact_id)),'migration_decision_scope','决策必须属于本次清单。');
 const saved=backup();
 return store.transaction(()=>{
  assert(migrationPlan(store).code===plan.code,'migration_plan_changed','备份期间资料发生变化，请重新审阅。');
  const before=[];const save=(kind,key,value)=>{if(!before.some(x=>x.kind===kind&&x.id===key))before.push({kind,id:key,value:clean(store.get(kind,key))});return store.put(kind,key,value);};
  for(const item of plan.void_candidates){const app=store.get('application',item.id);save('application',item.id,{...app,stage:'voided',voided_at:now(),authorization:null,review:null});}
  for(const item of plan.bookkeeping){const f=store.get('fact',item.id);save('fact',item.id,{...f,purposes:[...new Set([...f.purposes.filter(p=>p!=='matching'),'tracking'])]});}
  for(const d of decisions){const f=store.get('fact',d.fact_id);if(d.decision==='revoke')save('fact',f.id,{...f,state:'revoked'});if(d.decision==='update'){assert(typeof d.value==='boolean','migration_value','旧登录规则更新只接受明确布尔值。');save('fact',f.id,{...f,value:d.value,evidence_level:'self_statement',source_ref:a.user_ref,purposes:['tracking']});}}
  for(const assessment of store.all('assessment')){
   const job=store.get('job',assessment.job_id??assessment.id,false);if(!job)continue;
   if(assessmentCurrent(store,assessment,job)||plan.assessments.recoverable_ids.includes(assessment.id))save('assessment',assessment.id,{...normalizeFitAssessment({...assessment,tier:assessment.requested_tier??assessment.tier},job,candidateFitContext(store)),...assessmentStamp(store,assessment)});
  }
  // Save answer-related records before using the standard projector, so revert covers them too.
  if(a.fit_answers){for(const kind of ['fact','assessment','fit_question'])for(const r of store.all(kind))if(!before.some(x=>x.kind===kind&&x.id===r.id))before.push({kind,id:r.id,value:clean(r)});saveFitProfile(store,{...a.fit_answers,confirmed:true,user_ref:a.user_ref});for(const kind of ['fact','assessment','fit_question'])for(const r of store.all(kind))if(!before.some(x=>x.kind===kind&&x.id===r.id))before.push({kind,id:r.id,value:null});}
  const active=store.get('settings','active',false);if(active&&plan.void_candidates.some(x=>x.id===active.application_id))save('settings','active',{application_id:null});
  const after=before.map(x=>({kind:x.kind,id:x.id,digest:hash(clean(store.get(x.kind,x.id)))}));
  return store.put('migration',id('migration'),{state:'applied',plan_code:plan.code,before,after,backup:saved,applied_at:now(),user_ref:a.user_ref});
 });
}
