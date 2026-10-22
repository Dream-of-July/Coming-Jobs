import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { call } from '../src/service.mjs';
import { Store } from '../src/store.mjs';
import { guidance } from '../src/flow.mjs';
import { TOOLS } from '../src/catalog.mjs';
import { validate, hash, now } from '../src/core.mjs';
import { environment, seedProfile, seedJob, seedApplication, seedPlan, correctObservations, checkpointArgs, reviewedFitFields } from './helpers.mjs';
test('new user receives one concrete question, not a blank nextAction', t => {
    const e = environment(t), r = e.run('context');
    assert.equal(r.coverage.percent, 0);
    assert.equal(r.question.prompt, '这次主要找校招、实习还是社招？');
    assert.equal(guidance(e.store).next.owner, 'user');
});
test('confirmed profile is loaded in one call and has no artificial age requirement', t => {
    const e = environment(t);
    seedProfile(e);
    const r = e.run('context');
    assert.equal(r.coverage.ready, true);
    assert.equal(r.facts.length, 9);
    assert(!r.coverage.items.some(x => /^(age|gender)$/.test(x.key)));
});
test('current user correction supersedes earlier preference and is durable', t => {
    const e = environment(t);
    seedProfile(e);
    e.run('remember', { mode: 'user_statement', confirmed: true, user_ref: '改为不限', facts: [{ key: 'intent.locations', value: '全球不限' }] });
    const another = new Store(e.dir);
    t.after(() => another.close());
    assert.equal(another.all('fact').find(f => f.key === 'intent.locations').value, '全球不限');
    assert.equal(another.all('fact_history').length, 1);
});
test('extracted content cannot silently become confirmed facts', t => {
    const e = environment(t);
    const s = e.run('workspace', { operation: 'source', label: '授权笔记', kind: 'notes', purposes: ['matching'], text: '只是项目笔记。', authorized: true, user_ref: '授权' });
    e.run('remember', { mode: 'extracted', source_id: s.id, facts: [{ key: 'test', value: '提案', purposes: ['matching'] }] });
    assert.equal(e.store.all('fact').length, 0);
    assert.equal(e.store.all('proposal').length, 1);
});
test('source purpose cannot widen without authorization', t => {
    const e = environment(t);
    const s = e.run('workspace', { operation: 'source', label: '笔记', kind: 'notes', purposes: ['matching'], text: '项目', authorized: true, user_ref: '授权' });
    assert.equal(call(e.store, 'jobos1_remember', { mode: 'extracted', source_id: s.id, facts: [{ key: 'test', value: '提案', purposes: ['resume'] }] }).ok, false);
});
for (const key of ['password', 'otp', 'id_card', 'passport_number', 'api_key'])
    test('secret field rejected: ' + key, t => {
        const e = environment(t);
        const r = call(e.store, 'jobos1_remember', { mode: 'user_statement', confirmed: true, user_ref: 'test', facts: [{ key, value: 'secret' }] });
        assert.equal(r.error.code, 'secret_not_supported');
        assert.equal(e.store.all('fact').length, 0);
    });
test('sensitive demographics cannot be used for matching', t => {
    const e = environment(t);
    const r = call(e.store, 'jobos1_remember', { mode: 'user_statement', confirmed: true, user_ref: 'test', facts: [{ key: 'gender', value: 'test', purposes: ['matching'], sensitive_opt_in: true }] });
    assert.equal(r.error.code, 'sensitive_matching');
});
test('pause, resume and skip preserve answers', t => {
    const e = environment(t);
    seedProfile(e);
    e.run('profile', { operation: 'pause' });
    assert.equal(e.run('context').coverage.paused, true);
    e.run('profile', { operation: 'resume' });
    e.run('profile', { operation: 'skip' });
    assert.equal(e.run('context').facts.length, 9);
});
test('same answered question does not inflate answered count', t => {
    const e = environment(t);
    const a = { mode: 'user_statement', confirmed: true, user_ref: '用户回答', question_id: 'foundation:intent.tracks', facts: [{ key: 'intent.tracks', value: ['campus'] }] };
    e.run('remember', a);
    e.run('remember', a);
    assert.equal(e.run('context').coverage.answered, 1);
});
test('all tool definitions have strictly scoped top-level structures', () => {
    assert.equal(new Set(TOOLS.map(x => x.name)).size, TOOLS.length);
    for (const t of TOOLS)
        assert(t.inputSchema.oneOf || t.inputSchema.additionalProperties === false);
});
test('wrong tool namespace has useful recovery, not legacy fallback', t => {
    const e = environment(t);
    const r = call(e.store, 'jobos_application_start', {});
    assert.equal(r.error.code, 'unknown_tool');
    assert.match(r.error.next, /jobos1_/);
});
test('invalid parameters are rejected before writes', t => {
    const e = environment(t);
    const r = call(e.store, 'jobos1_context', { pageSize: 50 });
    assert.equal(r.error.code, 'invalid_arguments');
    assert.equal(e.store.all('fact').length, 0);
});
test('idempotency replay is safe and conflicting payload rejected', t => {
    const e = environment(t);
    const a = { mode: 'user_statement', confirmed: true, user_ref: '用户回答', request_id: 'one', facts: [{ key: 'name', value: '甲' }] };
    e.run('remember', a);
    e.run('remember', a);
    assert.equal(e.store.all('fact').length, 1);
    const r = call(e.store, 'jobos1_remember', { ...a, facts: [{ key: 'name', value: '乙' }] });
    assert.equal(r.error.code, 'request_conflict');
});
test('full JD cannot produce an empty requirements result', t => { const e = environment(t), j = seedJob(e); assert(j.requirements.length >= 3); });
test('live and demo jobs do not share identifiers', t => { const e = environment(t); assert.notEqual(seedJob(e, 1, 'live').id, seedJob(e, 1, 'demo').id); });
test('recommendation uses exact evidence and freezes stable selection numbers', t => {
    const e = environment(t);
    seedProfile(e);
    e.run('profile', { operation: 'recommend' });
    const evidence = e.store.all('fact').find(f => f.key === 'project.anchor').id;
    for (let i = 1; i <= 12; i++) {
        const j = seedJob(e, i);
        e.run('jobs', { operation: 'assess', assessments: [{ job_id: j.id, job_hash: j.content_hash, ...reviewedFitFields(evidence), mappings: j.requirements.map(r => ({ requirement_id: r.id, relation: 'direct', evidence_ids: [evidence], reason: '合成映射' })), advantages: ['已确认项目'], gaps: ['合成样例无真实招聘推断'], reason: '职责对应' }] });
    }
    const b = e.run('shortlist', { operation: 'daily', mode: 'demo' });
    assert.equal(b.items.length, 10);
    assert(b.items.every(item => item.tier === 'conditional' && item.evidence_refs[0].evidence_id === evidence));
    assert.deepEqual(b.items.map(item => item.number), [1,2,3,4,5,6,7,8,9,10]);
    assert.deepEqual(e.run('shortlist', { operation: 'daily', mode: 'demo' }).items, b.items);
    const chosen = e.run('shortlist', { operation: 'choose', batch_id: b.id, numbers: [1, 3], confirmed: true, user_ref: '选中' });
    assert.equal(chosen.applications.length, 2);
});
test('unconfirmed evidence cannot establish a recommendation', t => {
    const e = environment(t), j = seedJob(e);
    const r = call(e.store, 'jobos1_jobs', { operation: 'assess', assessments: [{ job_id: j.id, job_hash: j.content_hash, eligibility: 'pass', mappings: j.requirements.map(r => ({ requirement_id: r.id, relation: 'direct', evidence_ids: ['invented'], reason: '假的' })), advantages: [], gaps: [], reason: 'test' }] });
    assert.equal(r.ok, false);
});
test('missing portal checkpoint is not a prerequisite for an authorized plan', t => {
    const e = environment(t), s = seedApplication(e), p = seedPlan(e, s);
    assert(p.groups.length === 3);
});
test('input text without selecting a dropdown is a failure', t => {
    const e = environment(t), s = seedApplication(e), p = seedPlan(e, s), obs = correctObservations(s);
    obs[1].fields[0].selected = false;
    e.run('checkpoint', checkpointArgs(s, p, obs));
    const r = e.run('review', { application_id: s.app.id, portal_url: 'https://jobs.example.com/application' });
    assert.equal(r.ready, false);
    assert.equal(r.blockers[0].key, 'education');
});
test('missing region cannot be called complete merely because other inputs exist', t => {
    const e = environment(t), s = seedApplication(e), p = seedPlan(e, s);
    e.run('checkpoint', checkpointArgs(s, p, correctObservations(s).slice(1)));
    const r = e.run('review', { application_id: s.app.id, portal_url: 'https://jobs.example.com/application' });
    assert.equal(r.ready, false);
    assert(r.blockers.some(x => x.key === 'identity'));
});
test('unmentioned origin is not covered by an old authorization', t => {
    const e = environment(t), s = seedApplication(e), p = seedPlan(e, s);
    const r = call(e.store, 'jobos1_checkpoint', { ...checkpointArgs(s, p), portal_url: 'https://other.example.com/form' });
    assert.equal(r.error.code, 'origin_changed');
});
test('two sessions cannot write one form with the same lease', t => {
    const e = environment(t), s = seedApplication(e), p = seedPlan(e, s);
    const r = call(e.store, 'jobos1_authorize', { application_id: s.app.id, plan_hash: p.content_hash, portal_url: 'https://jobs.example.com/application', session_id: 'another', confirmed: true, user_ref: 'test' });
    assert.equal(r.error.code, 'writer_busy');
});
test('correct full readback passes and leaves final submit human-only', t => {
    const e = environment(t), s = seedApplication(e), p = seedPlan(e, s);
    e.run('checkpoint', checkpointArgs(s, p));
    const r = e.run('review', { application_id: s.app.id, portal_url: 'https://jobs.example.com/application' });
    assert.equal(r.ready, true);
    assert.equal(r.final_submit, 'batch_grant_only');
    assert.equal(guidance(e.store).next.action, 'human_submit');
});
test('restoring draft must not overwrite a third user value', t => {
    const e = environment(t), s = seedApplication(e), p = seedPlan(e, s);
    e.run('checkpoint', checkpointArgs(s, p));
    const r = e.run('recover', { application_id: s.app.id, fields: [{ key: 'name', value: '用户改的新名' }, { key: 'school', value: '旧校', selected: true }] });
    assert.equal(r.conflicts.length, 1);
    assert.equal(r.operations.length, 1);
});
test('portal observation works with no checkpoint and preserves evidence distinction', t => {
    const e = environment(t), s = seedApplication(e, 'live');
    const r = e.run('outcome', { application_id: s.app.id, stage: 'assessment', source: 'official_portal', observed_at: now(), job_id: '1', observation_ref: 'synthetic-observation', user_confirmed: true, user_ref: '用户已提交', actual_resume_sha256: s.material.asset.sha256 });
    assert.equal(r.application.stage, 'assessment');
    assert.equal(r.application.provider_verified, false);
    assert.equal(r.application.submission_evidence, 'portal_observed');
});
test('user-reported submission is not counted as portal verified', t => {
    const e = environment(t), s = seedApplication(e, 'live');
    e.run('outcome', { application_id: s.app.id, stage: 'submitted', source: 'user_report', observed_at: now(), user_confirmed: true, user_ref: '用户已提交' });
    const m = e.run('context', { scope: 'metrics' });
    assert.equal(m.portal_observed_submitted, 0);
    assert.equal(m.user_reported_submitted, 1);
});
test('queue includes submitted companies without providers', t => {
    const e = environment(t), s = seedApplication(e, 'live');
    e.run('outcome', { application_id: s.app.id, stage: 'submitted', source: 'user_report', observed_at: now(), user_confirmed: true, user_ref: '提交' });
    const q = e.run('followup', { operation: 'queue' });
    assert.equal(q.applications.length, 1);
    assert.equal(q.applications[0].capability, 'not_configured');
});
test('older observations cannot regress newer interview stage', t => {
    const e = environment(t), s = seedApplication(e, 'live');
    e.run('outcome', { application_id: s.app.id, stage: 'interview', source: 'email', observed_at: now() });
    const r = e.run('outcome', { application_id: s.app.id, stage: 'screening', source: 'email', observed_at: new Date(Date.now() - 3600000).toISOString() });
    assert.equal(r.application.stage, 'interview');
});
test('submitted material remains immutable when later status arrives', t => {
    const e = environment(t), s = seedApplication(e);
    e.run('outcome', { application_id: s.app.id, stage: 'assessment', source: 'official_portal', observed_at: now(), job_id: '1', observation_ref: 'fixture', actual_resume_sha256: s.material.asset.sha256 });
    e.run('outcome', { application_id: s.app.id, stage: 'interview', source: 'email', observed_at: now() });
    assert.equal(e.run('interview', { operation: 'context', application_id: s.app.id }).submitted.resume.asset.sha256, s.material.asset.sha256);
});
test('ambiguous outcome never generates another-submit guidance', t => {
    const e = environment(t), s = seedApplication(e);
    e.run('outcome', { application_id: s.app.id, stage: 'unknown', source: 'user_report', observed_at: now() });
    assert.equal(guidance(e.store).next.action, 'verify_outcome');
});
test('notification redacts specific URLs before persistence', t => {
    const e = environment(t), s = seedApplication(e);
    const a = { operation: 'notification', application_id: s.app.id, source: 'email', reference_id: 'msg1', sender_label: '招聘', received_at: now(), deadline_hours: 72, stage: 'assessment', action_required: '参加测评 https://exam.example.com/private/secret-path', permission_state: 'available' };
    const r = e.run('followup', a);
    assert(!JSON.stringify(r).includes('secret-path'));
    assert.equal(Date.parse(r.notification.deadline) - Date.parse(r.notification.received_at), 72 * 3600000);
    assert.equal(e.run('followup', a).notify, false);
});
test('missing receipt time does not invent deadline', t => {
    const e = environment(t), s = seedApplication(e);
    const r = e.run('followup', { operation: 'notification', application_id: s.app.id, source: 'sms', reference_id: 'msg', sender_label: '招聘', deadline_hours: 72, stage: 'assessment', action_required: '测评', permission_state: 'available' });
    assert.equal(r.notification.deadline, null);
    assert.equal(r.notification.deadline_unknown, true);
});
test('schedule saved is not schedule active', t => {
    const e = environment(t);
    const r = e.run('followup', { operation: 'configure', timezone: 'Asia/Shanghai', times: ['09:00'], include_email: true, include_sms: true, confirmed: true, user_ref: '每日跟进' });
    assert.equal(r.state, 'planned');
});
test('interview quotes must exist in authorized transcript', t => {
    const e = environment(t), s = seedApplication(e);
    const src = e.run('workspace', { operation: 'source', label: '面试转写', kind: 'transcript', text: '候选人：我制作了交互原型。', purposes: ['interview'], authorized: true, user_ref: '授权复盘' });
    const r = call(e.store, 'jobos1_interview', { operation: 'debrief', application_id: s.app.id, source_id: src.id, findings: [{ kind: 'strength', point: 'test', quote: '我带来100%增长', locator: '00:01', next_practice: 'test' }] });
    assert.equal(r.error.code, 'quote_not_found');
});
test('new interview memory is proposed, not a confirmed achievement', t => {
    const e = environment(t), s = seedApplication(e);
    const quote = '我制作了交互原型。';
    const src = e.run('workspace', { operation: 'source', label: '面试', kind: 'transcript', text: '候选人：' + quote, purposes: ['interview'], authorized: true, user_ref: '授权' });
    e.run('interview', { operation: 'debrief', application_id: s.app.id, source_id: src.id, findings: [], memory_candidates: [{ speaker: 'candidate', key: 'new.project', value: '交互原型', quote }] });
    assert.equal(e.store.all('proposal').at(-1).state, 'proposed');
});
test('finish produces a concrete next action rather than an empty stop', t => {
    const e = environment(t);
    const r = e.run('finish', { session_id: 's', turn_id: 't', reason: 'need_user', completed: '已创建本地资料空间。' });
    assert.match(r.text, /下一步：/);
    assert.match(r.text, /简历|哪类工作/);
});
test('finish advises continuation when an internal step needs no decision', t => {
    const e = environment(t);
    seedApplication(e);
    const r = e.run('finish', { session_id: 's', turn_id: 't', reason: 'need_user', completed: '简历已审核。' });
    assert.equal(r.should_continue, true);
});
test('pause preserves a simple resumption instruction', t => {
    const e = environment(t);
    const r = e.run('finish', { session_id: 's', turn_id: 't', reason: 'paused', completed: '已保存。' });
    assert.match(r.text, /回复“继续”/);
});
