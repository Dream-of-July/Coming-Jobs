import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {environment,seedProfile,seedJob,simplePDF,reviewedFitFields} from './helpers.mjs';
import {createApplication} from '../src/jobs.mjs';
import {itinerary} from '../src/execution.mjs';
import {now} from '../src/core.mjs';
export function batchFixture(t,count=3,options={}){
 const e=environment(t);seedProfile(e);const file=path.join(e.dir,'resume.pdf');writeFileSync(file,simplePDF());
 const first=e.run('material',{operation:'register',file,kind:'resume',authorized:true,user_ref:'Synthetic baseline onboarding'});e.run('material',{operation:'approve',material_id:first.id,sha256:first.asset.sha256,visual_ok:true,content_ok:true,text_quality:'pass',confirmed:true,user_ref:'Synthetic baseline onboarding approval'});
 const evidence=e.store.all('fact').find(f=>f.key==='project.anchor'),name=e.store.all('fact').find(f=>f.key==='name');
 const apps=[];
 for(let n=1;n<=count;n++){
 const job=seedJob(e,n);e.run('jobs',{operation:'assess',assessments:[{job_id:job.id,job_hash:job.content_hash,mappings:job.requirements.map(r=>({requirement_id:r.id,relation:'direct',evidence_ids:[evidence.id],reason:'Synthetic evidence'})),advantages:[],gaps:[],reason:'Synthetic eligible',...reviewedFitFields(evidence.id)}]});
 const app=createApplication(e.store,job.id,'Synthetic target selection'),m=e.run('material',{operation:'register',file,kind:'resume',job_id:job.id,authorized:true,user_ref:'Synthetic baseline reuse'});e.run('material',{operation:'bind',application_id:app.id,material_id:m.id});
 const plan=e.run('plan',{application_id:app.id,portal_url:'https://jobs.example.com/application',page_fingerprint:'synthetic-v1',groups:[{key:'identity',label:'Identity',required:true,fields:[{key:'name',label:'姓名',type:'free_text',required:true,value:'陈同学',source:{fact_id:name.id,transform:'identity'}},...(options.manual?[{key:'declaration',label:'Synthetic legal declaration',type:'sensitive_user_owned',required:true}]:[])]},{key:'resume',label:'Resume',required:true,fields:[{key:'cv',label:'Resume',type:'file_upload',required:true,value:m.id}]}]}).plan;
 apps.push({app,job,material:m,plan});
 }
 return {...e,apps};
}
export function startBatch(e,extra={}){return e.run('apply_batch',{operation:'start',application_ids:e.apps.map(s=>s.app.id),session_id:'synthetic-session',...extra});}
export function approveBatch(e,batch,numbers){const sheet=e.run('apply_batch',{operation:'sheet',batch_id:batch.id});return e.run('apply_batch',{operation:'approve',batch_id:batch.id,sheet_code:sheet.code,sheet_issued_at:sheet.issued_at,session_id:'synthetic-session',reply:`批准 ${sheet.code} ${numbers?numbers.join('、'):'全部'}`,...(numbers?{numbers}:{}),confirmed:true,user_ref:'Synthetic user reply'});}
export function executePlan(e,s){
 const plan=s.plan,fields=plan.groups.flatMap(g=>g.fields),controls=fields.map(f=>({key:f.key,type:f.type,required:f.required,label:f.label}));
 const protected_fields=fields.filter(f=>!f.manual&&f.type!=='file_upload').map(f=>({key:f.key,value:'',read_state:'known'}));
 for(const spec of itinerary(plan)){
 const targets=fields.filter(f=>spec.field_keys.includes(f.key));const before=targets.map(f=>({key:f.key,read_state:'known',...(f.type==='file_upload'?{file_count:0}:{value:''})}));
 const base={application_id:s.app.id,plan_hash:plan.content_hash,session_id:'synthetic-session',portal_url:plan.origin,page_fingerprint:plan.page_fingerprint,observed_at:now(),batch_number:spec.number,controls,protected_fields,portal_saved:true};
 e.run('checkpoint',{...base,phase:'prepare',groups:[{key:spec.group_key,fields:before}]});
 const after=targets.map(f=>f.type==='file_upload'?{key:f.key,read_state:'known',upload_complete:true,local_sha256:f.material.sha256,file_name:f.material.name,file_bytes:f.material.bytes,file_count:1,file_selected:true,parse_complete:true,attachment_associated:true,portal_saved:true}:{key:f.key,value:f.value,read_state:'known',...(f.type==='portal_select'?{selected:true}:{})});
 e.run('checkpoint',{...base,phase:'complete',groups:[{key:spec.group_key,fields:after}]});
 }
 return e.run('review',{application_id:s.app.id,portal_url:plan.origin,controls});
}
