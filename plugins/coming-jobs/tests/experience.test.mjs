import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, seedApplication, seedPlan, correctObservations } from './helpers.mjs';
import { call } from '../src/service.mjs';
import { hash, now } from '../src/core.mjs';
import { itinerary } from '../src/execution.mjs';
import { verifyField } from '../src/applications.mjs';
test('experience requires replay and fresh exact scope; mismatch invalidates', t => {
 const e=environment(t), scope={company:'Synthetic',origin:'https://jobs.example.com',stage:'education',structure:hash('page'),host_version:'synthetic-v1'};
 const lesson=e.run('experience',{operation:'register',scope,strategy:'school_exact_option'});
 assert.equal(lesson.state,'candidate');
 assert.equal(call(e.store,'jobos1_experience',{operation:'enable',observed_at:now(),experience_id:lesson.id,scope,unique_match:true,readback_match:true}).ok,false);
 e.run('experience',{operation:'validate',experience_id:lesson.id,replay_passed:true,protection_passed:true,replay_digest:hash('replay')});
 assert.equal(e.run('experience',{operation:'enable',observed_at:now(),experience_id:lesson.id,scope,unique_match:true,readback_match:true}).state,'usable');
 assert.equal(e.run('experience',{operation:'enable',observed_at:now(),experience_id:lesson.id,scope:{...scope,company:'Other'},unique_match:true,readback_match:true}).state,'invalidated');
});
test('baseline rejects absent awards and old unlinked material', t => {
 const e=environment(t),s=seedApplication(e);
 const args={operation:'baseline',material_id:s.material.id,sha256:s.material.asset.sha256,extracted_text:'SYNTHETIC TEST RESUME',extraction_ref:'synthetic PDF text extraction',items:[{key:'award',category:'award',text:'Missing award'}],confirmed:true,user_ref:'synthetic approval'};
 assert.equal(call(e.store,'jobos1_material',args).error.code,'resume_incomplete');
 e.run('material',{...args,items:[{key:'project',category:'project',text:'SYNTHETIC TEST RESUME'}]});
 const old={...s.material,id:'old',approved:true};e.store.put('material','old',old);
 e.store.put('application',s.app.id,{...e.store.get('application',s.app.id),resume_id:'old'});
 assert.throws(()=>seedPlan(e,s),/resume_baseline_required/);
});
test('batch write ahead prevents replay and preserves changed user values',t=>{
 const e=environment(t),s=seedApplication(e),p=seedPlan(e,s), batches=itinerary(p);
 assert.equal(batches[0].kind,'file_upload');
 const base={application_id:s.app.id,plan_hash:p.content_hash,session_id:'session',portal_url:p.origin,page_fingerprint:p.page_fingerprint,observed_at:now(),controls:[{key:'name',type:'free_text',required:true},{key:'school',type:'portal_select',required:true},{key:'cv',type:'file_upload',required:true}],protected_fields:[{key:'name',value:'',read_state:'known'},{key:'school',value:'',read_state:'known'}],batch_number:1};
 const before=[{key:'cv',read_state:'known',file_count:0}];
 e.run('checkpoint',{...base,phase:'prepare',groups:[{key:'resume',fields:before}]});
 assert.equal(call(e.store,'jobos1_checkpoint',{...base,phase:'prepare',groups:[{key:'resume',fields:before}]}).error.code,'recovery_required');
 const completed=correctObservations(s)[2].fields.map(o=>({...o,read_state:'known',file_selected:true,parse_complete:true,attachment_associated:true,portal_saved:true}));
 assert.equal(e.run('checkpoint',{...base,phase:'recover',groups:[{key:'resume',fields:completed}]}).state,'complete');
 const next={...base,batch_number:2};
 e.run('checkpoint',{...next,phase:'prepare',groups:[{key:'identity',fields:[{key:'name',value:'original',read_state:'known'}]}]});
 assert.equal(e.run('checkpoint',{...next,phase:'recover',groups:[{key:'identity',fields:[{key:'name',value:'user edit',read_state:'known'}]}]}).state,'conflict');
});
test('independent batches at most eight and upload association is mandatory',()=>{
 const batches=itinerary({groups:[{key:'g',fields:Array.from({length:19},(_,i)=>({key:String(i),type:'free_text'}))}]});
 assert.deepEqual(batches.map(b=>b.field_keys.length),[8,8,3]);
 const target={type:'file_upload',attachment_protocol:'complete',material:{sha256:'x',name:'photo.png',bytes:12}};
 const observation={upload_complete:true,local_sha256:'x',file_name:'photo.png',file_bytes:12,file_count:1,file_selected:true,parse_complete:true,portal_saved:true};
 assert.equal(verifyField(target,observation).ok,false);
 assert.equal(verifyField(target,{...observation,attachment_associated:true}).ok,true);
});

test('every declared education, work, award and link is required in the PDF text',t=>{
 const e=environment(t),s=seedApplication(e);
 const items=[['education','Education'],['work','Work experience'],['project','Project'],['achievement','Result'],['award','Award'],['portfolio','https://portfolio.example.com']].map(([category,text])=>({key:category,category,text}));
 for(const omitted of items){
  const r=call(e.store,'jobos1_material',{operation:'baseline',material_id:s.material.id,sha256:s.material.asset.sha256,extracted_text:items.filter(i=>i!==omitted).map(i=>i.text).join('\n'),extraction_ref:'synthetic extraction',items,confirmed:true,user_ref:'synthetic user'});
  assert.equal(r.error.code,'resume_incomplete',omitted.category);
 }
});
test('company exception remains scoped and requires evidence and explicit length',t=>{
 const e=environment(t),s=seedApplication(e), fact=e.store.all('fact').find(f=>f.key==='project.anchor');
 e.run('material',{operation:'baseline',material_id:s.material.id,sha256:s.material.asset.sha256,extracted_text:'SYNTHETIC TEST RESUME',extraction_ref:'synthetic extraction',items:[{key:'project',category:'project',text:'SYNTHETIC TEST RESUME'}],confirmed:true,user_ref:'synthetic'});
 const variation={operation:'variation',material_id:s.material.id,content_key:'project',company:s.app.company,text:'Synthetic',reason:'portal_length',max_length:3,evidence_ids:[fact.id],confirmed:true,user_ref:'synthetic user'};
 assert.equal(call(e.store,'jobos1_material',variation).error.code,'field_length_exceeded');
 const v=e.run('material',{...variation,max_length:20});
 assert.equal(v.company,s.app.company);assert.equal(v.original,'SYNTHETIC TEST RESUME');
 assert.equal(e.store.all('fact').find(f=>f.id===fact.id).value,fact.value);
});
test('batch requires parsing association and save independently before ordinary edits',t=>{
 const e=environment(t),s=seedApplication(e),p=seedPlan(e,s);
 const args={application_id:s.app.id,plan_hash:p.content_hash,session_id:'session',portal_url:p.origin,page_fingerprint:p.page_fingerprint,observed_at:now(),controls:[{key:'name',type:'free_text',required:true},{key:'school',type:'portal_select',required:true},{key:'cv',type:'file_upload',required:true}],protected_fields:[{key:'name',value:'',read_state:'known'},{key:'school',value:'',read_state:'known'}],batch_number:1};
 e.run('checkpoint',{...args,phase:'prepare',groups:[{key:'resume',fields:[{key:'cv',file_count:0,read_state:'known'}]}]});
 const result=e.run('checkpoint',{...args,phase:'complete',groups:[correctObservations(s)[2]]});
 assert.equal(result.state,'unknown');
 const r=call(e.store,'jobos1_checkpoint',{...args,batch_number:2,phase:'prepare',groups:[{key:'identity',fields:[{key:'name',value:'',read_state:'known'}]}]});
 assert.equal(r.error.code,'dependency_pending');
});
test('parse cannot overwrite existing portal edits without exact restoration scope',t=>{
 const e=environment(t),s=seedApplication(e),p=seedPlan(e,s);
 const r=call(e.store,'jobos1_checkpoint',{application_id:s.app.id,plan_hash:p.content_hash,session_id:'session',portal_url:p.origin,page_fingerprint:p.page_fingerprint,observed_at:now(),batch_number:1,phase:'prepare',controls:[{key:'name',type:'free_text',required:true},{key:'school',type:'portal_select',required:true},{key:'cv',type:'file_upload',required:true}],protected_fields:[{key:'name',value:'user corrected name',read_state:'known'},{key:'school',value:'',read_state:'known'}],groups:[{key:'resume',fields:[{key:'cv',file_count:0,read_state:'known'}]}]});
 assert.equal(r.error.code,'parse_restore_scope_required');assert.equal(e.store.all('execution_batch').length,0);
});

test('host batch protects a changed field and retains earlier successes',async()=>{
 const {executeOrdinaryBatch}=await import('../src/host-batch.mjs');
 const values={First:'',Second:'user change'};let writes=0;
 const tab={url:async()=> 'https://jobs.example.com/form',playwright:{evaluate:async(fn,label)=>({value:values[label],maxLength:30}),getByLabel:label=>({count:async()=>1,fill:async value=>{values[label]=value;writes++;}})}};
 const batch={id:'synthetic',state:'pending',scope:{origin:'https://jobs.example.com'},grant:{expires_at:new Date(Date.now()+60000).toISOString()},before:[{key:'a',value:''},{key:'b',value:''}],targets:[{key:'a',type:'free_text',value:'approved',locator:{kind:'label',value:'First'}},{key:'b',type:'free_text',value:'approved',locator:{kind:'label',value:'Second'}}]};
 const r=await executeOrdinaryBatch(tab,batch);
 assert.equal(r.state,'unknown');assert.equal(writes,1);assert.equal(values.Second,'user change');assert.equal(r.observations[0].value,'approved');
});
test('host batch rejects duplicate school labels, truncation and structural mismatch before write',async()=>{
 const {executeOrdinaryBatch}=await import('../src/host-batch.mjs');
 for(const scenario of ['duplicate','length','origin']){
  let writes=0;
  const tab={url:async()=>scenario==='origin'?'https://other.example.com':'https://jobs.example.com',playwright:{evaluate:async()=>({value:'',maxLength:2}),getByLabel:()=>({count:async()=>scenario==='duplicate'?2:1,fill:async()=>{writes++;}})}};
  const r=await executeOrdinaryBatch(tab,{id:'synthetic',state:'pending',scope:{origin:'https://jobs.example.com'},grant:{expires_at:new Date(Date.now()+60000).toISOString()},before:[{key:'s',value:''}],targets:[{key:'s',type:'free_text',value:'complete text',locator:{kind:'label',value:'School'}}]});
  assert.equal(r.state,'unknown');assert.equal(writes,0,scenario);
 }
});
test('date controls stay isolated and preserve dependency order',()=>{
 const b=itinerary({groups:[{key:'dates',fields:[{key:'start',type:'date_picker'},{key:'end',type:'date_picker'},{key:'summary',type:'free_text'}]}]});
 assert.deepEqual(b.map(x=>x.field_keys),[['start'],['end'],['summary']]);
 assert.deepEqual(b[1].depends_on,[1]);
});
test('photo checks actual type instead of trusting filename',async t=>{
 const {writeFileSync}=await import('node:fs');
 const e=environment(t),file=e.dir+'/photo.png';writeFileSync(file,'not an image');
 const r=call(e.store,'jobos1_material',{operation:'register',kind:'photo',file,authorized:true,user_ref:'synthetic file'});
 assert.equal(r.error.code,'invalid_photo');
 assert.equal(e.store.all('material').length,0);
});
