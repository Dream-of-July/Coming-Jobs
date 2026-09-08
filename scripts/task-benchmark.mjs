#!/usr/bin/env node
// Synthetic dispatcher measurements; no model API, private workspace or real applications.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../plugins/coming-jobs/src/store.mjs';
import { call } from '../plugins/coming-jobs/src/service.mjs';
const home = mkdtempSync(path.join(os.tmpdir(), 'coming-tasks-benchmark-'));
const store = new Store(home);
const run = (name,args) => { const r=call(store,'jobos1_'+name,args);if(!r.ok)throw Error(JSON.stringify(r.error));return r.data; };
try {
    const jobs=run('jobs',{operation:'ingest',coverage:'partial',jobs:Array.from({length:30},(_,i)=>({company:'Synthetic Benchmark',title:`Product role ${i}`,external_id:String(i),url:`https://jobs.example.com/benchmark/${i}`,jd:'Responsibilities: research user needs and create prototypes.\nRequirements: evidence of product research and design experience.',track:'campus',source:'official',mode:'demo',observed_at:new Date().toISOString()}))}).jobs;
    const tasks=Array.from({length:3},(_,i)=>({kind:'job_assessment',inputs:jobs.slice(i*10,i*10+10).map(j=>({kind:'job',id:j.id})),authorization_ref:'Synthetic benchmark only'}));
    function trial(parent,limit,cache=true) {
        const started=performance.now();
        if(!cache) for(const t of store.all('agent_task')) store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('agent_task',t.id);
        const plan=run('tasks',{operation:'plan',parent_run_id:parent,tasks});
        let claims=0,inputBytes=0,outputBytes=0,dispatches=0;
        while(true) {
            const batch=run('tasks',{operation:'claim',parent_run_id:parent,limit,host_capacity:limit,luna_available:true});claims++;
            if(!batch.tasks.length)break;
            for(const task of batch.tasks) {
                dispatches++;inputBytes+=Buffer.byteLength(JSON.stringify(task.packet));
                const results=task.packet.inputs.map(j=>({input_id:j.id,decision:'uncertain',reason:'Synthetic worker stub: evidence not supplied',evidence_refs:[j.id],assessment:{job_id:j.id,job_hash:j.content_hash,mappings:j.requirements.map(r=>({requirement_id:r.id,relation:'unknown',evidence_ids:[],reason:'Synthetic unknown'})),eligibility:'unknown',advantages:[],gaps:[],reason:'Synthetic'}}));
                outputBytes+=Buffer.byteLength(JSON.stringify(results));
                run('tasks',{operation:'complete',task_id:task.id,attempt_id:task.attempt_id,input_hash:task.input_hash,results});
                run('tasks',{operation:'review',task_id:task.id,checked_ids:task.input_ids,error_ids:[],review_ref:'Synthetic review; not a model quality evaluation'});
            }
        }
        return {inputs:jobs.length,dispatches,claim_roundtrips:claims,input_bytes:inputBytes,output_bytes:outputBytes,cache_hits:plan.tasks.filter(t=>t.cache_hit).length,dispatcher_ms:Math.round(performance.now()-started),model_tokens:null,model_elapsed_ms:null};
    }
    console.log(JSON.stringify({scope:'Same 30 synthetic JDs in three identical batches. Worker results are stubs; timings measure dispatcher overhead only. Bytes are not model tokens.',serial:trial('serial',1,false),cold_parallel:trial('cold',3,false),warm:trial('warm',3)},null,2));
} finally {store.close();rmSync(home,{recursive:true,force:true});}
