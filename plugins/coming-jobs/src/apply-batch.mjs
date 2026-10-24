import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {currentHost} from './host.mjs';
import {authorize,assertPlanCurrent} from './applications.mjs';
import {approveMaterial,materialApproved,assertMaterialCurrent,materialReviewDigest} from './materials.mjs';
import {fieldDigest,authorizationState} from './authorization.mjs';
import {itinerary} from './execution.mjs';
import {assert,consent,hash,id,now} from './core.mjs';
import {createApplication,readAssessment,collectionStatus} from './jobs.mjs';
import {assessmentCurrent} from './validity.mjs';
import {isRecommendable} from './fit-assessment.mjs';
import {companyMatches,jobOpportunity,scopeKey} from './opportunities.mjs';
import {batchMode,applicationQueueStatus,applicationQueueOperation,applicationQueueGuidance} from './apply-queue.mjs';
export function targetStatus(store,list){
 const needs_decision=[],refresh=[];
 for(const item of list.items){
  const job=store.get('job',item.job_id,false),a=job&&readAssessment(store,job),q=job&&jobOpportunity(store,job);
  const reason=!job||job.content_hash!==item.job_hash?'jd_changed':q.state==='exhausted'||q.state==='closed'?'quota_unavailable':!assessmentCurrent(store,a,job)||!isRecommendable(a)?'qualification_changed':null;
  if(reason)needs_decision.push({number:item.number,job_id:item.job_id,reason});
  else if(q.state==='needs_verification')refresh.push({number:item.number,action:'refresh_official_rules'});
 }
 return {...list,needs_decision,agent_refresh:refresh};
}
function targets(store,a){
 assert(a.operation==='targets','invalid_operation','操作尚未支持。');
 let list=a.target_list_id?store.get('target_list',a.target_list_id):null;
 if(!list){assert(a.job_ids?.length,'targets_required','需要非空目标岗位。');assert(new Set(a.job_ids).size===a.job_ids.length,'duplicate_target','目标不能重复。');const items=a.job_ids.map((key,i)=>{const job=store.get('job',key),assessment=readAssessment(store,job);assert(assessmentCurrent(store,assessment,job)&&isRecommendable(assessment),'qualification_unverified','先核验目标岗位与资格。');return {number:i+1,job_id:job.id,job_hash:job.content_hash,gates_digest:hash(assessment.hard_gates),quota:jobOpportunity(store,job)};});list=store.put('target_list',id('targets'),{items,approved_numbers:[],created_at:now()});}
 if(a.confirmed){consent(a.confirmed,a.user_ref);assert(a.numbers?.length&&a.numbers.every(n=>list.items.some(i=>i.number===n)),'invalid_selection','选择目标清单中的编号。');const status=targetStatus(store,list);assert(!status.needs_decision.some(i=>a.numbers.includes(i.number)),'targets_changed','变化项需要在下一张审批单中决定。');list=store.put('target_list',list.id,{...list,approved_numbers:[...new Set(a.numbers)],approved_ref:a.user_ref});}
 return targetStatus(store,list);
}
const mode=batchMode;
const batchApps=(store,b)=>b.application_ids.map(k=>store.get('application',k));
const liveGrant=(store,b)=>b.grant_id?store.get('apply_grant',b.grant_id,false):null;
function assertApprovalCapacity(store,items,retained){
 const companies=store.all('company'),quotas=new Map();
 const quotaKey=job=>{const company=companies.find(record=>companyMatches(record,job.company));return company?hash([company.id,scopeKey(job),job.mode??'live']):null;};
 for(const item of items){
  const job=store.get('job',item.job_id),key=quotaKey(job);
  assert(key,'opportunity_unverified','先登记并核验当前公司的招聘范围和名额。');
  if(!quotas.has(key))quotas.set(key,{applications:new Set(),q:jobOpportunity(store,job)});
  quotas.get(key).applications.add(item.application_id);
 }
 // A scoped approval keeps other current approvals in the same allowance.
 // Unapproved drafts reserve preparation capacity but have not used a submission.
 for(const item of retained){
  if(store.get('application',item.application_id).stage!=='preparing')continue;
  const group=quotas.get(quotaKey(store.get('job',item.job_id)));
  group?.applications.add(item.application_id);
 }
 assert([...quotas.values()].every(({applications,q})=>q.state==='available'&&q.remaining!==null&&q.remaining>=applications.size),
  'opportunity_unverified','先刷新官方规则与名额，并核对本范围仍有效的已批准项目。');
}
function itemFingerprint(item,{legacyMaterials=false}={}){
 const material=value=>{if(!legacyMaterials||!value)return value;const {review_digest,...prior}=value;return prior;};
 return hash({application_id:item.application_id,job_id:item.job_id,job_hash:item.job_hash,job_url:item.job_url,origin:item.origin,plan_hash:item.plan_hash,
  fields:legacyMaterials?item.fields.map(field=>({...field,material:material(field.material)})):item.fields,
  agreements:item.agreements,manual:item.manual,parsed:item.parsed,resume:material(item.resume),gates_digest:item.gates_digest,rules:item.rules});
}
function matchesApprovedItem(current,approved){
 if(current.fingerprint===approved.fingerprint)return true;
 const materials=[approved.resume,...approved.fields.map(field=>field.material)].filter(Boolean);
 if(materials.some(material=>Object.hasOwn(material,'review_digest')))return false;
 // Legacy grants lack a historical mapping digest. Compare their original
 // scope without inventing one; new approvals bind the full material state.
 return itemFingerprint(current,{legacyMaterials:true})===approved.fingerprint;
}
function currentItem(store,b,app,number){
 const job=store.get('job',app.job_id),plan=app.plan_id?store.get('plan',app.plan_id):null,m=app.resume_id?store.get('material',app.resume_id):null;
 if(m?.asset){store.assetPath(m.asset);assertMaterialCurrent(store,m);}
 if(plan)assertPlanCurrent(store,app,plan,{allowUnapprovedRendered:true});
 const assessment=readAssessment(store,job),quota=jobOpportunity(store,job),blockers=[];
 if(!plan)blockers.push('plan_required');if(!m?.asset||!materialApproved(store,m)&&!m.render_receipt?.passed)blockers.push('resume_review_required');
 if(job.content_hash!==app.job_snapshot.content_hash)blockers.push('jd_changed');
 if(!assessmentCurrent(store,assessment,job)||!isRecommendable(assessment))blockers.push('qualification_changed');
 if(['exhausted','closed'].includes(quota.state))blockers.push('quota_unavailable');
 const fields=plan?.groups.flatMap(g=>g.fields.map(f=>({key:f.key,label:f.label,kind:f.manual?'manual':f.type==='file_upload'?'attachment':f.value_kind??'composed',value:f.manual?null:f.value,digest:fieldDigest(f),required:f.required,type:f.type,material:f.material?{sha256:f.material.sha256,bytes:f.material.bytes,name:f.material.name,review_digest:materialReviewDigest(store,store.get('material',f.material.id))}:null})))??[];
 const agreements=plan?.groups.flatMap(g=>g.fields.filter(f=>f.type==='agreement').map(f=>({key:f.key,title:f.agreement_title,text_hash:f.text_hash,excerpt:f.excerpt})))??[];
 const manual=plan?.groups.flatMap(g=>g.fields.filter(f=>f.manual).map(f=>({key:f.key,label:f.label,required:f.required})))??[];
 const item={number,application_id:app.id,company:app.company,title:app.title,job_id:job.id,job_hash:job.content_hash,job_url:job.url,origin:plan?.origin??null,plan_hash:plan?.content_hash??null,
   fields,agreements,manual,parsed:(app.parse_changes??[]).filter(c=>c.kind==='portal_parsed'),resume:m?.asset?{sha256:m.asset.sha256,name:m.asset.name,bytes:m.asset.bytes,review_digest:materialReviewDigest(store,m),height_pt:m.render_receipt?.height_pt??null,screenshot:m.render_receipt?.screenshot??null,headline:m.composition?.headline??m.content?.headline??'',summary:m.composition?.summary??'',selection_paths:m.composition?.selection_paths??[]}:null,
   selection_claims:m?.composition?.selection_claims??[],gates_digest:hash(assessment?.hard_gates??[]),rules:{limit:quota.remaining===null?null:quota.remaining+quota.used,can_change:quota.can_change??null,order:quota.volunteer_order??null,deadline:quota.deadline??null,source:quota.rule_source_ref??null},
   blockers,warnings:[...(m?.composition?.warnings??[]),...(quota.state==='needs_verification'?['agent_refresh_rules']:[])]};
 // Availability timestamps, review time and writer leases are refreshed by the agent.
 item.fingerprint=itemFingerprint(item);
 return item;
}
function sheet(store,b,issued=now(),applicationId=null){
 const issuedMs=Date.parse(issued);assert(Number.isFinite(issuedMs)&&issuedMs<=Date.now()+5000,'invalid_sheet_time','审批单时间无效。');
 if(applicationId)assert(b.application_ids.includes(applicationId),'batch_scope','申请不属于批次。');
 const items=batchApps(store,b).filter(a=>a.stage==='preparing'&&(!applicationId||a.id===applicationId)).map(app=>{
  const number=b.application_ids.indexOf(app.id)+1;
  try{return currentItem(store,b,app,number);}catch(error){
   // A broken material or stale record on one job must not hide other jobs.
   const diagnostic_code=/^[a-z][a-z0-9_]{0,79}$/i.test(error.code??'')?error.code.toLowerCase():'item_unavailable';
   return {number,application_id:app.id,company:app.company,title:app.title,job_id:app.job_id,fields:[],agreements:[],manual:[],parsed:[],resume:null,selection_claims:[],
    blockers:['item_unavailable'],warnings:[],diagnostic_code,fingerprint:hash([app.id,app.plan_id,app.resume_id,diagnostic_code])};
  }
 });
 const selections=item=>new Map(item.selection_claims.length?item.selection_claims.map(c=>[c.path,c.digest]):(item.resume?.selection_paths??[]).map(p=>[p,p]));
 for(const item of items){const a=selections(item);if(items.some(other=>{if(other===item)return false;const b=selections(other);return [...new Set([...a.keys(),...b.keys()])].filter(p=>a.get(p)!==b.get(p)).length<3;}))item.warnings.push('selection_difference_below_3');}
 const content_hash=hash(items.map(i=>[i.application_id,i.fingerprint]));
 const code='S-'+hash([b.id,b.sheet_nonce,issued,content_hash]).slice(0,6).toUpperCase();
 return {batch_id:b.id,code,issued_at:issued,expires_at:new Date(issuedMs+2*3600000).toISOString(),items,content_hash,
  needs_decision:items.filter(i=>i.blockers.length).map(i=>({number:i.number,blockers:i.blockers})),mode:mode(store),reply:`批准 ${code} 全部`,
  disclosure:'批准仅覆盖列明的所选申请、字段值、文件哈希、接收方与协议；仅已审批的语义内容变化时暂停该项。密码、验证码、扫码和声明由本人处理；图形/滑块验证只交接该动作。'};
}
function foreground(store,a){
 let hookState=null;try{hookState=JSON.parse(readFileSync(path.join(store.home,'hooks',hash(String(a.session_id)).slice(0,32)+'.json'),'utf8'));}catch{}
 assert(!a.background&&a.caller!=='scheduled'&&!hookState?.scheduled&&!['background','scheduled'].includes(process.env.JOBOS_INVOCATION),'foreground_required','后台或定时调用不能放行最终提交。');
}
function selectedNumbers(a,view){
 assert(a.reply.includes(view.code),'batch_code_required','用户回复必须包含当前审批单批次码。');
 const match=a.reply.trim().match(new RegExp('^(?:批准|同意|approve)\\s*'+view.code+'\\s+(.+?)[。.!！]?$', 'i'));
 assert(match,'batch_reply_required','需要用户明确回复“批准 批次码 全部”或列明编号。');
 const rest=match[1].replace(/[第项号]/g,'').trim(),all=/^(全部|all)$/i.test(rest);
 const numbers=all?view.items.map(i=>i.number):rest.split(/[、,，\s]+/).filter(Boolean).map(Number);
 assert(numbers.length&&new Set(numbers).size===numbers.length&&numbers.every(n=>Number.isInteger(n)&&view.items.some(i=>i.number===n)),'invalid_selection','批准回复中的编号不属于当前审批单。');
 if(a.numbers)assert(hash([...a.numbers].sort())===hash([...numbers].sort()),'selection_reply_mismatch','工具选择必须与用户逐字回复一致。');
 return numbers;
}
function humanStatus(store,b){const steps=store.all('human_step').filter(h=>h.batch_id===b.id&&['open','done'].includes(h.state));return {steps,prompt_id:hash(steps.map(h=>[h.id,h.kind])),prompt:steps.length?'请集中处理以下人工检查点：\n'+steps.map((h,i)=>`${i+1}. ${h.prompt}`).join('\n'):null};}
export function applyBatch(store,a){
 if(a.operation==='targets')return targets(store,a);
 if(a.operation==='start'){
  let ids=a.application_ids;
  if(a.target_list_id){const list=store.get('target_list',a.target_list_id),status=targetStatus(store,list),numbers=a.numbers??list.approved_numbers;assert(numbers.length&&numbers.every(n=>list.approved_numbers.includes(n)),'target_approval_required','仅开始已批准目标。');assert(!status.needs_decision.some(x=>numbers.includes(x.number)),'targets_changed','变化项先进入审批单决定栏。');ids=numbers.map(n=>{const item=list.items.find(i=>i.number===n);return createApplication(store,item.job_id,list.approved_ref,item.job_hash).id;});}
  assert(ids?.length&&ids.length<=10&&new Set(ids).size===ids.length,'batch_scope','每批 1–10 个不同申请。');
  const apps=ids.map(k=>store.get('application',k));assert(apps.every(app=>app.stage==='preparing'),'application_locked','只对准备中的申请开批。');
  assert(!store.all('apply_batch').some(b=>b.state==='active'&&b.application_ids.some(k=>ids.includes(k))),'batch_busy','申请已属于活跃批次，请恢复原批次。');
  const b=store.put('apply_batch',id('apply'),{state:'active',application_ids:ids,session_id:a.session_id,host:currentHost().id,target_list_id:a.target_list_id??null,created_at:now(),sheet_nonce:id('sheet'),grant_id:null});
  for(const app of apps)store.put('application',app.id,{...app,apply_batch_id:b.id});store.put('settings','active_apply_batch',{batch_id:b.id});
  const uploads=[],upload_failures=[];
  if(currentHost().id==='claude')for(const [i,app] of apps.entries()){
   try{
    const m=app.resume_id?store.get('material',app.resume_id):null;if(!m?.asset)continue;
    const bytes=readFileSync(store.assetPath(m.asset));
    const dir=path.join(store.home,'uploads',b.id,String(i+1).padStart(2,'0')+'-'+app.company.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_'));
    mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,m.asset.name);writeFileSync(file,bytes,{mode:0o600});
    uploads.push({application_id:app.id,company:app.company,file,sha256:m.asset.sha256});
   }catch(error){
    const code=['asset_missing','asset_changed','not_found'].includes(error.code)?error.code:'upload_preparation_failed';
    upload_failures.push({application_id:app.id,company:app.company,code,action:'repair_material'});
   }
  }
  return {...b,queue:applicationQueueStatus(store,b),uploads,upload_failures,portal_checks:apps.map(app=>{const origin=new URL(app.job_snapshot.url).origin,session=store.get('portal_session',hash([currentHost().id,origin]),false);return {origin,state:session&&Date.now()-Date.parse(session.last_success_at)<30*60000?'readback_session':'inspect_login',login_method:session?.login_method??null};})};
 }
 const b=store.get('apply_batch',a.batch_id);
 if(a.operation==='sheet')return sheet(store,b,now(),a.application_id);
 if(a.operation==='status')return {...b,queue:applicationQueueStatus(store,b),grant:liveGrant(store,b),human:humanStatus(store,b),applications:batchApps(store,b).map(app=>({id:app.id,stage:app.stage}))};
 if(['next','defer','retry','resume'].includes(a.operation))return applicationQueueOperation(store,b,a);
 assert(b.state==='active','batch_inactive','批次已结束或撤销。');
 if(a.operation==='approve'){
  foreground(store,a);consent(a.confirmed,a.user_ref);noSecretsReply(a.reply);
  assert(a.session_id===b.session_id&&b.host===currentHost().id,'batch_session_mismatch','必须在发起批次的宿主会话批准。');
  const view=sheet(store,b,a.sheet_issued_at,a.application_id);assert(Date.parse(view.expires_at)>Date.now(),'sheet_expired','审批单超过两小时，重新生成当前摘要。');assert(a.sheet_code===view.code,'sheet_changed','审批单内容已变化，只对变化范围重新审批。');
  const numbers=selectedNumbers(a,view),items=view.items.filter(i=>numbers.includes(i.number));assert(items.every(i=>!i.blockers.length),'sheet_blocked','批准项目仍有阻塞，先修复或排除。');
  const deadline=Math.min(Date.now()+12*3600000,...items.flatMap(i=>[store.get('job',i.job_id).deadline,i.rules.deadline]).filter(Boolean).map(Date.parse));assert(deadline>Date.now(),'campaign_closed','批次已超过截止时间。');
  const old=liveGrant(store,b),approved_at=now(),expires_at=new Date(deadline).toISOString();
  // A scoped sheet replaces only its own scope. Retained items keep the original
  // code, mode and expiry; a partial refresh cannot silently extend authority.
  const retained=[],newPauses=[];
  if(a.application_id&&old?.state==='active'&&old.session_id===a.session_id&&old.host===currentHost().id)for(const item of old.items){
   if(item.application_id===a.application_id)continue;const app=store.get('application',item.application_id),authority=item.authorization??old;
   if(!['preparing','unknown'].includes(app.stage))continue;
   const expiry=Math.min(Date.parse(old.expires_at),Date.parse(authority.expires_at));let reason=app.stage==='unknown'||expiry>Date.now()?null:'grant_expired';
   if(!reason&&app.stage==='preparing')try{const current=currentItem(store,b,app,item.number);if(!matchesApprovedItem(current,item)||current.blockers.length)reason='approved_item_changed';}catch(error){reason=error.code??'item_unverified';}
   if(reason)newPauses.push({application_id:app.id,reason,paused_at:now()});
   else retained.push({...item,authorization:{sheet_code:authority.sheet_code,mode:authority.mode,approved_at:authority.approved_at,expires_at:new Date(expiry).toISOString()}});
  }
  assertApprovalCapacity(store,items,retained);
  if(old?.state==='active')store.put('apply_grant',old.id,{...old,state:'superseded'});
  const approvedItems=items.map(i=>({...i,authorization:{sheet_code:view.code,mode:mode(store),approved_at,expires_at}}));
  const allItems=[...retained,...approvedItems].sort((a,b)=>a.number-b.number);
  const grant=store.put('apply_grant',id('grant'),{batch_id:b.id,session_id:a.session_id,host:currentHost().id,state:'active',items:allItems,sheet_code:view.code,mode:mode(store),approved_ref:a.user_ref,approved_reply:a.reply,approved_at,expires_at:new Date(Math.max(...allItems.map(i=>Date.parse(i.authorization.expires_at)))).toISOString()});
  store.put('approval_sheet',hash([b.id,view.code]),{...view,state:'approved',selected_numbers:numbers,user_ref:a.user_ref});
  for(const item of items){const app=store.get('application',item.application_id),m=store.get('material',app.resume_id);approveMaterial(store,m,a.user_ref);for(const field of store.get('plan',app.plan_id).groups.flatMap(g=>g.fields).filter(f=>f.material)){const attachment=store.get('material',field.material.id);assert(attachment.asset.sha256===field.material.sha256,'material_changed','附件已经变化。');approveMaterial(store,attachment,a.user_ref);}authorize(store,{application_id:app.id,plan_hash:app.plan_id,portal_url:item.origin,session_id:a.session_id,confirmed:true,user_ref:a.user_ref});}
  const paused_items=[...new Map([...(b.paused_items??[]),...newPauses].filter(p=>!items.some(i=>i.application_id===p.application_id)).map(p=>[p.application_id,p])).values()];
  store.put('apply_batch',b.id,{...b,grant_id:grant.id,paused_items});return {grant,approved_numbers:numbers,confirmation_key:'approval:'+grant.id};
 }
 if(a.operation==='human_queue'){
  let added=0;const steps=a.steps.map(step=>{if(step.application_id)assert(b.application_ids.includes(step.application_id),'human_scope','人工步骤不属于批次。');assert(!step.origin||/^https:\/\//.test(step.origin),'invalid_origin','人工步骤只保存门户来源。');noSecretsReply(step.prompt);const key=hash([b.id,step.application_id??null,step.kind,step.field_key??null,step.origin??null]),old=store.get('human_step',key,false);if(old)return old;added++;return store.put('human_step',key,{...step,batch_id:b.id,state:'open',presented_at:now()});});const status=humanStatus(store,b);return {...status,steps,should_ask:added>0,confirmation_key:'human:'+status.prompt_id};
 }
 if(a.operation==='human_done'){
  consent(a.completed,a.user_ref);return {steps:a.human_step_ids.map(k=>{const h=store.get('human_step',k);assert(h.batch_id===b.id&&h.state==='open','human_scope','人工步骤已完成或不属于批次。');return store.put('human_step',k,{...h,state:'done',completed_ref:a.user_ref,completed_at:now()});})};
 }
 if(a.operation==='human_verify'){
  const h=store.get('human_step',a.human_step_id);assert(h.batch_id===b.id&&h.state==='done'&&a.observed_complete,'human_readback_required','先由用户完成，再独立回读核验。');noSecretsReply(a.verification_ref);return store.put('human_step',h.id,{...h,state:'verified',verification_ref:a.verification_ref,verified_at:now()});
 }
 if(a.operation==='revoke'||a.operation==='void'){
  consent(a.confirmed,a.user_ref);const grant=liveGrant(store,b);if(grant){const removed=a.application_id?[a.application_id]:b.application_ids;store.put('apply_grant',grant.id,a.operation==='void'&&a.application_id?{...grant,items:grant.items.filter(i=>!removed.includes(i.application_id))}:{...grant,state:'revoked',revoked_at:now()});}
  const ids=a.application_id?[a.application_id]:b.application_ids;assert(ids.every(k=>b.application_ids.includes(k)),'batch_scope','申请不属于批次。');
  for(const key of ids){const app=store.get('application',key);assert(app.stage==='preparing'||a.operation==='revoke','application_locked','结果不明或已提交的申请不能作废。');store.put('application',key,{...app,...(a.operation==='void'?{stage:'voided',voided_at:now()}:{}),authorization:null,review:null});}
  for(const h of store.all('human_step').filter(h=>h.batch_id===b.id&&(!h.application_id||ids.includes(h.application_id))))store.put('human_step',h.id,{...h,state:'closed'});
  const allVoided=batchApps(store,b).every(app=>app.stage==='voided');store.put('apply_batch',b.id,{...b,...(a.operation==='revoke'||allVoided?{state:a.operation==='revoke'?'revoked':'voided'}:{})});
  if(allVoided||a.operation==='revoke'){store.put('settings','active_apply_batch',{batch_id:null});store.put('settings','active',{application_id:null});store.put('settings','focus',{kind:'tracking'});}return {state:a.operation==='void'?'voided':'revoked',application_ids:ids};
 }
 const app=store.get('application',a.application_id);assert(b.application_ids.includes(app.id),'batch_scope','申请不属于批次。');
 if(a.operation==='clear_submit'){
  foreground(store,a);const grant=liveGrant(store,b);assert(mode(store)==='on'&&grant?.mode==='on','submit_disabled','本批次仅预填或恢复人工提交。');
  assert(grant?.state==='active'&&Date.parse(grant.expires_at)>Date.now(),'grant_expired','批次授权已过期或撤销。');assert(grant.session_id===a.session_id&&grant.host===currentHost().id,'batch_session_mismatch','授权不能跨宿主会话使用。');
  assert(app.stage==='preparing','submit_once','该申请已提交或结果不明，不重复点击。');const approved=grant.items.find(i=>i.application_id===app.id);assert(approved,'item_not_approved','该项目没有列入本次批准。');
  const authority=approved.authorization??grant;assert(authority.mode==='on','submit_disabled','此项目仅获准预填，不能由批次提交。');assert(Date.parse(authority.expires_at)>Date.now(),'grant_expired','此项目的原始批准已过期，局部审批不能延长其他项目授权。');
  assert(!(b.paused_items??[]).some(p=>p.application_id===app.id),'item_paused','变化项已暂停，需要更新计划并重新逐批审批。');
  const current=currentItem(store,b,app,approved.number);assert(matchesApprovedItem(current,approved)&&!current.blockers.length,'approved_item_changed','该项 JD、资料、来源、协议、简历或资格已变化，暂停此项。');
  const plan=store.get('plan',app.plan_id),m=store.get('material',app.resume_id);assertPlanCurrent(store,app,plan);assert(materialApproved(store,m)&&m.asset.sha256===approved.resume.sha256,'material_changed','简历哈希与批准内容不一致。');
  assert(plan.groups.flatMap(g=>g.fields).filter(f=>f.material).every(f=>{const live=store.get('material',f.material.id);return materialApproved(store,live)&&live.asset.sha256===f.material.sha256;}),'material_changed','附件哈希已变化或未批准。');
  assert(authorizationState(app,plan).content_authorized&&app.authorization.session_id===a.session_id&&authorizationState(app,plan).lease_active,'approval_required','预填内容或写入租约不匹配。');
  const recent=time=>!!time&&Date.now()-Date.parse(time)>=-5000&&Date.now()-Date.parse(time)<5*60000;
  assert(app.review?.ready&&recent(app.review.reviewed_at)&&recent(app.review.oldest_observed_at)&&recent(app.review.inventory_observed_at),'review_stale','提交前需要五分钟内的实际字段、附件和控件回读；重新生成审核不能刷新旧观察。');assert(app.review.control_inventory_verified,'inventory_required','需要当前页面完整控件清单。');
  const inventory=app.review.controls,fields=plan.groups.flatMap(g=>g.fields);assert(!inventory.some(c=>c.required&&!fields.some(f=>f.key===c.key)),'unplanned_required_control','出现计划外必填控件。');
  assert(fields.filter(f=>f.type==='agreement').every(f=>inventory.some(c=>c.key===f.key&&c.type==='agreement'&&typeof c.text==='string'&&hash(c.text)===f.text_hash&&c.text_hash===f.text_hash))&&!inventory.some(c=>c.type==='agreement'&&!fields.some(f=>f.key===c.key&&f.text_hash===c.text_hash)),'agreement_changed','当前协议文本与批准范围不一致。');
  const steps=store.all('human_step').filter(h=>h.batch_id===b.id&&(!h.application_id||h.application_id===app.id));assert(!steps.some(h=>['open','done'].includes(h.state)),'human_pending','此项目仍有未核验人工步骤。');assert(fields.filter(f=>f.manual&&f.required).every(f=>steps.some(h=>h.kind==='declaration'&&h.field_key===f.key&&h.state==='verified')),'declaration_pending','声明和承诺书必须由本人处理并回读核验。');
  const batches=store.all('execution_batch').filter(x=>x.application_id===app.id&&x.plan_id===plan.id);assert(itinerary(plan).every(spec=>batches.some(x=>x.number===spec.number&&x.state==='complete')),'execution_pending','执行步骤尚未全部完成。');
  assert(!fields.some(f=>f.type==='file_upload')||app.parse_compared_at,'parse_readback_required','附件解析后尚未回读。');assert(app.review.portal_persistence==='saved_observed'||app.review.single_submit&&app.review.persistence_ref,'portal_not_saved','缺少门户保存或单次提交证据。');
  const quota=jobOpportunity(store,store.get('job',app.job_id));assert(quota.state==='available'&&quota.remaining>0,'opportunity_unverified','名额未核验、已耗尽或规则过期；先刷新。');
  const collection=store.all('collection').find(c=>c.company===app.company&&c.track===app.job_snapshot.track&&c.campaign===app.job_snapshot.campaign&&c.mode===app.mode);assert(collection&&collectionStatus(store,collection).complete&&collectionStatus(store,collection).live_verified,'live_list_stale','先刷新当前官方完整列表，内容未变化不重问。');
  const attempt=store.put('submit_attempt',id('submit'),{application_id:app.id,batch_id:b.id,grant_id:grant.id,sheet_code:authority.sheet_code,session_id:a.session_id,state:'pending',started_at:now(),actual_resume_sha256:m.asset.sha256,resume:{...m},plan_hash:plan.content_hash,origin:plan.origin,review_snapshot:app.review.snapshot,reviewed_at:app.review.reviewed_at});
  store.put('application',app.id,{...app,stage:'unknown',submit_attempt_id:attempt.id});return {attempt_id:attempt.id,company:app.company,sheet_code:authority.sheet_code,action:'click_once_then_read_result',action_summary:`${app.company} ${authority.sheet_code} 提交已批准申请`,resume_sha256:m.asset.sha256};
 }
 assert(a.operation==='abort_submit','invalid_operation','不支持的批次操作。');const attempt=app.submit_attempt_id?store.get('submit_attempt',app.submit_attempt_id):null;
 assert(app.stage==='unknown'&&attempt&&attempt.session_id===a.session_id,'submit_once','仅撤回当前会话的未定提交尝试。');assert(a.draft_not_submitted&&a.observation_ref&&a.job_id===app.job_snapshot.external_id&&new URL(a.portal_url).origin===attempt.origin&&Math.abs(Date.now()-Date.parse(a.observed_at))<300000,'draft_evidence_required','仅官方页面明确显示该岗位仍是未提交草稿时可撤回。');
 store.put('submit_attempt',attempt.id,{...attempt,state:'aborted',abort_ref:a.observation_ref,aborted_at:now()});return store.put('application',app.id,{...app,stage:'preparing',review:null,submit_attempt_id:null});
}
function noSecretsReply(value){assert(typeof value==='string'&&!/(?:验证码|password|口令)\s*[:：=]\s*\S+|https?:\/\/\S*[?&](?:token|code|auth)=/i.test(value),'secret_not_supported','批次记录不能包含登录秘密或专属链接。');}
export function batchGuidance(store,background=false){
 if(background)return null;const active=store.get('settings','active_apply_batch',false),b=active?.batch_id?store.get('apply_batch',active.batch_id,false):null;if(!b||b.state!=='active')return null;
 return applicationQueueGuidance(store,b,humanStatus(store,b));
}
/** Called after a failed mutation has rolled back; only an already approved item may pause. */
export function persistSubmitPause(store,a,error){
 if(!['approved_item_changed','material_changed','material_evidence_changed','fact_changed','agreement_changed'].includes(error.code))return false;
 const b=store.get('apply_batch',a.batch_id,false),grant=b&&liveGrant(store,b);if(!b||b.state!=='active'||grant?.state!=='active'||grant.session_id!==a.session_id||grant.host!==currentHost().id||!grant.items.some(i=>i.application_id===a.application_id))return false;
 store.transaction(()=>store.put('apply_batch',b.id,{...b,paused_items:[...(b.paused_items??[]).filter(p=>p.application_id!==a.application_id),{application_id:a.application_id,reason:error.code,paused_at:now()}]}));return true;
}
