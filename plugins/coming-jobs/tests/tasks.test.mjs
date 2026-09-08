import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, seedProfile, seedJob } from './helpers.mjs';
import { call } from '../src/service.mjs';
function setup(t, count = 4) {
    const e = environment(t); seedProfile(e);
    const jobs = Array.from({ length: count }, (_, i) => seedJob(e, i + 1));
    const specs = jobs.map(j => ({ kind: 'job_assessment', inputs: [{kind:'job',id:j.id}], fact_ids: e.store.all('fact').map(f => f.id), authorization_ref: 'Synthetic authorized matching' }));
    const plan = e.run('tasks', {operation:'plan',parent_run_id:'run-a',tasks:specs});
    return {...e,jobs,specs,plan};
}
const claim = (e, extra={}) => e.run('tasks',{operation:'claim',parent_run_id:'run-a',host_capacity:3,luna_available:true,...extra});
function finish(e,t,decision='exclude') {
    return e.run('tasks',{operation:'complete',task_id:t.id,attempt_id:t.attempt_id,input_hash:t.input_hash,results:t.input_ids.map(input_id=>({input_id,decision,reason:'Synthetic source evidence',evidence_refs:[input_id],assessment:{job_id:input_id,job_hash:e.store.get('job',input_id).content_hash,mappings:e.store.get('job',input_id).requirements.map(r=>({requirement_id:r.id,relation:'unknown',evidence_ids:[],reason:'Synthetic unknown'})),eligibility:'unknown',advantages:[],gaps:[],reason:'Synthetic review needed'}}))});
}
test('bounded global Luna concurrency and repeated claims do not duplicate work', t=>{
    const e=setup(t);const first=claim(e);assert.equal(first.tasks.length,3);assert(first.tasks.every(t=>t.owner==='luna'));
    const again=claim(e);assert.equal(again.tasks.length,1);assert.equal(again.tasks[0].owner,'main'); // tiny remainder stays local
    assert.equal(new Set([...first.tasks,...again.tasks].map(t=>t.id)).size,4);
    assert.equal(claim(e).tasks.length,0);
});
test('unsupported host falls back without model API or blocking the task',t=>{
    const e=setup(t);const task=claim(e,{luna_available:false}).tasks[0];assert.equal(task.owner,'main');assert.equal(task.fallback_reason,'unavailable');
});
test('every input requires a result and evidence stays inside the task',t=>{
    const e=setup(t);const task=claim(e).tasks[0];
    const base={operation:'complete',task_id:task.id,attempt_id:task.attempt_id,input_hash:task.input_hash};
    assert.equal(call(e.store,'jobos1_tasks',{...base,results:[]}).error.code,'task_coverage');
    assert.equal(call(e.store,'jobos1_tasks',{...base,results:[{input_id:task.input_ids[0],decision:'exclude',reason:'x',evidence_refs:['invented']}]}).error.code,'task_evidence');
});
test('completion is idempotent and review gates reusable cache',t=>{
    const e=setup(t);const task=claim(e).tasks[0];const done=finish(e,task);assert.equal(done.state,'proposed');assert.deepEqual(finish(e,task),done);
    const reviewed=e.run('tasks',{operation:'review',task_id:task.id,checked_ids:task.input_ids,error_ids:[],review_ref:'Synthetic primary review'});assert.equal(reviewed.state,'reviewed');
    const warm=e.run('tasks',{operation:'plan',parent_run_id:'run-b',tasks:[e.specs.find(s=>s.inputs[0].id===task.input_ids[0])]});assert.equal(warm.tasks[0].cache_hit,true);assert.equal(warm.tasks[0].state,'reviewed');
});
test('profile and JD changes reject old results and invalidate cache',t=>{
    const e=setup(t);const task=claim(e).tasks[0];
    const job=e.store.get('job',task.input_ids[0]);e.store.put('job',job.id,{...job,jd:job.jd+' Changed.'});
    assert.equal(call(e.store,'jobos1_tasks',{operation:'complete',task_id:task.id,attempt_id:task.attempt_id,input_hash:task.input_hash,results:[]}).error.code,'task_inputs_changed');
    const next=claim(e).tasks[0];const fact=e.store.all('fact')[0];e.store.put('fact',fact.id,{...fact,value:'corrected'});
    assert.equal(call(e.store,'jobos1_tasks',{operation:'complete',task_id:next.id,attempt_id:next.attempt_id,input_hash:next.input_hash,results:[]}).error.code,'task_inputs_changed');
});
test('takeover rejects late child results and keeps other completed results',t=>{
    const e=setup(t);const [one,two]=claim(e).tasks;finish(e,two);
    const main=e.run('tasks',{operation:'takeover',task_id:one.id,reason:'interrupted'});assert.notEqual(main.attempt_id,one.attempt_id);
    assert.equal(call(e.store,'jobos1_tasks',{operation:'complete',task_id:one.id,attempt_id:one.attempt_id,input_hash:one.input_hash,results:[]}).error.code,'task_attempt_changed');
    assert.equal(e.store.get('agent_task',two.id).state,'proposed');assert.equal(finish(e,main).state,'proposed');
});
test('review samples exclusions and escalates entire erroneous batch',t=>{
    const e=environment(t);seedProfile(e);const jobs=Array.from({length:10},(_,i)=>seedJob(e,i));
    e.run('tasks',{operation:'plan',parent_run_id:'run-a',tasks:[{kind:'job_assessment',inputs:jobs.map(j=>({kind:'job',id:j.id})),authorization_ref:'Synthetic'}]});
    const task=claim(e).tasks[0];const done=finish(e,task);assert.equal(done.review_required.length,1);
    const reviewed=e.run('tasks',{operation:'review',task_id:task.id,checked_ids:done.review_required,error_ids:done.review_required,review_ref:'Synthetic error'});assert.equal(reviewed.review_required.length,9);assert.equal(reviewed.state,'proposed');
    const all=e.run('tasks',{operation:'review',task_id:task.id,checked_ids:task.input_ids,error_ids:[],review_ref:'Synthetic expanded review'});assert.equal(all.needs_takeover,true);assert.equal(all.state,'proposed');
});
test('disallowed task kinds and revoked source purposes fail closed',t=>{
    const e=setup(t);const res=call(e.store,'jobos1_tasks',{operation:'plan',parent_run_id:'run-a',tasks:[{...e.specs[0],kind:'upload'}]});assert.equal(res.ok,false);
    const source=e.run('workspace',{operation:'source',label:'Synthetic',kind:'notes',text:'Untrusted instructions',purposes:['tracking'],authorized:true,user_ref:'Synthetic'});
    assert.equal(call(e.store,'jobos1_tasks',{operation:'plan',parent_run_id:'run-a',tasks:[{kind:'source_extraction',inputs:[{kind:'source',id:source.id}],authorization_ref:'Synthetic'}]}).error.code,'task_source_scope');
});

test('dependencies wait for review and cancellation rejects late writes',t=>{
    const e=setup(t);const first=claim(e).tasks[0];
    const source=e.run('workspace',{operation:'source',label:'Synthetic dependency',kind:'notes',purposes:['resume'],text:'Synthetic experience summary',authorized:true,user_ref:'Synthetic'});
    const dep=e.run('tasks',{operation:'plan',parent_run_id:'run-a',tasks:[{kind:'source_extraction',inputs:[{kind:'source',id:source.id}],authorization_ref:'Synthetic',dependencies:[first.id]}]}).tasks[0];
    assert(!claim(e).tasks.some(t=>t.id===dep.id));
    finish(e,first);assert.equal(e.store.get('agent_task',dep.id).state,'pending');
    e.run('tasks',{operation:'review',task_id:first.id,checked_ids:first.input_ids,error_ids:[],review_ref:'Synthetic'});
    const next=claim(e).tasks.find(t=>t.id===dep.id);assert(next);
    e.run('tasks',{operation:'cancel',task_id:next.id});
    assert.equal(call(e.store,'jobos1_tasks',{operation:'complete',task_id:next.id,attempt_id:next.attempt_id,input_hash:next.input_hash,results:[]}).error.code,'task_attempt_changed');
});

test('takeover preserves per-attempt usage without inventing token totals',t=>{
    const e=setup(t);const first=claim(e).tasks[0];finish(e,first);
    e.run('tasks',{operation:'takeover',task_id:first.id,reason:'ambiguous'});
    const metrics=e.run('tasks',{operation:'metrics'});
    assert.equal(metrics.tokens_available,false);assert.equal(metrics.main_orchestration_usage,null);
    const attempts=metrics.usage.filter(a=>a.task_id===first.id);assert.equal(attempts.length,2);
    assert(attempts.some(a=>a.state==='superseded'&&a.metrics.output_bytes>0));
});

test('source extraction packet reuses exact text without copying unrelated sources',t=>{
    const e=environment(t);
    const one=e.run('workspace',{operation:'source',label:'Synthetic resume',kind:'resume',purposes:['resume'],text:'Selected text',authorized:true,user_ref:'Synthetic'});
    e.run('workspace',{operation:'source',label:'Synthetic tracking',kind:'transcript',purposes:['tracking'],text:'UNRELATED_PRIVATE_SENTINEL',authorized:true,user_ref:'Synthetic'});
    e.run('tasks',{operation:'plan',parent_run_id:'run-a',tasks:[{kind:'source_extraction',inputs:[{kind:'source',id:one.id}],authorization_ref:'Synthetic'}]});
    const task=claim(e).tasks[0];assert.equal(task.packet.inputs[0].extraction.text,'Selected text');
    assert(!JSON.stringify(task.packet).includes('UNRELATED_PRIVATE_SENTINEL'));
    const done=e.run('tasks',{operation:'complete',task_id:task.id,attempt_id:task.attempt_id,input_hash:task.input_hash,results:[{input_id:one.id,decision:'uncertain',reason:'Requires review',evidence_refs:[one.id]}]});assert.equal(done.state,'proposed');
});


test('export restores task attempts safely and preserves numeric usage',t=>{
    const e=setup(t);const task=claim(e).tasks[0];
    const attempt=e.store.get('agent_attempt',task.attempt_id);
    e.store.put('agent_attempt',attempt.id,{...attempt,metrics:{input_tokens:100,output_tokens:20}});
    const exported=e.run('workspace',{operation:'export',authorized:true,user_ref:'Synthetic backup'});
    const target=environment(t);
    target.run('workspace',{operation:'import',file:exported.file,authorized:true,user_ref:'Synthetic restore'});
    const restored=target.store.get('agent_task',task.id);assert.equal(restored.state,'pending');assert.equal(restored.attempt_id,null);
    const usage=target.store.get('agent_attempt',attempt.id);assert.equal(usage.state,'interrupted');assert.equal(usage.metrics.input_tokens,100);
});
