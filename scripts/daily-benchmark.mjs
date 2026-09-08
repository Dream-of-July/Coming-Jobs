/** Synthetic host replay. Input bytes, fetch counts and duration are measured, not billed tokens. */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { environment } from '../plugins/coming-jobs/tests/helpers.mjs';
import { dailySetup, addCompany, drive } from '../plugins/coming-jobs/tests/daily-helpers.mjs';
const e=environment(), originalNow=Date.now;
let simulatedNow=Date.now();
Date.now=()=>simulatedNow;
// localDate and now() also use the constructor, so advance source checked dates for warm replay.
try {
 dailySetup(e);
 const fixtures=Array.from({length:20},(_,i)=>addCompany(e,'合成公司'+String(i).padStart(2,'0'),10));
 const begin=performance.now(),cold=drive(e,fixtures);const coldMs=performance.now()-begin;
 // Re-run a distinct date using Date subclass; nothing outside this synthetic workspace is read.
 const NativeDate=Date, nextDay=new NativeDate(simulatedNow+86400000);
 globalThis.Date=class extends NativeDate { constructor(...a){super(...(a.length?a:[nextDay.valueOf()]));} static now(){return nextDay.valueOf();} };
 const warmBegin=performance.now(),warm=drive(e,fixtures,{unchanged:true});const warmMs=performance.now()-warmBegin;
 globalThis.Date=NativeDate;
 const allBytes=fixtures.reduce((n,f)=>n+Buffer.byteLength(JSON.stringify(f.jobs)),0);
 const report={evidence:'synthetic_host_replay',companies:20,jobs_per_company:10,
  full_daily_baseline:{detail_fetches:200,jd_evaluations:200,raw_job_input_bytes:allBytes},
  cold:{metadata_companies:cold.metadata,detail_fetches:cold.fetched,jd_evaluations:cold.assessed,actual_assessment_task_job_bytes:cold.modelBytes,elapsed_ms:Math.round(coldMs),recommended_companies:cold.report.report.cards.length},
  warm:{metadata_companies:warm.metadata,detail_fetches:warm.fetched,jd_evaluations:warm.assessed,actual_assessment_task_job_bytes:warm.modelBytes,elapsed_ms:Math.round(warmMs),recommended_companies:warm.report.report.cards.length},
  limits:['Full baseline counts are a synthetic workload definition, not an external API run.','Reliable complete-JD change validators are supplied by the synthetic host. Real sites without them still need read-only detail revalidation.','No billed token or network latency claim.']};
 const out=path.resolve(process.argv[2]??'daily-benchmark.json');mkdirSync(path.dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {Date.now=originalNow;e.store.close();rmSync(e.dir,{recursive:true,force:true});}
