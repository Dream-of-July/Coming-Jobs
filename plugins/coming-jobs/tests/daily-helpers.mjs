import { seedProfile } from './helpers.mjs';
import { now } from '../src/core.mjs';
export function dailySetup(e, settings={}) {
 seedProfile(e);
 e.run('daily',{operation:'configure',confirmed:true,user_ref:'合成每日推荐授权',settings:{expansion_limit:0,...settings}});
}
export function addCompany(e,name='合成甲',count=2) {
 const scope={track:'campus',campaign:'2027',source_url:'https://jobs.example.com/'+encodeURIComponent(name)};
 const company=e.run('daily',{operation:'company',company:{name,scopes:[scope],introduction:{text:'合成测试公司，产品设计团队。',source_url:'https://example.com/about',observed_at:now()}}});
 const jobs=Array.from({length:count},(_,i)=>({company:name,title:'合成产品岗位'+i,url:scope.source_url+'/'+i,jd:'负责产品需求调研与用户体验设计，协作完成方案验证与产品迭代。需要明确表达需求并分析实际用户问题。',
  requirements:[{id:'r1',text:'完成产品调研',kind:'requirement'}],track:'campus',campaign:'2027',external_id:String(i),observed_at:now(),source:'official',mode:'live'}));
 return {company,scope,jobs};
}
export function collect(e,run,task,fixture,{complete=true,jobs=fixture.jobs}={}) {
 return e.run('daily',{operation:'ingest',run_id:run.id,task_id:task.id,jobs,collection:{company:fixture.company.name,...fixture.scope,observed_at:now(),total:fixture.jobs.length,
  external_ids:fixture.jobs.map(j=>j.external_id),pages_read:1,has_more:false,complete},cursor:'page:1'});
}
export function mapped(e,task) {
 const evidence=e.store.all('fact').find(f=>f.key==='intent.direction').id;
 return task.jobs.map(j=>({job_id:j.id,job_hash:j.content_hash,mappings:j.requirements.map(r=>({requirement_id:r.id,relation:'direct',evidence_ids:[evidence],reason:'合成证据对应职责'})),eligibility:'pass',advantages:['合成产品经验'],gaps:[],reason:'合成匹配说明'}));
}
export function drive(e, fixtures, {unchanged=false}={}) {
 const {run}=e.run('daily',{operation:'start'}); let fetched=0,assessed=0,modelBytes=0,metadata=0;
 for(let i=0;i<200;i++) {
  const {task}=e.run('daily',{operation:'next',run_id:run.id}); if(!task) break;
  const f=fixtures.find(f=>f.company.id===task.company_id);
  if(task.kind==='metadata') {metadata++;const same=unchanged && e.store.all('daily_source').some(s=>s.company_id===task.company_id && s.complete);e.run('daily',{operation:'observe',run_id:run.id,task_id:task.id,state:'done',changed:!same,...(f.jobs.find(j=>j.deadline)?{deadline:f.jobs.find(j=>j.deadline).deadline}:{}),fingerprint:'complete-fixture-v1',change_basis:same?'complete_jd_manifest':'unknown'});}
  if(task.kind==='collect') {collect(e,run,task,f);fetched+=f.jobs.length;e.run('daily',{operation:'observe',run_id:run.id,task_id:task.id,state:'done',fingerprint:'complete-fixture-v1'});}
  if(task.kind==='assess') {assessed+=task.jobs.length;modelBytes+=Buffer.byteLength(JSON.stringify(task.jobs));e.run('daily',{operation:'assess',run_id:run.id,task_id:task.id,assessments:mapped(e,task)});}
 }
 return {run,report:e.run('daily',{operation:'report',run_id:run.id}),fetched,assessed,modelBytes,metadata};
}
