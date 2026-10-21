/** Offline synthetic exercise. Never opens the candidate's configured store. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../plugins/coming-jobs/src/store.mjs';
import { call } from '../plugins/coming-jobs/src/service.mjs';
import { now } from '../plugins/coming-jobs/src/core.mjs';

const countArgument = process.argv.indexOf('--companies');
const companyCount = countArgument < 0 ? 20 : Number(process.argv[countArgument + 1]);
assert.ok(Number.isSafeInteger(companyCount) && companyCount >= 1 && companyCount <= 20, '--companies 需要 1 至 20 的整数');
const home = mkdtempSync(path.join(os.tmpdir(), 'jobos-comparison-synthetic-'));
chmodSync(home, 0o700);
let store = new Store(home);
const invoke = (name, args) => {
    const result = call(store, `jobos1_${name}`, args);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    return result.data;
};
const compare = args => invoke('comparison', args);

try {
    invoke('remember', { mode: 'user_statement', confirmed: true, user_ref: '离线合成候选人授权，无真实个人信息', facts: [
        { key: 'intent.tracks', value: ['campus', 'internship'], evidence_level: 'self_statement' },
        { key: 'intent.direction', value: '面向个人用户的交互产品设计', evidence_level: 'self_statement' },
        { key: 'intent.locations', value: ['北京', '深圳'], evidence_level: 'self_statement' },
        { key: 'education.summary', value: '合成大学产品设计本科，2027年毕业', evidence_level: 'self_statement' },
        { key: 'experience.summary', value: '合成项目中进行用户访谈，整理问题并交付可测试交互原型', evidence_level: 'self_statement' },
        { key: 'project.anchor', value: '合成交互项目：亲自访谈使用者、梳理需求，制作并验证交互原型', evidence_level: 'self_statement' }
    ] });
    invoke('profile', { operation: 'fit_context', graduation_year: 2027, confirmed: true, user_ref: '离线合成候选人确认毕业年份',
        availability: { earliest_start: '2027-07-01' }, preferred_service_objects: ['consumer'], preferred_deliverables: ['interaction_design', 'product_spec', 'research'] });
    const fixtures = Array.from({ length: companyCount }, (_, index) => {
        const name = `合成公司${String(index + 1).padStart(2, '0')}`;
        const scopes = ['campus', 'internship'].map(track => ({ track, campaign: '2027', source_url: `https://jobs.example.com/synthetic/${index}/${track}` }));
        const company = invoke('daily', { operation: 'company', company: { name, scopes } });
        for (const scope of scopes) invoke('daily', { operation: 'opportunity', company_id: company.id, track: scope.track, campaign: scope.campaign,
            source: 'official', source_ref: scope.source_url, limit: companyCount > 1 && index === 0 && scope.track === 'campus' ? 0 : 2,
            exhausted: companyCount > 1 && index === 0 && scope.track === 'campus', observed_at: index === 1 ? new Date(Date.now() - 8 * 86400000).toISOString() : now() });
        const jobs = companyCount > 1 && index === companyCount - 1 ? [] : scopes.flatMap(scope => Array.from({ length: scope.track === 'campus' ? 2 : 1 }, (_, role) => {
            const misjudged = scope.track === 'campus' && role === 1 && index % 5 === 0;
            const excluded = scope.track === 'internship' && index % 7 === 0;
            const hold = scope.track === 'internship' && !excluded && index % 4 === 0;
            const task = misjudged ? '批量制作视觉素材，维护视觉规范并为运营页面输出多尺寸图像' : '与实际使用者访谈并交付可测试交互原型';
            const gate = excluded ? '必须在2026年11月1日前到岗' : hold ? '必须每周实习至少5天并连续6个月' : null;
            return { company: name, title: role === 0 ? '交互产品设计' : misjudged ? '视觉素材产品设计' : '用户研究产品',
            track: scope.track, campaign: scope.campaign, url: `${scope.source_url}/${role}`, external_id: `${scope.track}-${role}`,
            jd: `岗位职责：${task}，协同团队验证实际交付与迭代方案，使用真实结果说明方案决策。${gate ? `任职要求：${gate}。` : ''}`,
            requirements: [{ id: 'r1', kind: 'responsibility', text: task }, ...(gate ? [{ id: 'r2', kind: 'requirement', text: gate }] : [])],
            ...(excluded ? { availability: { latest_start: '2026-11-01' } } : hold ? { availability: { days_per_week: 5, continuous_months: 6 } } : {}),
            locations: [index % 2 ? '深圳' : '北京'], source: 'official', observed_at: now(), mode: 'demo'
        }; }));
        return { company, scopes, jobs, index };
    });
    const args = { operation: 'start', comparison_key: `synthetic-${companyCount}-v1`, mode: 'demo', company_ids: fixtures.map(f => f.company.id), limits: { details: 100, assessments: 100, batch_size: 2 } };
    const { run } = compare(args);
    let paused = false, pausedAfter = 0;
    for (let turn = 0; turn < 500; turn++) {
        const result = compare({ operation: 'next', run_id: run.id, limit: 1 });
        if (companyCount >= 6 && !paused && result.cursor.completed_companies === 5) {
            const budget = result.budget, tasks = result.tasks.map(t => t.id);
            store.close(); store = new Store(home);
            const retry = compare({ ...args, limits: { details: 9000, assessments: 9000, batch_size: 99 } });
            assert.equal(retry.run.id, run.id);
            const resumed = compare({ operation: 'next', run_id: run.id, limit: 1 });
            assert.deepEqual(resumed.budget, budget);
            assert.deepEqual(resumed.tasks.map(t => t.id), tasks);
            paused = true; pausedAfter = result.cursor.completed_companies;
        }
        if (!result.tasks.length) {
            assert.equal(result.coverage.complete, true, JSON.stringify(result.coverage.blockers));
            break;
        }
        const task = result.tasks[0], fixture = fixtures.find(f => f.company.id === task.company_id);
        if (task.kind === 'collect') {
            const all = fixture.jobs.filter(j => j.track === task.scope.track), external_ids = all.map(j => j.external_id);
            const entry = { ...task.scope, external_ids, complete: true, total: external_ids.length, observed_at: now() };
            compare({ operation: 'ingest', run_id: run.id, task_id: task.id,
                jobs: all.filter(j => !task.known_external_ids.includes(j.external_id)).slice(0, task.detail_limit), cursor: 'page:1',
                collection: { company: fixture.company.name, ...task.scope, total: all.length, external_ids, pages_read: 1, has_more: false, complete: true,
                    observed_at: now(), live_checked_at: now(), entries: [entry], live_entries: [entry] } });
            compare({ operation: 'observe', run_id: run.id, task_id: task.id, state: 'done' });
        } else {
            const fact = store.all('fact').find(f => f.key === 'project.anchor');
            compare({ operation: 'assess', run_id: run.id, task_id: task.id, assessments: task.jobs.map(job => {
                const misjudged = fixture.index % 5 === 0 && job.external_id === 'campus-1';
                const excluded = fixture.index % 7 === 0 && job.track === 'internship';
                const hold = !excluded && fixture.index % 4 === 0 && job.track === 'internship';
                return { job_id: job.id, job_hash: job.content_hash,
                    mappings: job.requirements.map(r => r.id === 'r2' ? { requirement_id: r.id, relation: excluded ? 'gap' : 'unknown', evidence_ids: [], reason: excluded ? '已确认最早到岗日在岗位最晚到岗日之后' : '尚未确认每周实习天数和连续时长' } :
                        misjudged ? { requirement_id: r.id, relation: 'gap', evidence_ids: [], reason: '交互访谈经历不能证明独立视觉素材交付能力' } :
                            { requirement_id: r.id, relation: 'direct', evidence_ids: [fact.id], reason: '合成候选人已确认自己访谈用户并验证交互原型' }),
                    eligibility: excluded ? 'fail' : hold ? 'unknown' : 'pass',
                    service_object: 'consumer', core_deliverable: misjudged ? 'visual' : job.external_id === 'campus-1' ? 'research' : 'interaction_design',
                    tier: excluded ? 'excluded' : hold ? 'qualification_hold' : misjudged ? 'misjudged' : job.external_id === 'campus-1' ? 'conditional' : 'priority',
                    hard_gates: excluded ? [{ gate: 'availability', source: 'requirement', status: 'fails', note: '候选人最早2027年7月到岗，晚于岗位要求的2026年11月', requirement_id: 'r2' }] :
                        hold ? [{ gate: 'availability', source: 'requirement', status: 'unknown', note: '需要确认合成候选人每周能到岗几天、可连续实习多久', requirement_id: 'r2' }] : [],
                    gates_complete: true, evidence_refs: [{ evidence_id: fact.id, level: 'self_statement', note: '合成候选人的确认陈述，尚无原始成果文件' }],
                    advantages: misjudged ? [] : ['访谈与原型的实际交付相符'], gaps: misjudged ? ['没有独立大量视觉素材制作的证据'] : ['尚无第三方或原始材料佐证项目结果'],
                    reason: excluded ? '已确认到岗条件不满足本岗位硬性安排' : hold ? '交互经历相关，但到岗硬门槛尚未确认' : misjudged ? '标题带产品设计，实际核心交付是视觉素材，不能仅凭工具熟悉就优先推荐' : '实际任务是访谈与交互方案验证，与合成候选人亲自完成的项目任务对应'
                };
            }) });
        }
    }
    if (companyCount >= 6) assert.equal(paused, true);
    const snapshot = compare({ operation: 'seal', run_id: run.id }).snapshot;
    // An explicit synthetic counterfactual batch, installed only after sealing.
    // Its order exercises explanations; it is not a historical candidate report.
    const older = snapshot.recommendations.slice(0, 3).map((item, i) => ({ ...item, rank: 3 - i,
        reason: '合成旧版仅依据概要排序，供差异类别测试' }));
    store.put('batch', 'synthetic-counterfactual', { mode: 'demo', items: older, sealed_at: now(), source: 'synthetic_counterfactual' });
    compare({ operation: 'previous', run_id: run.id, previous_batch_id: 'synthetic-counterfactual' });
    const result = compare({ operation: 'report', run_id: run.id });
    const markdown = '以下全部为离线合成公司、岗位与候选人；没有读取真实候选人、访问官网或创建投递。旧版为明确标记的合成反例。\n\n' + result.markdown;
    const reportPath = path.join(home, 'comparison-report.md');
    writeFileSync(reportPath, markdown + '\n', { mode: 0o600 });
    const output = { evidence: 'offline_synthetic_registry_replay', synthetic_home: home, report_path: reportPath, run_id: run.id,
        snapshot_hash: snapshot.snapshot_hash, company_count: snapshot.coverage.company_count, assessed_roles: snapshot.coverage.assessed_count,
        paused_after_companies: pausedAfter, budget: result.budget, daily_budget_records: store.all('daily_budget').length,
        application_records: store.all('application').length, markdown };
    assert.equal(output.company_count, companyCount); assert.equal(snapshot.coverage.complete, true);
    assert.equal(output.application_records, 0); assert.equal(output.daily_budget_records, 0);
    if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(output) + '\n');
    else process.stdout.write(markdown + `\n\n合成报告已保存在：${reportPath}\n`);
} finally { store.close(); }
