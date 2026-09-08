import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, seedProfile, seedJob } from './helpers.mjs';
import { guidance } from '../src/flow.mjs';
import { call } from '../src/service.mjs';
function candidates(e, count, company = '目标公司') {
    const evidence = e.store.all('fact').find(f => f.key === 'project.anchor').id;
    for (let i = 1; i <= count; i++) {
        const j = seedJob(e, e.store.all('job').length + 1);
        e.store.put('job', j.id, { ...j, company });
        e.run('jobs', { operation: 'assess', assessments: [{ job_id: j.id, job_hash: j.content_hash, eligibility: 'unknown',
            mappings: j.requirements.map((r, n) => ({ requirement_id: r.id, relation: n ? 'unknown' : 'transferable', evidence_ids: n ? [] : [evidence], reason: n ? '缺少具体验证证据' : '用户研究经验可迁移' })), advantages: ['合成项目对应'], gaps: [], reason: '有迁移价值但需要核验' }] });
    }
}
test('two results require more research instead of an early selection', t => {
    const e=environment(t); seedProfile(e); candidates(e,2);
    const b=e.run('shortlist',{operation:'daily',mode:'demo',companies:['目标公司']});
    assert.equal(b.discovery.shortage,8); assert.equal(b.discovery.needs_more,true);
    assert.equal(guidance(e.store).next.owner,'agent'); assert.equal(guidance(e.store).can_auto_continue,true);
});
test('target above ten returns and permits selecting the eleventh job', t=>{
    const e=environment(t); seedProfile(e); candidates(e,12);
    const b=e.run('shortlist',{operation:'daily',mode:'demo',target_count:12,companies:['目标公司']});
    assert.equal(b.items.length,12); assert.equal(b.discovery.target_met,true);
    assert.equal(e.run('shortlist',{operation:'choose',batch_id:b.id,numbers:[11],confirmed:true,user_ref:'合成选择'}).applications.length,1);
});
test('company scope separates cached batches and never pads another company', t=>{
    const e=environment(t); seedProfile(e); candidates(e,2,'A'); candidates(e,10,'B');
    const a=e.run('shortlist',{operation:'daily',mode:'demo',companies:['A']});
    const b=e.run('shortlist',{operation:'daily',mode:'demo',companies:['B']});
    assert.notEqual(a.id,b.id); assert.equal(a.items.length,2); assert.equal(b.items.length,10);
    assert(a.items.every(j=>j.company==='A')); assert(b.items.every(j=>j.company==='B'));
});
test('current confirmed company constrains calls using the older input shape',t=>{
    const e=environment(t);seedProfile(e);
    e.run('remember',{mode:'user_statement',confirmed:true,user_ref:'合成目标',facts:[{key:'intent.current_company',value:'A'}]});
    candidates(e,2,'A');candidates(e,10,'B');
    assert(e.run('shortlist',{operation:'daily',mode:'demo'}).items.every(j=>j.company==='A'));
});
test('genuine shortage requires an explanation and exposes risks for each result',t=>{
    const e=environment(t);seedProfile(e);candidates(e,2);
    assert.equal(call(e.store,'jobos1_shortlist',{operation:'daily',mode:'demo',search_complete:true}).error.code,'search_evidence_required');
    const b=e.run('shortlist',{operation:'daily',mode:'demo',search_complete:true,search_note:'合成官网已检查，只有两个符合范围'});
    assert.equal(b.discovery.status,'insufficient');assert.equal(b.discovery.needs_more,false);
    for(const j of b.items){assert(j.recommendation);assert(j.reason);assert(j.risks.some(x=>x.includes('待核验')));assert(j.risks.some(x=>x.includes('资格')));assert(j.evidence_coverage<100);}
});
test('tracking offers alternatives and does not force the outstanding assessment',t=>{
    const e=environment(t);seedProfile(e);e.store.put('settings','focus',{kind:'tracking'});
    e.store.put('notification','n',{normalized_stage:'assessment',deadline:'2026-09-10T04:19:00Z'});
    const g=guidance(e.store);assert.equal(g.next.action,'choose_direction');assert.equal(g.options.length,3);
    assert(g.options.some(x=>x.action==='discover'));assert.equal(g.reminders[0].deadline,'2026-09-10T04:19:00Z');
});
test('completed handoff preserves an explicit optional reply',t=>{
    const e=environment(t);seedProfile(e);e.store.put('settings','focus',{kind:'tracking'});
    const f=e.run('finish',{session_id:'s',turn_id:'t',reason:'done',completed:'已保存',reply:'比较岗位／继续投递'});
    assert(f.text.includes('比较岗位／继续投递'));assert.equal(f.guidance.next.reply,'比较岗位／继续投递');
});

test('continued discovery incorporates new jobs without mutating an earlier numbered batch',t=>{
 const e=environment(t);seedProfile(e);candidates(e,2);
 const first=e.run('shortlist',{operation:'daily',mode:'demo'});
 candidates(e,8);const second=e.run('shortlist',{operation:'daily',mode:'demo'});
 assert.notEqual(first.id,second.id);assert.equal(second.items.length,10);assert.equal(e.store.get('batch',first.id).items.length,2);
});
test('explicit company discovery does not restart incomplete onboarding',t=>{
 const e=environment(t);e.run('remember',{mode:'user_statement',confirmed:true,user_ref:'目标公司',facts:[{key:'intent.current_company',value:'A'}]});
 e.store.put('settings','focus',{kind:'discover'});assert.equal(guidance(e.store).next.action,'discover');assert.equal(guidance(e.store).can_auto_continue,true);
});


test('ten ranked jobs do not hide an unassessed differently titled job',t=>{
 const e=environment(t);seedProfile(e);candidates(e,10);
 const j=seedJob(e,11);e.store.put('job',j.id,{...j,company:'目标公司',title:'体验质量工程师'});
 const b=e.run('shortlist',{operation:'daily',mode:'demo',companies:['目标公司'],search_complete:true,search_note:'合成范围完整'});
 assert.equal(b.items.length,10);assert.equal(b.discovery.target_met,false);
 assert.equal(b.discovery.needs_more,true);assert.equal(b.discovery.known_scope_count,11);
 assert.deepEqual(b.discovery.unassessed_job_ids,[j.id]);
 assert.equal(call(e.store,'jobos1_shortlist',{operation:'choose',batch_id:b.id,numbers:[1],confirmed:true,user_ref:'合成选择'}).error.code,'scope_review_incomplete');
});
test('jobs outside the company scope do not block a reviewed shortlist',t=>{
 const e=environment(t);seedProfile(e);candidates(e,10,'A');
 const j=seedJob(e,11);e.store.put('job',j.id,{...j,company:'B'});
 const b=e.run('shortlist',{operation:'daily',mode:'demo',companies:['A']});
 assert.equal(b.discovery.target_met,true);assert.equal(b.discovery.review_pending,false);
});
