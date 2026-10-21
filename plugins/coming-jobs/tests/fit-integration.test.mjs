import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, seedProfile } from './helpers.mjs';
import { call } from '../src/service.mjs';
import { now } from '../src/core.mjs';
import { opportunity } from '../src/opportunities.mjs';
import { dailySetup, addCompany, drive } from './daily-helpers.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

function setup(t) {
    const e=environment(t); seedProfile(e);
    const evidence=e.store.all('fact').find(f=>f.key==='project.anchor').id;
    const company=e.run('daily',{operation:'company',company:{name:'合成比较公司',scopes:[{track:'campus',campaign:'2027',source_url:'https://jobs.example.com/campus'}]}});
    e.run('daily',{operation:'opportunity',company_id:company.id,track:'campus',campaign:'2027',limit:10,source:'official',source_ref:'https://jobs.example.com/rules',observed_at:now()});
    const job=e.run('jobs',{operation:'ingest',coverage:'partial',jobs:[{company:company.name,title:'合成产品岗位',jd:'负责个人用户的反馈体验和产品需求定义。任职要求：本科毕业，能够清晰地表达需求并通过原型验证方案。',requirements:[{id:'r1',text:'本科毕业',kind:'requirement'}],external_id:'test-one',track:'campus',campaign:'2027',source:'official',mode:'demo',url:'https://jobs.example.com/campus/test-one',observed_at:now()}]}).jobs[0];
    const entry={source_url:'https://jobs.example.com/campus',track:'campus',campaign:'2027',external_ids:['test-one'],complete:true,observed_at:now()};
    e.run('jobs',{operation:'ingest',mode:'demo',coverage:'explicit_scope_complete',jobs:[],collection:{company:company.name,track:'campus',campaign:'2027',source_url:entry.source_url,external_ids:['test-one'],total:1,pages_read:1,has_more:false,complete:true,observed_at:now(),entries:[entry],live_entries:[entry],live_checked_at:now()}});
    const assessment={job_id:job.id,job_hash:job.content_hash,mappings:[{requirement_id:'r1',relation:'direct',evidence_ids:[evidence],reason:'合成原型可核验'}],eligibility:'pass',advantages:['具体合成产物'],gaps:[],reason:'个人用户的反馈与合成项目同属反馈纠正任务',service_object:'consumer',core_deliverable:'product_spec',hard_gates:[{gate:'degree',source:'requirement',status:'meets',note:'合成本科条件核实',requirement_id:'r1'}],tier:'priority',evidence_refs:[{evidence_id:evidence,level:'self_statement'}]};
    return {e,evidence,company,job,assessment};
}
test('graded private availability and capabilities invalidate existing assessment context',t=>{
    const {e,assessment}=setup(t);
    const before=e.run('jobs',{operation:'assess',assessments:[assessment]}).assessments[0];
    e.run('profile',{operation:'fit_context',availability:{location:'合成城市',earliest_start:'2027-07-01',days_per_week:3,continuous_months:2},capabilities:[{name:'合成引擎',breadth_depth:'breadth',level:'self_statement',note:'仅探索过示例'}],graduation_year:2027,preferred_service_objects:['consumer'],preferred_deliverables:['product_spec'],confirmed:true,user_ref:'合成本人确认'});
    const context=e.run('context',{scope:'profile'});
    assert.equal(context.fit_context.availability.days_per_week,3);
    assert.equal(context.fit_context.capabilities[0].breadth_depth,'breadth');
    const after=e.run('jobs',{operation:'assess',assessments:[assessment]}).assessments[0];
    assert.notEqual(before.profile_hash,after.profile_hash);
});
test('evidence metadata cannot upgrade an inference fact into an original artifact',t=>{
    const {e,assessment,evidence}=setup(t);
    e.store.put('fact',evidence,{...e.store.get('fact',evidence),evidence_level:'inference'});
    const out=call(e.store,'jobos1_jobs',{operation:'assess',assessments:[{...assessment,evidence_refs:[{evidence_id:evidence,level:'original_artifact'}]}]});
    assert.equal(out.ok,false); assert.equal(out.error.code,'evidence_level_mismatch');
});
test('legacy assessment is unknown and cannot silently become a recommendation',t=>{
    const {e,job,assessment}=setup(t);
    const {service_object,core_deliverable,hard_gates,tier,evidence_refs,...legacy}=assessment;
    const saved=e.run('jobs',{operation:'assess',assessments:[legacy]}).assessments[0];
    assert.equal(saved.eligibility,'unknown'); assert.equal(saved.tier,'qualification_hold');
    assert.equal(e.run('shortlist',{operation:'daily',mode:'demo',companies:[job.company]}).items.length,0);
});
test('opportunity rules keep source, amendment order, deadline and stale verification warning',t=>{
    t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-08T01:00:00Z')});
    const {e,company}=setup(t);
    e.run('daily',{operation:'opportunity',company_id:company.id,track:'campus',campaign:'2027',limit:1,can_change:false,volunteer_order:'ordered',deadline:'2027-01-01T00:00:00Z',source:'official',source_ref:'https://jobs.example.com/rules',observed_at:now()});
    t.mock.timers.tick(8*86400000);
    const result=opportunity(e.store,company,{track:'campus',campaign:'2027'},'demo');
    assert.equal(result.can_change,false); assert.equal(result.volunteer_order,'ordered');
    assert.equal(result.rules_verification,'unreviewed'); assert.match(result.note,/未复核/);
});
test('exhausted company is reference only and shortlist selection rechecks quota',t=>{
    const {e,company,job,assessment}=setup(t);
    e.run('jobs',{operation:'assess',assessments:[assessment]});
    const batch=e.run('shortlist',{operation:'daily',mode:'demo',companies:[company.name]});
    e.run('daily',{operation:'opportunity',company_id:company.id,track:'campus',campaign:'2027',limit:0,source:'official',source_ref:'https://jobs.example.com/rules',observed_at:now()});
    assert.equal(e.run('shortlist',{operation:'daily',mode:'demo',companies:[company.name]}).items.length,0);
    const out=call(e.store,'jobos1_shortlist',{operation:'choose',batch_id:batch.id,numbers:[1],confirmed:true,user_ref:'合成选择'});
    assert.equal(out.ok,false); assert.equal(out.error.code,'opportunity_exhausted');
    assert.equal(e.store.all('application').length,0);
});
test('live-list delta is persisted and missing newly listed detail blocks coverage',t=>{
    const {e,job}=setup(t);
    const entry={source_url:'https://jobs.example.com/campus',track:'campus',campaign:'2027',external_ids:['test-one'],complete:true,observed_at:now()};
    const out=e.run('jobs',{operation:'ingest',mode:'demo',coverage:'partial',jobs:[],collection:{company:job.company,track:'campus',campaign:'2027',source_url:entry.source_url,observed_at:now(),total:1,external_ids:['test-one'],pages_read:1,has_more:false,complete:true,entries:[entry],live_entries:[{...entry,external_ids:['test-one','test-two']}],live_checked_at:now()}});
    assert.deepEqual(out.collection.coverage.added_ids,['test-two']);
    assert.equal(out.collection.complete,false);
});
test('comparison and profile flow do not read a previous shortlist before independent sealing',t=>{
    const {e,company}=setup(t);
    e.store.put('settings','focus',{kind:'shortlist'});
    const original=e.store.all.bind(e.store);
    e.store.all=kind=>{assert.notEqual(kind,'batch','independent assessment must not acquire old rankings through guidance');return original(kind);};
    const result=e.run('comparison',{operation:'start',comparison_key:'synthetic-anti-anchor',company_ids:[company.id],mode:'demo'});
    assert.equal(result.run.companies.length,1);
    assert.equal(e.run('context',{scope:'profile'}).fit_context.capabilities.length,0);
    e.run('profile',{operation:'fit_context',graduation_year:2027,confirmed:true,user_ref:'合成更新'});
});
test('partial availability and capability answers preserve other confirmed fields',t=>{
    const {e}=setup(t);
    e.run('profile',{operation:'fit_context',availability:{location:'合成城市',days_per_week:4,continuous_months:6},capabilities:[{name:'合成工具甲',breadth_depth:'depth',level:'self_statement'}],confirmed:true,user_ref:'合成安排'});
    e.run('profile',{operation:'fit_context',availability:{earliest_start:'2027-06-01'},capabilities:[{name:'合成工具乙',breadth_depth:'breadth',level:'self_statement'}],confirmed:true,user_ref:'合成补充日期'});
    const context=e.run('context',{scope:'profile'}).fit_context;
    assert.deepEqual(context.availability,{location:'合成城市',days_per_week:4,continuous_months:6,earliest_start:'2027-06-01'});
    assert.deepEqual(context.capabilities.map(c=>c.name),['合成工具甲','合成工具乙']);
});
test('legacy transfer facts retain unknown provenance rather than claiming original words',t=>{
    const e=environment(t),file=path.join(e.dir,'synthetic-transfer.json');
    writeFileSync(file,JSON.stringify({format:'jobos-transfer/1',facts:[{key:'project.anchor',value:'合成旧项目',confirmed:true}]}));
    e.run('workspace',{operation:'import',file,authorized:true,user_ref:'合成备份授权'});
    assert.equal(e.store.all('fact')[0].evidence_level,'inference');
});
test('campaign deadline blocks existing shortlist selection and later daily recommendations',t=>{
    t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-08T01:00:00Z')});
    const {e,company,assessment}=setup(t);
    e.run('jobs',{operation:'assess',assessments:[assessment]});
    const batch=e.run('shortlist',{operation:'daily',mode:'demo',companies:[company.name]});
    assert.equal(batch.items.length,1);
    e.run('daily',{operation:'opportunity',company_id:company.id,track:'campus',campaign:'2027',limit:10,deadline:'2026-09-08T02:00:00Z',source:'official',source_ref:'https://jobs.example.com/rules',observed_at:now()});
    t.mock.timers.tick(3600001);
    assert.notEqual(opportunity(e.store,company,{track:'campus',campaign:'2027'},'demo').state,'available');
    const selected=call(e.store,'jobos1_shortlist',{operation:'choose',batch_id:batch.id,numbers:[1],confirmed:true,user_ref:'合成选择'});
    assert.equal(selected.ok,false);assert.equal(e.store.all('application').length,0);
});
test('daily excludes another direction under an already applied parent even with remaining quota',t=>{
    const e=environment(t);dailySetup(e);const fixture=addCompany(e);
    fixture.jobs=fixture.jobs.map(j=>({...j,parent_application_id:'shared-synthetic-parent'}));
    const done=drive(e,[fixture]);assert.equal(done.report.report.cards.length,1);
    const job=e.store.all('job')[0];
    e.store.put('application','synthetic-parent-app',{company:fixture.company.name,mode:'live',stage:'submitted',job_id:job.id,submission_evidence:'official_portal',job_snapshot:job});
    assert.equal(e.run('daily',{operation:'report',run_id:done.run.id}).report.cards.length,0);
});
test('future job observation cannot become a current official snapshot',t=>{
    const {e,job}=setup(t);const {id,revision,content_hash,requirements,...raw}=job;
    const out=call(e.store,'jobos1_jobs',{operation:'ingest',coverage:'partial',jobs:[{...raw,external_id:'future',observed_at:new Date(Date.now()+86400000).toISOString()}]});
    assert.equal(out.ok,false);assert.equal(out.error.code,'future_observation');
});
test('previous daily configuration cannot retain a twenty-company deep-review limit',t=>{
    const e=environment(t);dailySetup(e);
    const current=e.store.get('settings','daily');
    e.store.put('settings','daily',{...current,company_limit:20,values:{...current.values,company_limit:20}});
    const normalized=e.run('daily',{operation:'configure',confirmed:true,user_ref:'合成沿用配置'});
    assert.equal(normalized.company_limit,5);
});
test('restore migrates a score-only assessment to unknown without rewriting its official job',t=>{
    const {e,job,assessment}=setup(t);
    const {service_object,core_deliverable,hard_gates,tier,evidence_refs,...legacy}=assessment;
    e.store.put('assessment',job.id,{...legacy,score:99});
    const backup=e.run('workspace',{operation:'export',authorized:true,user_ref:'合成导出'}), restored=environment(t);
    restored.run('workspace',{operation:'import',file:backup.file,assets_dir:backup.assets_directory,authorized:true,user_ref:'合成恢复'});
    const normalized=restored.store.get('assessment',job.id);
    assert.equal(normalized.eligibility,'unknown');assert.equal(normalized.tier,'qualification_hold');
    assert.equal(Object.hasOwn(normalized,'score'),false);
    assert.equal(restored.store.get('job',job.id).content_hash,job.content_hash);
});
test('daily report preserves a suitable role as a qualification hold when its quota rules become stale',t=>{
    const e=environment(t);dailySetup(e);const fixture=addCompany(e),done=drive(e,[fixture]);
    assert.equal(done.report.report.cards.length,1);
    assert.equal((done.report.report.markdown.match(/合成产品岗位0/g)??[]).length,1,'a qualified role must not also appear in a hold section');
    const rule=e.store.all('opportunity')[0];
    e.store.put('opportunity',rule.id,{...rule,observed_at:new Date(Date.now()-8*86400000).toISOString()});
    const report=e.run('daily',{operation:'report',run_id:done.run.id}).report;
    assert.equal(report.cards.length,0);
    assert.match(report.markdown,/合成产品岗位0/);
    assert.match(report.markdown,/资格待澄清/);assert.match(report.markdown,/未复核/);
});
