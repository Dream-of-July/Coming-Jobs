import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { now, hash, validate, O, S } from '../src/core.mjs';
import { remember } from '../src/profile.mjs';
import { registerCompany, setOpportunity } from '../src/opportunities.mjs';

const api = await import('../src/comparison.mjs').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return {};
});
const comparison = api.comparison;
const schemaApi = await import('../src/comparison-schema.mjs').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return {};
});

function fixture(t, count = 1, roles = 2, { tracks = ['campus'], limits = {} } = {}) {
    const home = mkdtempSync(path.join(os.tmpdir(), 'jobos-comparison-test-'));
    let store = new Store(home);
    t.after(() => { store.close(); rmSync(home, { recursive: true, force: true }); });
    remember(store, { mode: 'user_statement', confirmed: true, user_ref: '合成比较授权', facts: [
        { key: 'intent.tracks', value: tracks }, { key: 'intent.direction', value: '交互产品设计' },
        { key: 'intent.locations', value: ['北京', '深圳'] }, { key: 'education.summary', value: '合成大学本科，2027年6月毕业' },
        { key: 'education.graduation_date', value: '2027-06-30' },
        { key: 'experience.summary', value: '合成项目：访谈用户并交付交互原型' },
        { key: 'project.anchor', value: '合成界面项目，完成需求访谈和交互方案验证' }
    ] });
    const fixtures = Array.from({ length: count }, (_, index) => {
        const scopes = tracks.map(track => ({ track, campaign: '2027', source_url: `https://jobs.example.com/company/${index}/${track}` }));
        const company = registerCompany(store, { name: `合成公司${index + 1}`, scopes });
        for (const scope of scopes) setOpportunity(store, { company_id: company.id, ...scope, limit: 10, exhausted: false, source: 'official', source_ref: scope.source_url, observed_at: now() });
        const jobs = scopes.flatMap(scope => Array.from({ length: roles }, (_, role) => ({ company: company.name, title: `交互产品岗位${role + 1}`, url: `${scope.source_url}/${role}`,
            jd: '岗位职责：访谈实际使用者并交付交互原型，协同团队验证需求与迭代方案。任职要求：能够整理真实用户问题并清楚表达方案。',
            requirements: [{ id: 'r1', text: '访谈实际使用者并交付交互原型', kind: 'responsibility' }],
            ...scope, external_id: `${scope.track}-${role}`, observed_at: now(), source: 'official', mode: 'demo', locations: ['北京'] })));
        return { company, scopes, jobs };
    });
    return {
        get store() { return store; }, fixtures, home,
        invoke(args) { return store.mutate('comparison-test', args, () => comparison(store, args)); },
        start(key = 'synthetic-comparison', extra = {}) { return this.invoke({ operation: 'start', comparison_key: key, company_ids: fixtures.map(x => x.company.id), mode: 'demo', limits: { details: 1000, assessments: 1000, batch_size: 2, ...limits }, ...extra }); },
        reopen() { store.close(); store = new Store(home); }
    };
}

function collection(f, scope, jobs = f.jobs.filter(j => j.track === scope.track)) {
    const external_ids = jobs.map(j => j.external_id);
    return { company: f.company.name, ...scope, total: external_ids.length, external_ids, pages_read: 1, has_more: false, complete: true,
        observed_at: now(), live_checked_at: now(), entries: [{ ...scope, external_ids, total: external_ids.length, complete: true, observed_at: now() }],
        live_entries: [{ ...scope, external_ids, total: external_ids.length, complete: true, observed_at: now() }] };
}

function assessment(e, job, overrides = {}) {
    const fact = e.store.all('fact').find(f => f.key === 'project.anchor');
    return { job_id: job.id, job_hash: job.content_hash,
        mappings: job.requirements.map(r => ({ requirement_id: r.id, relation: 'direct', evidence_ids: [fact.id], reason: '合成项目中亲自访谈用户并交付交互原型' })),
        eligibility: 'pass', advantages: ['合成项目的访谈与原型交付'], gaps: [], reason: '实际任务与已确认的交互项目相连',
        service_object: 'consumer', core_deliverable: 'interaction_design', tier: 'priority', hard_gates: [], gates_complete: true,
        evidence_refs: [{ evidence_id: fact.id, level: 'self_statement', note: '由合成候选人确认的项目陈述' }], ...overrides };
}

function handle(e, run, task, { overrideAssessment, subset } = {}) {
    const f = e.fixtures.find(f => f.company.id === task.company_id);
    if (task.kind === 'collect') {
        const all = f.jobs.filter(j => j.track === task.scope.track && j.campaign === task.scope.campaign);
        const jobs = subset ?? all.slice(task.ingested_count ?? 0, (task.ingested_count ?? 0) + task.detail_limit);
        e.invoke({ operation: 'ingest', run_id: run.id, task_id: task.id, jobs, collection: collection(f, task.scope, all), cursor: 'page:1' });
        return e.invoke({ operation: 'observe', run_id: run.id, task_id: task.id, state: 'done' });
    }
    return e.invoke({ operation: 'assess', run_id: run.id, task_id: task.id,
        assessments: task.jobs.map(j => assessment(e, j, overrideAssessment?.(j) ?? {})) });
}

function finish(e, run, options = {}) {
    for (let i = 0; i < 500; i++) {
        const result = e.invoke({ operation: 'next', run_id: run.id, limit: 1 });
        if (!result.tasks.length) return result;
        handle(e, run, result.tasks[0], options);
    }
    assert.fail('comparison failed to reach a finite stop');
}

test('comparison exports a separate resumable tool and report helpers', () => {
    assert.equal(typeof comparison, 'function');
    assert.equal(typeof api.diffRankings, 'function');
    assert.equal(typeof api.renderComparisonReport, 'function');
    assert.equal(typeof schemaApi.comparisonSchema, 'function');
});

test('start freezes explicit company scopes and retries do not reset cumulative limits', t => {
    const e = fixture(t, 2);
    const first = e.start('same-key', { limits: { details: 4, assessments: 3, batch_size: 2 } });
    const retry = e.start('same-key', { limits: { details: 900, assessments: 900, batch_size: 10 } });
    assert.equal(retry.run.id, first.run.id);
    assert.deepEqual(retry.run.limits, { details: 4, assessments: 3, batch_size: 2 });
    registerCompany(e.store, { company_id: e.fixtures[0].company.id, name: e.fixtures[0].company.name, scopes: [] });
    assert.equal(e.invoke({ operation: 'next', run_id: first.run.id }).tasks[0].scope.campaign, '2027');
    assert.throws(() => e.invoke({ operation: 'start', comparison_key: 'too-many', company_ids: Array(21).fill(e.fixtures[0].company.id) }), { code: 'comparison_company_limit' });
    assert.equal(e.store.all('daily_budget').length, 0);
});

test('twenty company comparison resumes after five companies without repeating details or assessments', t => {
    const e = fixture(t, 20);
    const { run } = e.start('twenty');
    let stop;
    for (let i = 0; i < 100; i++) {
        stop = e.invoke({ operation: 'next', run_id: run.id, limit: 1 });
        if (stop.cursor.completed_companies >= 5) break;
        handle(e, run, stop.tasks[0]);
    }
    assert.equal(stop.cursor.completed_companies, 5);
    const budget = { ...stop.budget };
    const issued = stop.tasks.map(task => task.id);
    e.reopen();
    assert.equal(e.start('twenty').run.id, run.id);
    const resumed = e.invoke({ operation: 'next', run_id: run.id, limit: 1 });
    assert.deepEqual(resumed.budget, budget);
    assert.deepEqual(resumed.tasks.map(task => task.id), issued);
    const result = finish(e, run);
    assert.equal(result.cursor.completed_companies, 20);
    assert.equal(result.budget.details_used, 40);
    assert.equal(result.budget.assessments_used, 40);
    const sealed = e.invoke({ operation: 'seal', run_id: run.id });
    assert.equal(sealed.snapshot.coverage.complete, true);
    assert.equal(sealed.snapshot.items.length, 40);
    assert.equal(e.store.all('daily_budget').length, 0);
    assert.equal(e.store.all('application').length, 0);
});

test('ingest retry consumes a detail version once and next reuses pending reservations', t => {
    const e = fixture(t, 2);
    const { run } = e.start();
    const next = e.invoke({ operation: 'next', run_id: run.id, limit: 2 });
    assert.equal(next.tasks.length, 2);
    assert.deepEqual(e.invoke({ operation: 'next', run_id: run.id, limit: 2 }).tasks.map(x => x.id), next.tasks.map(x => x.id));
    const task = next.tasks[0], f = e.fixtures.find(f => f.company.id === task.company_id);
    const args = { operation: 'ingest', run_id: run.id, task_id: task.id, jobs: f.jobs, collection: collection(f, task.scope), cursor: 'page:1' };
    e.invoke(args); e.invoke(args);
    assert.equal(e.invoke({ operation: 'next', run_id: run.id }).budget.details_used, 2);
    assert.throws(() => e.invoke({ ...args, cursor: 'https://jobs.example.com/private?session=secret' }), { code: 'comparison_private_cursor' });
    assert.throws(() => e.invoke({ ...args, jobs: [{ ...f.jobs[0], company: '范围外公司' }] }), { code: 'comparison_scope_mismatch' });
});

test('budget stop preserves missing role IDs and rejects a complete seal', t => {
    const e = fixture(t, 1, 3, { limits: { details: 1, assessments: 1, batch_size: 1 } });
    const { run } = e.start();
    const task = e.invoke({ operation: 'next', run_id: run.id }).tasks[0], f = e.fixtures[0];
    e.invoke({ operation: 'ingest', run_id: run.id, task_id: task.id, jobs: [f.jobs[0]], collection: collection(f, task.scope), cursor: 'page:2' });
    e.invoke({ operation: 'observe', run_id: run.id, task_id: task.id, state: 'partial', reason: '本次详细正文预算已用完', cursor: 'page:2' });
    const status = finish(e, run);
    assert.equal(status.cursor.completed_companies, 0);
    assert.ok(status.coverage.blockers.some(b => b.missing_external_ids?.includes('campus-2')));
    assert.throws(() => e.invoke({ operation: 'seal', run_id: run.id }), { code: 'comparison_incomplete' });
    const sealed = e.invoke({ operation: 'seal', run_id: run.id, allow_partial: true, reason: '保留正文预算缺口' });
    assert.equal(sealed.snapshot.coverage.complete, false);
    assert.equal(sealed.snapshot.status, 'partial');
});

test('a partial range retains a confirmed exclusion while keeping the scope incomplete', t => {
    const e = fixture(t, 1, 3, { limits: { details: 1, assessments: 1, batch_size: 1 } });
    const { run } = e.start();
    const task = e.invoke({ operation: 'next', run_id: run.id }).tasks[0], f = e.fixtures[0];
    e.invoke({ operation: 'ingest', run_id: run.id, task_id: task.id, jobs: [f.jobs[0]], collection: collection(f, task.scope) });
    e.invoke({ operation: 'observe', run_id: run.id, task_id: task.id, state: 'partial', reason: '正文预算仍有明确缺口' });
    finish(e, run, { overrideAssessment: () => ({ tier: 'excluded', hard_gates: [{ gate: 'availability', source: 'requirement', status: 'fails', note: '已确认到岗条件不满足要求' }] }) });
    const snapshot = e.invoke({ operation: 'seal', run_id: run.id, allow_partial: true, reason: '保留未读正文范围' }).snapshot;
    assert.equal(snapshot.coverage.complete, false);
    assert.equal(snapshot.excluded.length, 1);
    assert.equal(snapshot.recommendations.length, 0);
});

test('a partially assessed scope cannot recommend its assessed subset', t => {
    const e = fixture(t, 1, 2, { limits: { details: 2, assessments: 1, batch_size: 2 } });
    const { run } = e.start(); finish(e, run);
    const snapshot = e.invoke({ operation: 'seal', run_id: run.id, allow_partial: true, reason: '评估预算保留一个未评估岗位' }).snapshot;
    assert.equal(snapshot.coverage.assessed_count, 1);
    assert.equal(snapshot.coverage.complete, false);
    assert.equal(snapshot.recommendations.length, 0);
    assert.equal(snapshot.qualification_hold.length, 1);
});

test('a blocked public source resumes the same scope and keeps a URL free cursor', t => {
    const e = fixture(t);
    const { run } = e.start();
    const task = e.invoke({ operation: 'next', run_id: run.id }).tasks[0];
    e.invoke({ operation: 'observe', run_id: run.id, task_id: task.id, state: 'blocked', reason: '官网暂时不可读', cursor: 'page:4' });
    const stopped = e.invoke({ operation: 'next', run_id: run.id });
    assert.equal(stopped.tasks.length, 0);
    assert.ok(stopped.coverage.blockers.some(b => b.reason === '官网暂时不可读'));
    e.invoke({ operation: 'observe', run_id: run.id, task_id: task.id, state: 'collect', reason: '公开入口恢复可读' });
    const resumed = e.invoke({ operation: 'next', run_id: run.id });
    assert.equal(resumed.tasks[0].cursor, 'page:4');
    finish(e, run);
    assert.equal(e.invoke({ operation: 'seal', run_id: run.id }).snapshot.status, 'complete');
});

test('old complete collection still needs a live list check today and zero roles retain the official entry', t => {
    const e = fixture(t, 1, 0);
    const { run } = e.start();
    const task = e.invoke({ operation: 'next', run_id: run.id }).tasks[0], f = e.fixtures[0];
    const old = collection(f, task.scope);
    old.live_checked_at = '2020-01-01T00:00:00Z'; old.live_entries[0].observed_at = old.live_checked_at;
    e.invoke({ operation: 'ingest', run_id: run.id, task_id: task.id, jobs: [], collection: old });
    assert.throws(() => e.invoke({ operation: 'observe', run_id: run.id, task_id: task.id, state: 'done' }), { code: 'comparison_scope_incomplete' });
    e.invoke({ operation: 'ingest', run_id: run.id, task_id: task.id, jobs: [], collection: collection(f, task.scope) });
    e.invoke({ operation: 'observe', run_id: run.id, task_id: task.id, state: 'done' });
    const sealed = e.invoke({ operation: 'seal', run_id: run.id });
    assert.equal(sealed.snapshot.coverage.scopes[0].source_url, f.scopes[0].source_url);
    assert.equal(sealed.snapshot.coverage.scopes[0].listed_count, 0);
    assert.equal(sealed.snapshot.coverage.complete, true);
});

test('previous rankings remain inaccessible until the independent snapshot is sealed and cannot change it', t => {
    const e = fixture(t);
    e.store.put('batch', 'previous-only', { mode: 'demo', items: [{ job_id: 'old-role', company: '合成旧排序', title: '旧标题', reason: '旧结论' }] });
    const { run } = e.start();
    assert.throws(() => e.invoke({ operation: 'previous', run_id: run.id, previous_batch_id: 'previous-only' }), { code: 'comparison_unsealed' });
    finish(e, run);
    const first = e.invoke({ operation: 'seal', run_id: run.id }).snapshot;
    const before = hash(first);
    const previous = e.invoke({ operation: 'previous', run_id: run.id, previous_batch_id: 'previous-only' });
    assert.equal(previous.independent_snapshot_hash, first.snapshot_hash);
    assert.ok(previous.diff.missed.length > 0);
    assert.equal(hash(e.invoke({ operation: 'seal', run_id: run.id }).snapshot), before);
    assert.throws(() => e.invoke({ operation: 'next', run_id: run.id, limit: 1 }).tasks.length || comparison(e.store, { operation: 'ingest', run_id: run.id, task_id: 'wrong', jobs: [], collection: {} }), { code: 'comparison_sealed' });
});

test('report separates formal and internship roles and exposes holds, misjudged and excluded roles without scores', t => {
    const e = fixture(t, 1, 2, { tracks: ['campus', 'internship'] });
    const { run } = e.start();
    finish(e, run, { overrideAssessment: job => job.external_id.endsWith('1') ? job.track === 'internship' ? {
        tier: 'misjudged', reason: '标题像交互产品，实际需要独立负责视觉素材批量生产', core_deliverable: 'visual'
    } : { tier: 'qualification_hold', eligibility: 'unknown',
        hard_gates: [{ gate: 'availability', source: 'requirement', status: 'unknown', note: '合成候选人尚未确认每周到岗天数' }]
    } : {} });
    e.invoke({ operation: 'seal', run_id: run.id });
    const result = e.invoke({ operation: 'report', run_id: run.id });
    assert.match(result.markdown, /正式岗位/); assert.match(result.markdown, /实习岗位/);
    assert.match(result.markdown, /城市.*项目/); assert.match(result.markdown, /服务对象/);
    assert.match(result.markdown, /具体证据/); assert.match(result.markdown, /硬门槛/);
    assert.match(result.markdown, /官方链接/); assert.match(result.markdown, /误判岗位/);
    assert.match(result.markdown, /已排除岗位/); assert.match(result.markdown, /到岗天数/);
    assert.doesNotMatch(result.markdown, /\bscore\b|\d+%|匹配分|录用概率/);
    assert.equal(result.report.qualification_hold.length, 1);
    assert.equal(result.report.misjudged.length, 1);
    assert.ok(result.report.decisive_questions.length > 0);
});

test('exhausted quota and stale official rules prevent recommendations while retaining reference roles', t => {
    const e = fixture(t, 2, 1);
    const exhausted = e.fixtures[0], stale = e.fixtures[1];
    setOpportunity(e.store, { company_id: exhausted.company.id, ...exhausted.scopes[0], limit: 0, exhausted: true, source: 'official', source_ref: exhausted.scopes[0].source_url, observed_at: now() });
    const rule = e.store.all('opportunity').find(r => r.company_id === stale.company.id);
    e.store.put('opportunity', rule.id, { ...rule, observed_at: '2020-01-01T00:00:00Z' });
    const { run } = e.start(); finish(e, run);
    const report = e.invoke({ operation: 'seal', run_id: run.id }).snapshot;
    assert.equal(report.recommendations.length, 0);
    assert.equal(report.reference_entries.length, 1);
    assert.equal(report.qualification_hold.length, 1);
    assert.ok(report.warnings.some(w => /规则/.test(w.reason)));
});

test('an official company scope deadline blocks action even when the individual role has no deadline', t => {
    const e = fixture(t, 1, 1), f = e.fixtures[0];
    setOpportunity(e.store, { company_id: f.company.id, ...f.scopes[0], limit: 10, source: 'official', source_ref: f.scopes[0].source_url,
        observed_at: now(), deadline: '2020-01-01T00:00:00Z' });
    const { run } = e.start(); finish(e, run);
    const snapshot = e.invoke({ operation: 'seal', run_id: run.id }).snapshot;
    assert.equal(snapshot.recommendations.length, 0);
    assert.equal(snapshot.reference_entries.length, 1);
    assert.match(snapshot.reference_entries[0].reason, /截止/);
});

test('ranking differences use stable role identity and give a concrete reason in all four categories', () => {
    const role = (external_id, rank) => ({ company: '合成公司', external_id, track: 'campus', campaign: '2027', rank, tier: 'priority', service_object: 'consumer', core_deliverable: 'interaction_design', rank_reason: '交互项目证据支持实际访谈与原型交付' });
    const diff = api.diffRankings([role('new', 1), role('up', 2), role('down', 3), role('same', 4)], [role('down', 1), role('up', 3), role('same', 4)]);
    assert.deepEqual(diff.missed.map(x => x.external_id), ['new']);
    assert.deepEqual(diff.underestimated.map(x => x.external_id), ['up']);
    assert.deepEqual(diff.overestimated.map(x => x.external_id), ['down']);
    assert.deepEqual(diff.same.map(x => x.external_id), ['same']);
    for (const kind of ['missed', 'underestimated', 'overestimated', 'same']) assert.ok(diff[kind].every(x => x.reason.trim().length > 8));
});

test('sealed report checks changed quota again while preserving the independent ranking hash', t => {
    const e = fixture(t, 1, 1);
    const { run } = e.start(); finish(e, run);
    const sealed = e.invoke({ operation: 'seal', run_id: run.id }).snapshot;
    assert.equal(sealed.recommendations.length, 1);
    const f = e.fixtures[0];
    setOpportunity(e.store, { company_id: f.company.id, ...f.scopes[0], limit: 0, exhausted: true, source: 'official', source_ref: f.scopes[0].source_url, observed_at: now() });
    const report = e.invoke({ operation: 'report', run_id: run.id }).report;
    assert.equal(report.recommendations.length, 0);
    assert.equal(report.reference_entries.length, 1);
    assert.equal(report.snapshot_hash, sealed.snapshot_hash);
    assert.equal(e.invoke({ operation: 'seal', run_id: run.id }).snapshot.recommendations.length, 1);
});

test('old numbered batches match the same role despite newly attached company identity', () => {
    const current = [{ job_id: 'stable-job', company_id: 'registered-company', company: '合成公司', external_id: 'role-1', track: 'campus', campaign: '2027', rank: 1, rank_reason: '本次完整正文与合成证据一致' }];
    const old = [{ job_id: 'stable-job', company: '合成公司', external_id: 'role-1', track: 'campus', campaign: '2027', rank: 1 }];
    const diff = api.diffRankings(current, old);
    assert.equal(diff.same.length, 1);
    assert.equal(diff.missed.length, 0);
    assert.equal(diff.overestimated.length, 0);
});

test('tier changes carry evidence reasons even when ordinal rank is unchanged and irrelevant newcomers are not omissions', () => {
    const diff = api.diffRankings([
        { job_id: 'down', rank: 1, tier: 'adjacent', category: 'recommendations', reason: '实际交付是代码，属于相邻方向' },
        { job_id: 'up', rank: 2, tier: 'priority', category: 'recommendations', reason: '完整交互原型证据已核验' },
        { job_id: 'irrelevant', tier: 'excluded', category: 'excluded', reason: '毕业年份明确不符' }
    ], [{ job_id: 'down', rank: 1, tier: 'priority' }, { job_id: 'up', rank: 2, tier: 'adjacent' }]);
    assert.deepEqual(diff.overestimated.map(i => i.job_id), ['down']);
    assert.deepEqual(diff.underestimated.map(i => i.job_id), ['up']);
    assert.equal(diff.missed.length, 0);
});

test('diff strips legacy match scores from previous and current rows including nested fields', () => {
    const diff = api.diffRankings([{ job_id: 'new', rank: 1, score: 99, recommendation: { score: 99, label: '旧分数标签' } }],
        [{ job_id: 'removed', rank: 1, score: 98, recommendation: { score: 98, probability: 0.8 }, nested: [{ match_score: 97 }] }]);
    assert.equal(diff.missed[0].score, undefined);
    assert.equal(diff.missed[0].recommendation.score, undefined);
    assert.equal(diff.overestimated[0].score, undefined);
    assert.equal(diff.overestimated[0].recommendation.probability, undefined);
    assert.equal(diff.overestimated[0].nested[0].match_score, undefined);
});

test('a reference role becoming actionable is an underestimate even at the same rank and tier', () => {
    const diff = api.diffRankings([{ job_id: 'same-role', category: 'recommendations', rank: 1, tier: 'priority', reason: '当前官方剩余机会已核验' }],
        [{ job_id: 'same-role', category: 'reference_entries', rank: 1, tier: 'priority', reason: '先前剩余名额尚未核验' }]);
    assert.equal(diff.underestimated.length, 1);
    assert.equal(diff.same.length, 0);
});

test('an imported run resumes by its stable key after the workspace identity changes', t => {
    const e = fixture(t);
    const { run } = e.start('restored');
    handle(e, run, e.invoke({ operation: 'next', run_id: run.id }).tasks[0]);
    const prior = e.invoke({ operation: 'next', run_id: run.id });
    e.store.workspace = 'synthetic-restored-workspace';
    const restored = e.start('restored');
    assert.equal(restored.run.id, run.id);
    assert.deepEqual(restored.budget, prior.budget);
    assert.equal(e.store.all('comparison_run').length, 1);
});

test('preferred gate failures remain visible without excluding an otherwise qualified role', t => {
    const e = fixture(t, 1, 1);
    const { run } = e.start();
    finish(e, run, { overrideAssessment: () => ({ hard_gates: [{ gate: 'tool', source: 'preferred', status: 'fails', note: '加分工具尚无使用证据' }] }) });
    const snapshot = e.invoke({ operation: 'seal', run_id: run.id }).snapshot;
    assert.equal(snapshot.recommendations.length, 1);
    assert.equal(snapshot.excluded.length, 0);
});

test('a partially assessed batch resumes with only unfinished full JDs and reserved budget', t => {
    const e = fixture(t);
    const { run } = e.start();
    handle(e, run, e.invoke({ operation: 'next', run_id: run.id }).tasks[0]);
    const task = e.invoke({ operation: 'next', run_id: run.id }).tasks[0];
    e.invoke({ operation: 'assess', run_id: run.id, task_id: task.id, assessments: [assessment(e, task.jobs[0])] });
    const resumed = e.invoke({ operation: 'next', run_id: run.id });
    assert.equal(resumed.tasks[0].jobs.length, 1);
    assert.equal(resumed.tasks[0].jobs[0].id, task.jobs[1].id);
    assert.equal(resumed.budget.assessments_used, 1);
    assert.equal(resumed.budget.reserved_assessments, 1);
    handle(e, run, resumed.tasks[0]);
    assert.equal(e.invoke({ operation: 'seal', run_id: run.id }).snapshot.coverage.assessed_count, 2);
});

test('a new comparison checks the current list before reassessing old complete full JDs', t => {
    const e = fixture(t);
    const first = e.start('first'); finish(e, first.run);
    const c = e.store.all('collection')[0];
    e.store.put('collection', c.id, { ...c, live_checked_at: '2020-01-01T00:00:00Z' });
    const second = e.start('second');
    assert.equal(e.invoke({ operation: 'next', run_id: second.run.id }).tasks[0].kind, 'collect');
});

test('a current list does not make a stale full JD current enough to assess or finish', t => {
    const e = fixture(t, 1, 1);
    const first = e.start('first'); finish(e, first.run);
    const job = e.store.all('job')[0];
    e.store.put('job', job.id, { ...job, observed_at: '2020-01-01T00:00:00Z' });
    const second = e.start('second');
    const next = e.invoke({ operation: 'next', run_id: second.run.id });
    assert.equal(next.tasks[0].kind, 'collect');
    assert.deepEqual(next.tasks[0].missing_external_ids, ['campus-0']);
    assert.throws(() => e.invoke({ operation: 'seal', run_id: second.run.id }), { code: 'comparison_incomplete' });
});

test('an existing preparing application is resumed instead of recommended as another new application', t => {
    const e = fixture(t, 1, 1);
    const { run } = e.start(); finish(e, run);
    const job = e.store.all('job')[0];
    e.store.put('application', 'synthetic-preparing', { job_id: job.id, company: job.company, mode: job.mode, stage: 'preparing', job_snapshot: job });
    const snapshot = e.invoke({ operation: 'seal', run_id: run.id }).snapshot;
    assert.equal(snapshot.recommendations.length, 0);
    assert.equal(snapshot.reference_entries.length, 1);
});

test('synthetic script runs the actual tool registry through twenty companies and writes a private pasteable report', () => {
    const script = fileURLToPath(new URL('../../../scripts/compare-synthetic.mjs', import.meta.url));
    const result = spawnSync(process.execPath, ['--no-warnings', script, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.company_count, 20);
    assert.equal(output.paused_after_companies, 5);
    assert.equal(output.daily_budget_records, 0);
    assert.equal(output.application_records, 0);
    assert.match(output.markdown, /对应经历.*不匹配.*官方链接/);
    assert.match(output.markdown, /已核验零结果入口/);
    assert.ok(output.assessed_roles >= 40);
    assert.ok(output.snapshot_hash.length === 64);
    assert.ok(output.synthetic_home.startsWith(path.join(os.tmpdir(), 'jobos-comparison-synthetic-')));
    rmSync(output.synthetic_home, { recursive: true, force: true });
});

test('renderer groups each company before formal and internship tables and makes a quota hold explicit', () => {
    const row = { job_id: 'display', company: '合成展示公司', title: '角色｜A <img>', track: 'campus', campaign: '2027', category: 'qualification_hold', tier: 'priority',
        actual_tasks: ['交付交互原型'], evidence_refs: [], hard_gates: [], eligibility: 'pass', reason: '投递规则未复核', url: 'https://jobs.example.com/role(a)|b' };
    const markdown = api.renderComparisonReport({ items: [row], recommendations: [], qualification_hold: [row] });
    assert.ok(markdown.indexOf('合成展示公司') < markdown.indexOf('正式岗位'));
    assert.match(markdown, /2027/);
    assert.match(markdown, /资格待澄清/);
    assert.doesNotMatch(markdown, /优先准备/);
    assert.match(markdown, /&lt;img&gt;/);
    assert.match(markdown, /role%28a%29%7Cb/);
});

test('synthetic script supports a single company example without requiring the five company pause', () => {
    const script = fileURLToPath(new URL('../../../scripts/compare-synthetic.mjs', import.meta.url));
    const result = spawnSync(process.execPath, ['--no-warnings', script, '--companies', '1', '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.company_count, 1);
    assert.equal(output.paused_after_companies, 0);
    assert.equal(output.assessed_roles, 3);
    assert.match(output.markdown, /批量制作视觉素材/);
    rmSync(output.synthetic_home, { recursive: true, force: true });
});

test('comparison schema rejects implicit scope, excessive company counts and unrelated form operations', () => {
    const schema = schemaApi.comparisonSchema(O({ title: S() }), O({ company: S() }), O({ job_id: S() }));
    validate(schema, { operation: 'start', comparison_key: 'stable-key', company_ids: ['company-a'], limits: { details: 50, assessments: 50, batch_size: 5 } });
    assert.throws(() => validate(schema, { operation: 'start', comparison_key: 'stable-key', companies: ['implicit-name'] }), { code: 'invalid_arguments' });
    assert.throws(() => validate(schema, { operation: 'start', comparison_key: 'stable-key', company_ids: Array(21).fill('a') }), { code: 'invalid_arguments' });
    assert.throws(() => validate(schema, { operation: 'submit', run_id: 'a' }), { code: 'invalid_arguments' });
});
