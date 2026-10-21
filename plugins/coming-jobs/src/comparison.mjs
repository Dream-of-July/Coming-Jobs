import { assert, hash, now, noSecrets, publicUrl } from './core.mjs';
import { facts, profileDigest } from './profile.mjs';
import { saveJobs, assessJobs, collectionStatus, requirements } from './jobs.mjs';
import { companyMatches, scopeKey, opportunity, previouslyApplied } from './opportunities.mjs';
import { compareFitAssessments, isRecommendable } from './fit-assessment.mjs';

export const COMPARISON_DEFAULTS = Object.freeze({ details: 200, assessments: 200, batch_size: 10 });
const localDate = (time, timezone) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
const fresh = (time, days = 7) => !!time && Number.isFinite(Date.parse(time)) && Date.parse(time) <= Date.now() + 300000 && Date.now() - Date.parse(time) <= days * 86400000;
const sameScope = (a, b) => a.track === b.track && (a.campaign ?? '') === (b.campaign ?? '');
const sourceId = (run, company, scope) => hash([run.id, company.company_id, scopeKey(scope)]);
const evaluationId = (run, job) => hash([run.id, job.id]);
const runTasks = (store, run) => store.all('comparison_task').filter(t => t.run_id === run.id);
const getBudget = (store, run) => store.get('comparison_budget', run.id);
const trackName = track => track === 'internship' ? '实习' : track === 'experienced' ? '社招' : '校招';

function cursorValue(value) {
    if (value !== undefined) {
        assert(typeof value === 'string' && !/https?:\/\/|(?:token|session|cookie|secret|auth|password)\s*[:=]/i.test(value), 'comparison_private_cursor', '分页游标只能保存不含 URL 或认证信息的公开位置。');
        noSecrets(value);
    }
    return value;
}
function currentRun(store, runId, mutable = true) {
    const run = store.get('comparison_run', runId);
    assert(!mutable || run.state !== 'sealed', 'comparison_sealed', '这份独立排序已封存；读取 report 或 previous，不改写封存证据。');
    return run;
}
function publicBudget(store, run) {
    const b = getBudget(store, run);
    return { limits: run.limits, details_used: b.detail_versions.length, assessments_used: b.assessment_versions.length,
        reserved_details: b.reserved_details, reserved_assessments: b.reserved_assessments,
        details_remaining: Math.max(0, run.limits.details - b.detail_versions.length - b.reserved_details),
        assessments_remaining: Math.max(0, run.limits.assessments - b.assessment_versions.length - b.reserved_assessments) };
}
function sourceState(store, run, company, scope) {
    return store.get('comparison_scope', sourceId(run, company, scope), false);
}
function validAssessment(store, run, job) {
    const entry = store.get('comparison_evaluation', evaluationId(run, job), false);
    const a = entry?.assessment;
    return entry?.job_hash === job.content_hash && entry.profile_hash === profileDigest(store) &&
        a?.service_object && a.core_deliverable && a.tier && Array.isArray(a.hard_gates) && Array.isArray(a.evidence_refs) ? a : null;
}
function scopeView(store, run, company, scope) {
    const collection = store.all('collection').filter(c => companyMatches({ ...company, id: company.company_id }, c.company) && sameScope(c, scope) && c.mode === run.mode)
        .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at) || b.revision - a.revision)[0];
    const ids = collection?.external_ids ?? [];
    const jobs = store.all('job').filter(j => companyMatches({ ...company, id: company.company_id }, j.company) && sameScope(j, scope) && j.mode === run.mode && ids.includes(j.external_id));
    const check = collectionStatus(store, collection);
    const liveEntries = collection?.live_entries?.filter(e => sameScope(e, scope)) ?? [];
    const checkedAt = collection?.live_checked_at ?? (liveEntries.length && liveEntries.every(e => e.complete) ? liveEntries.map(e => e.observed_at).sort()[0] : null);
    const today = fresh(checkedAt) && localDate(checkedAt, run.timezone) === localDate(now(), run.timezone) &&
        (!collection?.live_entries || liveEntries.length > 0 && liveEntries.every(e => e.complete && fresh(e.observed_at) && localDate(e.observed_at, run.timezone) === localDate(now(), run.timezone)));
    const currentDetail = job => job.jd?.trim().length >= 40 && job.source === 'official' && fresh(job.observed_at);
    const missing = ids.filter(externalId => !jobs.some(j => j.external_id === externalId && currentDetail(j)));
    const pending = jobs.filter(j => currentDetail(j) && !validAssessment(store, run, j));
    const state = sourceState(store, run, company, scope);
    const active = runTasks(store, run).some(t => t.company_id === company.company_id && sameScope(t.scope, scope) && t.state === 'pending');
    const complete = !!collection && check.complete && check.live_verified && today && !missing.length && !pending.length && !active && state?.state !== 'blocked';
    return { company, scope, collection, jobs, check, checked_at: checkedAt, checked_today: !!today, missing, pending, state, active, complete };
}
function coverage(store, run) {
    const views = run.companies.flatMap(company => company.scopes.map(scope => scopeView(store, run, company, scope)));
    const blockers = [];
    for (const v of views) {
        const base = { company_id: v.company.company_id, company: v.company.name, track: v.scope.track, campaign: v.scope.campaign };
        if (v.state?.state === 'blocked') blockers.push({ ...base, code: 'source_blocked', reason: v.state.reason || '公开来源当前无法继续读取', cursor: v.state.cursor ?? null });
        if (!v.collection) blockers.push({ ...base, code: 'catalogue_missing', reason: '尚未保存该明确范围的官网目录和入口。' });
        else {
            if (!v.check.complete || v.missing.length) blockers.push({ ...base, code: 'collection_incomplete', reason: '官网分页、岗位 ID 或七天内核验的完整正文尚未齐全。',
                listed_count: v.collection.external_ids.length, expected_count: v.collection.total, has_more: v.collection.has_more,
                missing_external_ids: [...new Set([...v.missing, ...(v.check.missing_external_ids ?? [])])] });
            if (!v.checked_today || !v.check.live_verified) blockers.push({ ...base, code: 'live_catalogue_not_checked_today', reason: '尚未用今天的官网在招目录核对完整岗位 ID；旧快照不能声明当前全量。' });
        }
        if (v.pending.length) blockers.push({ ...base, code: 'assessment_missing', reason: '已读完整正文仍有岗位未完成本次独立逐项评估。', pending_job_ids: v.pending.map(j => j.id) });
        if (v.active) blockers.push({ ...base, code: 'task_in_progress', reason: '当前范围仍有未结束的采集或评估任务。' });
    }
    const completed = run.companies.filter(company => views.filter(v => v.company.company_id === company.company_id).every(v => v.complete));
    return { complete: views.every(v => v.complete), company_count: run.companies.length, completed_companies: completed.length,
        listed_count: views.reduce((n, v) => n + (v.collection?.external_ids.length ?? 0), 0),
        detail_count: views.reduce((n, v) => n + v.jobs.filter(j => fresh(j.observed_at)).length, 0),
        assessed_count: views.reduce((n, v) => n + v.jobs.filter(j => fresh(j.observed_at) && validAssessment(store, run, j)).length, 0),
        scopes: views.map(v => ({ company_id: v.company.company_id, company: v.company.name, ...v.scope, complete: v.complete,
            source_url: v.collection?.source_url ?? v.scope.source_url, listed_count: v.collection?.external_ids.length ?? 0,
            total: v.collection?.total ?? null, checked_at: v.checked_at, checked_today: v.checked_today, missing_external_ids: v.missing,
            pending_job_ids: v.pending.map(j => j.id), cursor: v.state?.cursor ?? null })), blockers };
}
function cursor(store, run, status = coverage(store, run)) {
    const incomplete = run.companies.findIndex(company => status.scopes.some(s => s.company_id === company.company_id && !s.complete));
    return { completed_companies: status.completed_companies, total_companies: run.companies.length,
        company_index: incomplete < 0 ? run.companies.length : incomplete,
        company_id: incomplete < 0 ? null : run.companies[incomplete].company_id,
        assessed_roles: status.assessed_count, listed_roles: status.listed_count };
}
function presentedTask(store, run, task) {
    const company = run.companies.find(c => c.company_id === task.company_id);
    const remaining = task.kind === 'assess' ? task.job_ids.filter(jobId => !task.completed_job_ids.includes(jobId)) : [];
    const view = task.kind === 'collect' ? scopeView(store, run, company, task.scope) : null;
    return { ...task, company: company.name,
        ...(task.kind === 'assess' ? { job_ids: remaining, job_hashes: remaining.map(jobId => task.job_hashes[task.job_ids.indexOf(jobId)]), jobs: remaining.map(jobId => store.get('job', jobId)) } :
            { known_external_ids: view.jobs.map(job => job.external_id), missing_external_ids: view.missing,
                live_check_required: !view.checked_today || !view.check.live_verified }),
        next: task.kind === 'collect' ? '核对今天官网完整目录与每个在招岗位 ID；在预算内分批保存完整 JD，零结果也保存所查官方入口。' :
            '只看本批完整 JD 和已确认候选证据；逐项说明实际任务、服务对象、交付物、硬门槛和分层，不读取旧排名。' };
}
function reserve(store, run, company, scope, kind, values) {
    const ordinal = runTasks(store, run).filter(t => t.company_id === company.company_id && sameScope(t.scope, scope) && t.kind === kind).length;
    const key = hash([run.id, company.company_id, scopeKey(scope), kind, ordinal]);
    const b = getBudget(store, run);
    store.put('comparison_budget', run.id, { ...b,
        reserved_details: b.reserved_details + (kind === 'collect' ? values.detail_limit : 0),
        reserved_assessments: b.reserved_assessments + (kind === 'assess' ? values.job_ids.length : 0) });
    return store.put('comparison_task', key, { run_id: run.id, company_id: company.company_id, scope, kind,
        ...values, state: 'pending', created_at: now(), cursor: sourceState(store, run, company, scope)?.cursor ?? null });
}
function next(store, runId, limit = 1) {
    const run = currentRun(store, runId, false);
    if (run.state === 'sealed') return { tasks: [], cursor: cursor(store, run), budget: publicBudget(store, run), coverage: coverage(store, run), next: 'report 读取已封存结果。' };
    const pending = runTasks(store, run).filter(t => t.state === 'pending').sort((a, b) =>
        run.companies.findIndex(c => c.company_id === a.company_id) - run.companies.findIndex(c => c.company_id === b.company_id) ||
        run.companies.find(c => c.company_id === a.company_id).scopes.findIndex(s => sameScope(s, a.scope)) - run.companies.find(c => c.company_id === b.company_id).scopes.findIndex(s => sameScope(s, b.scope)) ||
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const tasks = pending.slice(0, limit);
    const occupied = new Set(pending.map(t => `${t.company_id}:${scopeKey(t.scope)}`));
    for (const company of run.companies) {
        for (const scope of company.scopes) {
            if (tasks.length >= limit) break;
            const key = `${company.company_id}:${scopeKey(scope)}`;
            if (occupied.has(key)) continue;
            const view = scopeView(store, run, company, scope);
            if (view.complete || view.state?.state === 'blocked') continue;
            const b = publicBudget(store, run);
            if (!view.collection || !view.checked_today || !view.check.live_verified) {
                if (b.details_remaining === 0 && view.state?.state === 'partial') continue;
                tasks.push(reserve(store, run, company, scope, 'collect', { detail_limit: Math.min(run.limits.batch_size, b.details_remaining), ingested_count: 0 }));
            } else if (view.pending.length && b.assessments_remaining > 0) {
                const jobs = view.pending.slice(0, Math.min(run.limits.batch_size, b.assessments_remaining));
                tasks.push(reserve(store, run, company, scope, 'assess', { job_ids: jobs.map(j => j.id), job_hashes: jobs.map(j => j.content_hash), completed_job_ids: [] }));
            } else if (!view.collection || !view.check.complete || !view.checked_today || view.missing.length) {
                if (b.details_remaining === 0 && view.state?.state === 'partial') continue;
                if (b.details_remaining === 0 && view.collection && view.checked_today) continue;
                tasks.push(reserve(store, run, company, scope, 'collect', { detail_limit: Math.min(run.limits.batch_size, b.details_remaining), ingested_count: 0 }));
            }
            occupied.add(key);
        }
    }
    const status = coverage(store, run);
    return { tasks: tasks.map(t => presentedTask(store, run, t)), budget: publicBudget(store, run), coverage: status, cursor: cursor(store, run, status),
        next: status.complete ? 'seal 封存独立排序后，才可 previous 读取旧版排名。' : tasks.length ? '按任务分批继续；暂停后使用同一 run_id，累计预算不重置。' : '已保存具体缺口；可 report 查看阶段结果。预算或公开来源未恢复前不能宣称完整比较。' };
}
function taskContext(store, a, kind) {
    const run = currentRun(store, a.run_id), task = store.get('comparison_task', a.task_id);
    assert(task.run_id === run.id && (!kind || task.kind === kind) && task.state === 'pending', 'comparison_task_mismatch', '任务不属于本次比较、类型不符或已经结束；读取 next 续跑。');
    const company = run.companies.find(c => c.company_id === task.company_id);
    return { run, task, company };
}
const receiptKey = a => hash(a);
function receipt(store, a, result) {
    return store.put('comparison_receipt', receiptKey(a), { run_id: a.run_id, task_id: a.task_id, operation: a.operation, result }).result;
}
function ingest(store, a) {
    cursorValue(a.cursor);
    const { run, task, company } = taskContext(store, a, 'collect');
    assert(companyMatches({ ...company, id: company.company_id }, a.collection.company) && sameScope(a.collection, task.scope) &&
        a.jobs.every(j => companyMatches({ ...company, id: company.company_id }, j.company) && sameScope(j, task.scope) && j.mode === run.mode && j.external_id && j.source === 'official'),
    'comparison_scope_mismatch', '只可保存当前任务中明确公司、批次、类型和 mode 的官网岗位，且每岗必须有官网编号。');
    const b = getBudget(store, run);
    const jobs = a.jobs.map(j => ({ ...j, company: company.name }));
    const versions = [...new Set(jobs.map(j => {
        const { observed_at, ...content } = j;
        return hash([content, j.requirements?.length ? j.requirements : requirements(j.jd)]);
    }))];
    const added = versions.filter(v => !b.detail_versions.includes(v));
    assert(added.length <= task.detail_limit, 'comparison_detail_budget', '本批新正文超过已保留的详细阅读额度；保留游标分批继续。');
    const result = saveJobs(store, { jobs, collection: { ...a.collection, company: company.name }, mode: run.mode,
        coverage: a.collection.complete ? 'explicit_scope_complete' : 'partial' });
    store.put('comparison_budget', run.id, { ...b, detail_versions: [...b.detail_versions, ...added], reserved_details: b.reserved_details - added.length });
    store.put('comparison_task', task.id, { ...task, detail_limit: task.detail_limit - added.length, ingested_count: task.ingested_count + added.length, cursor: a.cursor ?? task.cursor });
    store.put('comparison_scope', sourceId(run, company, task.scope), { run_id: run.id, company_id: company.company_id, scope: task.scope,
        state: 'collecting', cursor: a.cursor ?? task.cursor, updated_at: now() });
    return receipt(store, a, { ...result, budget: publicBudget(store, run), cursor: a.cursor ?? task.cursor });
}
function assess(store, a) {
    const { run, task } = taskContext(store, a, 'assess');
    const ids = a.assessments.map(x => x.job_id);
    assert(ids.length > 0 && new Set(ids).size === ids.length && ids.every(jobId => task.job_ids.includes(jobId) && !task.completed_job_ids.includes(jobId)), 'comparison_assessment_scope', '仅提交当前批次尚未完成的岗位，每岗一次。');
    for (const assessment of a.assessments) assert(assessment.job_hash === task.job_hashes[task.job_ids.indexOf(assessment.job_id)], 'jd_changed', '本批 JD 已变化，先读回当前正文。');
    const result = assessJobs(store, a), b = getBudget(store, run);
    const versions = result.assessments.map(a => hash([a.job_id, a.job_hash, a.profile_hash]));
    const added = versions.filter(v => !b.assessment_versions.includes(v));
    assert(b.assessment_versions.length + added.length <= run.limits.assessments, 'comparison_assessment_budget', '累计评估预算已用完，保留当前批次进度。');
    for (const a of result.assessments) {
        const { score, ...withoutScore } = a;
        store.put('comparison_evaluation', evaluationId(run, { id: a.job_id }), { run_id: run.id, job_id: a.job_id,
            job_hash: a.job_hash, profile_hash: a.profile_hash, assessment: withoutScore, evaluated_at: now() });
    }
    store.put('comparison_budget', run.id, { ...b, assessment_versions: [...b.assessment_versions, ...added], reserved_assessments: b.reserved_assessments - ids.length });
    const completed = [...task.completed_job_ids, ...ids];
    store.put('comparison_task', task.id, { ...task, completed_job_ids: completed, state: completed.length === task.job_ids.length ? 'done' : 'pending' });
    return receipt(store, a, { assessments: result.assessments.map(({ score, ...assessment }) => assessment), budget: publicBudget(store, run) });
}
function observe(store, a) {
    cursorValue(a.cursor); noSecrets(a.reason);
    const run = currentRun(store, a.run_id), oldTask = store.get('comparison_task', a.task_id);
    assert(oldTask.run_id === run.id && oldTask.kind === 'collect', 'comparison_task_mismatch', 'observe 只更新本次采集任务；评估任务使用 assess。');
    const company = run.companies.find(c => c.company_id === oldTask.company_id);
    if (a.state === 'collect') {
        assert(['partial', 'blocked'].includes(oldTask.state), 'comparison_task_mismatch', '只有已暂停或阻塞的采集范围可恢复。');
        store.put('comparison_scope', sourceId(run, company, oldTask.scope), { run_id: run.id, company_id: company.company_id, scope: oldTask.scope,
            state: 'pending', cursor: a.cursor ?? oldTask.cursor, reason: a.reason ?? null, updated_at: now() });
        return receipt(store, a, { resumed: true, budget: publicBudget(store, run) });
    }
    const { task } = taskContext(store, a, 'collect');
    if (a.state === 'done') {
        const view = scopeView(store, run, company, task.scope);
        assert(view.check.complete && view.check.live_verified && view.checked_today && !view.missing.length, 'comparison_scope_incomplete', '当前目录、官网编号、完整正文或今天的在招核验仍有缺口，不能结束采集。');
    }
    if (a.state === 'blocked') assert(a.reason?.trim(), 'comparison_block_reason_required', '阻塞时必须保留可行动的具体原因。');
    const b = getBudget(store, run);
    store.put('comparison_budget', run.id, { ...b, reserved_details: b.reserved_details - task.detail_limit });
    store.put('comparison_task', task.id, { ...task, state: a.state, detail_limit: 0, cursor: a.cursor ?? task.cursor, reason: a.reason ?? null, finished_at: now() });
    store.put('comparison_scope', sourceId(run, company, task.scope), { run_id: run.id, company_id: company.company_id, scope: task.scope,
        state: a.state === 'done' ? 'verified' : a.state, cursor: a.cursor ?? task.cursor, reason: a.reason ?? null, updated_at: now() });
    return receipt(store, a, { state: a.state, coverage: coverage(store, run), budget: publicBudget(store, run) });
}

export function assessmentDisposition(store, run, company, scope, job, a) {
    const o = opportunity(store, { ...company, id: company.company_id ?? company.id }, scope, run.mode);
    const warnings = [];
    if (!fresh(o.rule_observed_at)) warnings.push('投递规则未复核：核验超过七天或尚无当前官网证据。');
    let category = 'recommendations', reason = a.reason;
    if (a.tier === 'misjudged') { category = 'misjudged'; reason = `岗位名称容易误读；${a.reason}`; }
    else if (a.tier === 'excluded' || a.eligibility === 'fail' || a.hard_gates.some(g => g.source !== 'preferred' && g.status === 'fails')) { category = 'excluded'; reason = `硬门槛或实际任务不符：${a.reason}`; }
    else if (job.source !== 'official' || job.state !== 'open' || job.deadline && Date.parse(job.deadline) <= Date.now()) { category = 'reference_entries'; reason = '当前岗位不是已核验的官网开放职位，仅作研究参考。'; }
    else if (previouslyApplied(store, job)) { category = 'reference_entries'; reason = '该岗位或同一父岗位方向已有已投记录，继续跟进原申请。'; }
    else if (store.all('application').some(app => (app.mode ?? 'live') === run.mode && app.stage === 'preparing' &&
        (app.job_id === job.id || companyMatches({ ...company, id: company.company_id }, app.company) &&
            sameScope({ ...(app.job_snapshot ?? {}), ...(store.get('application_scope', app.id, false) ?? {}) }, job) &&
            (app.job_snapshot?.parent_application_id ?? app.job_snapshot?.external_id) === (job.parent_application_id ?? job.external_id)))) {
        category = 'reference_entries'; reason = '该岗位或同一父岗位已有准备中的申请，恢复原准备记录；此记录不计为已投，也不消耗名额。';
    }
    else if (o.state === 'exhausted') { category = 'reference_entries'; reason = '该公司本招聘范围的投递机会已用完，仅作岗位参考。'; }
    else if (o.state === 'closed') { category = 'reference_entries'; reason = '当前官方招聘范围已截止，仅保留岗位研究与原申请跟进参考。'; }
    else if (!isRecommendable(a) || o.state === 'needs_verification' || o.remaining === null || !fresh(o.rule_observed_at)) {
        category = 'qualification_hold'; reason = !isRecommendable(a) ? `资格尚未核验：${a.reason}` : '当前剩余投递机会或官方规则尚待核验，先保留岗位证据。';
    }
    return { category, reason, opportunity: o, warnings };
}
function buildSnapshot(store, run) {
    const status = coverage(store, run), items = [], evidence = new Map(facts(store, 'matching').map(f => [f.id, f]));
    for (const company of run.companies) for (const scope of company.scopes) {
        const view = scopeView(store, run, company, scope);
        for (const job of view.jobs) {
            const a = validAssessment(store, run, job);
            if (!a) continue;
            const decision = assessmentDisposition(store, run, company, scope, job, a);
            if (!view.complete) {
                decision.warnings.push('本范围的目录、完整正文或独立评估尚未全部完成，保留具体覆盖缺口。');
                if (decision.category === 'recommendations') {
                    decision.category = 'qualification_hold'; decision.reason = '本范围的当前目录、完整正文或独立评估尚未全部完成；已评估子集仍不能作为全量比较后的行动建议。';
                }
            }
            const refs = a.evidence_refs.map(ref => ({ ...ref, text: evidence.has(ref.evidence_id) ? String(evidence.get(ref.evidence_id).value) : ref.note ?? '待核验来源' }));
            items.push({ job_id: job.id, job_hash: job.content_hash, company_id: company.company_id, company: company.name,
                external_id: job.external_id, title: job.title, track: job.track, campaign: job.campaign ?? '', locations: job.locations ?? [],
                project: job.project ?? job.department ?? null, service_object: a.service_object, core_deliverable: a.core_deliverable,
                actual_tasks: job.requirements.filter(r => r.kind === 'responsibility').map(r => r.text).concat(!job.requirements.some(r => r.kind === 'responsibility') ? job.requirements.map(r => r.text) : []),
                evidence_refs: refs, mappings: a.mappings, advantages: a.advantages, gaps: a.gaps, hard_gates: a.hard_gates,
                eligibility: a.eligibility, tier: a.tier, gates_complete: a.gates_complete ?? false, assessment_rank: a.rank ?? null, rank_reason: a.reason,
                ...decision, url: publicUrl(job.url), observed_at: job.observed_at, evaluated_at: a.evaluated_at ?? null });
        }
    }
    items.sort((a, b) => compareFitAssessments({ ...a, rank: a.assessment_rank }, { ...b, rank: b.assessment_rank }) || a.job_id.localeCompare(b.job_id));
    let rank = 0;
    for (const item of items) item.rank = item.category === 'recommendations' ? ++rank : null;
    const result = { run_id: run.id, comparison_key: run.comparison_key, mode: run.mode, timezone: run.timezone,
        companies: run.companies, profile_hash: profileDigest(store), coverage: status, budget: publicBudget(store, run), items,
        recommendations: items.filter(i => i.category === 'recommendations'), qualification_hold: items.filter(i => i.category === 'qualification_hold'),
        reference_entries: items.filter(i => i.category === 'reference_entries'), misjudged: items.filter(i => i.category === 'misjudged'), excluded: items.filter(i => i.category === 'excluded'),
        decisive_questions: items.flatMap(i => i.hard_gates.filter(g => ['unknown', 'conflict'].includes(g.status) && g.source !== 'preferred').map(g => ({ company: i.company, job_id: i.job_id, title: i.title, gate: g.gate, question: g.note }))),
        warnings: items.flatMap(i => i.warnings.map(reason => ({ company_id: i.company_id, job_id: i.job_id, reason }))) };
    return result;
}
function seal(store, a) {
    const run = currentRun(store, a.run_id, false);
    if (run.snapshot_id) return { snapshot: store.get('comparison_snapshot', run.snapshot_id) };
    const result = buildSnapshot(store, run);
    assert(result.coverage.complete || a.allow_partial === true && a.reason?.trim(), 'comparison_incomplete', '当前范围仍未核齐；补齐具体缺口，或明确 allow_partial 和原因以封存阶段结果。', '读取 next 或 report 的缺口清单，保留同一 run_id 继续。', { blockers: result.coverage.blockers });
    const payload = { ...result, status: result.coverage.complete ? 'complete' : 'partial', partial_reason: a.reason ?? null,
        sealed_at: now(), independence: '先按本次完整 JD、已确认候选证据与当前硬门槛独立形成排序；封存后才允许读取旧排名。' };
    const snapshot = store.put('comparison_snapshot', hash([run.id, 'independent']), { ...payload, snapshot_hash: hash(payload) });
    store.put('comparison_run', run.id, { ...run, state: 'sealed', snapshot_id: snapshot.id, sealed_at: snapshot.sealed_at, snapshot_hash: snapshot.snapshot_hash });
    return { snapshot };
}

const rowsOf = value => Array.isArray(value) ? value : value?.items ?? value?.rankings ?? value?.rows ?? value?.cards?.flatMap(c => c.items.map(i => ({ company: c.company, ...i }))) ?? [];
function withoutScoring(value) {
    if (Array.isArray(value)) return value.map(withoutScoring);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !/score|scoring|probabilit|evidence_coverage|match_percent/i.test(key)).map(([key, entry]) => [key, withoutScoring(entry)]));
    return value;
}
function identity(item) {
    if (item.job_id) return item.job_id;
    const company = String(item.company_id ?? item.company ?? '').normalize('NFKC').trim().toLowerCase();
    return item.external_id ? hash([company, item.external_id, item.track ?? '', item.campaign ?? '']) : item.job_id ?? item.id;
}
/** Pure comparison, deliberately separate from acquiring either snapshot. */
export function diffRankings(current, previous) {
    const old = new Map(rowsOf(previous).map((item, i) => [identity(item), { ...withoutScoring(item), rank: item.rank ?? i + 1 }]));
    const result = { missed: [], overestimated: [], underestimated: [], same: [], explanations: {
        missed: '本次独立范围存在而旧版未列出的岗位。', overestimated: '旧版位置更高，或本次证据要求降低行动优先级的岗位。',
        underestimated: '本次有具体任务与候选证据支持提高位置的岗位。', same: '两版排序与当前分层没有实质变化的岗位。' } };
    const seen = new Set();
    const tiers = ['priority', 'conditional', 'adjacent', 'qualification_hold', 'misjudged', 'excluded'];
    for (const [index, item] of rowsOf(current).map(withoutScoring).entries()) {
        const key = identity(item), prior = old.get(key), rank = item.rank ?? index + 1;
        seen.add(key);
        if (!prior && (item.category && item.category !== 'recommendations' || item.tier && !['priority', 'conditional', 'adjacent'].includes(item.tier))) continue;
        const basis = item.rank_reason || item.reason || `本次核验的服务对象为${item.service_object ?? '待核验'}，核心交付为${item.core_deliverable ?? '待核验'}。`;
        const tierDelta = item.tier && prior?.tier && tiers.includes(item.tier) && tiers.includes(prior.tier) ? tiers.indexOf(item.tier) - tiers.indexOf(prior.tier) : 0;
        let kind = 'same', reason = `本次和旧版位置相同；${basis}`;
        if (!prior) { kind = 'missed'; reason = `旧版未列出此岗位；本次读到实际任务并独立评估：${basis}`; }
        else if ((item.category && item.category !== 'recommendations' && (!prior.category || prior.category === 'recommendations')) || tierDelta > 0 || !tierDelta && rank > prior.rank) {
            kind = 'overestimated'; reason = `旧版位置${prior.rank}，本次${item.category && item.category !== 'recommendations' ? '暂不列为行动建议' : `位置${rank}`}；${item.reason || basis}`;
        } else if (prior.category && prior.category !== 'recommendations' && (!item.category || item.category === 'recommendations') || tierDelta < 0 || rank < prior.rank) {
            kind = 'underestimated'; reason = `旧版位置${prior.rank}，本次位置${rank}；具体任务、硬门槛与当前机会证据支持提高行动优先级：${basis}`;
        }
        result[kind].push({ ...item, previous_rank: prior?.rank ?? null, current_rank: item.rank ?? null, reason });
    }
    for (const [key, prior] of old) if (!seen.has(key)) result.overestimated.push({ ...prior, previous_rank: prior.rank, current_rank: null,
        reason: '本次封存的明确范围没有该岗位的当前有效评估；旧排序不能直接延续为当前行动建议，须检查范围、在招状态与硬门槛。' });
    return result;
}
function previous(store, a) {
    const run = currentRun(store, a.run_id, false);
    assert(run.state === 'sealed' && run.snapshot_id, 'comparison_unsealed', '必须先封存本次独立排序，才可读取任何旧排名。');
    assert(Number(!!a.previous_run_id) + Number(!!a.previous_batch_id) === 1, 'comparison_previous_required', '明确指定一份旧比较 run 或不可变编号 batch，二者择一。');
    const snapshot = store.get('comparison_snapshot', run.snapshot_id);
    let old;
    if (a.previous_run_id) {
        assert(a.previous_run_id !== run.id, 'comparison_previous_self', '旧版不能是本次独立排序。');
        const priorRun = store.get('comparison_run', a.previous_run_id);
        assert(priorRun.state === 'sealed' && priorRun.snapshot_id, 'comparison_previous_unsealed', '旧比较也必须已经封存。');
        old = store.get('comparison_snapshot', priorRun.snapshot_id);
    } else {
        old = store.get('batch', a.previous_batch_id);
        assert(old.revision === 1 || old.sealed_at || old.snapshot_hash, 'comparison_previous_unsealed', '旧编号批次已被改写，先提供可验证的不可变版本。');
    }
    assert((old.mode ?? 'live') === run.mode, 'comparison_mode_mismatch', '演练与真实排序不能混合比较。');
    const result = { run_id: run.id, independent_snapshot_hash: snapshot.snapshot_hash, independent_sealed_at: snapshot.sealed_at,
        previous_run_id: a.previous_run_id ?? null, previous_batch_id: a.previous_batch_id ?? null, previous_hash: hash(old),
        compared_at: now(), diff: diffRankings(snapshot, old) };
    const history = store.put('comparison_history', hash([run.id, a.previous_run_id ?? a.previous_batch_id]), result);
    store.put('comparison_run', run.id, { ...run, history_id: history.id });
    return history;
}

const SERVICE = { consumer: '个人用户', enterprise_user: '企业用户', internal_team: '内部团队', developer: '开发者', player: '玩家', merchant: '商家', mixed: '多类对象', unclear: '尚不明确' };
const DELIVERABLE = { product_spec: '产品需求与方案', interaction_design: '交互设计', visual: '视觉设计', research: '研究结论', code: '代码', operations: '运营方案', content: '内容', mixed: '综合交付' };
const TIER = { priority: '优先准备', conditional: '条件满足后考虑', adjacent: '相邻方向', qualification_hold: '资格待核验', misjudged: '名称容易误判', excluded: '已排除' };
const GATE = { graduation: '毕业时间', degree: '学历', major: '专业', language: '语言', tool: '工具', portfolio: '作品集', availability: '到岗安排', city: '城市', quota: '投递名额' };
const EVIDENCE = { self_statement: '本人确认', original_artifact: '原始材料', third_party: '第三方佐证', ai_summary: 'AI 摘要，待原文核验', inference: '推断，待核验' };
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '｜').replaceAll('\r', '').replaceAll('\n', '<br>');
const markdownUrl = value => publicUrl(value).replaceAll('(', '%28').replaceAll(')', '%29').replaceAll('|', '%7C');
const list = values => values?.length ? values.map(escape).join('；') : '无额外记录';
function table(items) {
    const columns = ['公司 / 岗位', '城市 / 项目', '实际任务 / 服务对象', '对应经历 / 具体证据', '不匹配 / 硬门槛', '建议 / 排序理由', '官方链接'];
    return `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n` + items.map(item => {
        const evidence = (item.evidence_refs ?? []).map(e => `${e.text ?? e.note ?? e.evidence_id}（${EVIDENCE[e.level] ?? e.level}）`);
        const gaps = [...(item.gaps ?? []), ...(item.mappings ?? []).filter(m => ['gap', 'unknown'].includes(m.relation)).map(m => m.reason)];
        const gates = (item.hard_gates ?? []).map(g => `${GATE[g.gate] ?? g.gate}：${({ meets: '符合', fails: '不符', unknown: '待核验', conflict: '证据冲突' })[g.status] ?? g.status}${g.source === 'preferred' ? '（加分项）' : ''}，${g.note}`);
        return '| ' + [
            `${item.rank ? `${item.rank}. ` : ''}${escape(item.company)}<br>${escape(item.title)}（${trackName(item.track)}）`,
            `${list(item.locations)}<br>${escape((item.project ?? item.campaign) || '项目未单列')}`,
            `${list(item.actual_tasks)}<br>服务对象：${escape(SERVICE[item.service_object] ?? item.service_object)}；交付：${escape(DELIVERABLE[item.core_deliverable] ?? item.core_deliverable)}`,
            `证据：${list(evidence)}`,
            `不匹配：${list(gaps)}<br>硬门槛：${gates.length ? list(gates) : item.eligibility === 'pass' ? '未发现待核验的明确硬门槛' : '明确硬门槛尚待核验'}`,
            `${escape(item.category === 'qualification_hold' ? '资格待澄清' : item.category === 'reference_entries' ? '仅作参考' : TIER[item.tier] ?? item.tier)}<br>${escape(item.reason ?? item.rank_reason)}`,
            item.url ? `[官网岗位](${markdownUrl(item.url)})` : '官方入口待核验'
        ].join(' | ') + ' |';
    }).join('\n');
}
/** Render the same seven-column language for comparison and callers such as daily. */
export function renderComparisonReport(report) {
    const lines = [`公司岗位比较：${report.coverage?.complete ? '本次明确范围已完成' : '阶段结果，仍有缺口'}`];
    if (report.sealed_at) lines.push(`独立排序封存于 ${report.sealed_at}；证据摘要 ${report.snapshot_hash}。`);
    lines.push(`覆盖 ${report.coverage?.completed_companies ?? 0}/${report.coverage?.company_count ?? 0} 家公司，已列出 ${report.coverage?.listed_count ?? 0} 岗，已评估 ${report.coverage?.assessed_count ?? 0} 岗。`);
    const items = report.items ?? ['recommendations', 'qualification_hold', 'reference_entries', 'misjudged', 'excluded'].flatMap(key => report[key] ?? []);
    const companyNames = [...new Set([...(report.companies ?? []).map(company => typeof company === 'string' ? company : company.name ?? company.company), ...items.map(i => i.company)].filter(Boolean))];
    for (const company of companyNames) {
        lines.push(`\n${escape(company)}`);
        for (const [label, predicate] of [['正式岗位', i => i.track !== 'internship'], ['实习岗位', i => i.track === 'internship']]) {
            const selected = items.filter(item => item.company === company && predicate(item));
            lines.push(label, selected.length ? table(selected) : '本次明确范围没有此类已评估岗位。');
        }
    }
    if (!companyNames.length) lines.push('\n正式岗位', '当前没有已评估岗位。', '\n实习岗位', '当前没有已评估岗位。');
    for (const [label, key] of [['资格待澄清岗位', 'qualification_hold'], ['仅作参考岗位', 'reference_entries'], ['误判岗位', 'misjudged'], ['已排除岗位', 'excluded']]) {
        lines.push(`\n${label}`, report[key]?.length ? report[key].map(i => `- ${escape(i.company)} / ${escape(i.title)}：${escape(i.reason ?? i.rank_reason)}`).join('\n') : '本次没有此类岗位。');
    }
    lines.push('\n决定下一步的问题', report.decisive_questions?.length ? report.decisive_questions.map(q => `- ${escape(q.company)} / ${escape(q.title)}：${escape(q.question)}`).join('\n') : '本次没有需要补问候选人的决定性资格问题。');
    if (report.coverage?.blockers?.length) lines.push('\n未完成范围', report.coverage.blockers.map(b => `- ${escape(b.company)} / ${trackName(b.track)} / ${escape(b.campaign)}：${escape(b.reason)}${b.missing_external_ids?.length ? ` 缺少官网岗位 ID：${list(b.missing_external_ids)}` : ''}`).join('\n'));
    const zero = report.coverage?.scopes?.filter(s => s.complete && s.listed_count === 0) ?? [];
    if (zero.length) lines.push('\n已核验零结果入口', zero.map(s => `- ${escape(s.company)} / ${trackName(s.track)} / ${escape(s.campaign)}：[官方目录](${markdownUrl(s.source_url)})；本次为零岗位。`).join('\n'));
    if (report.warnings?.length) lines.push('\n需复核的规则', report.warnings.map(w => `- ${escape(w.reason)}`).join('\n'));
    if (report.diff) for (const [label, key] of [['旧版遗漏', 'missed'], ['旧版高估', 'overestimated'], ['旧版低估', 'underestimated'], ['判断不变', 'same']]) {
        lines.push(`\n${label}`, report.diff[key]?.length ? report.diff[key].map(i => `- ${escape(i.company)} / ${escape(i.title)}：${escape(i.reason)}`).join('\n') : `无；${report.diff.explanations?.[key] ?? '本次未发现对应变化。'}`);
    }
    return lines.join('\n\n');
}

function report(store, runId) {
    const run = currentRun(store, runId, false);
    const snapshot = run.snapshot_id ? store.get('comparison_snapshot', run.snapshot_id) : { ...buildSnapshot(store, run), status: 'draft' };
    const history = run.history_id ? store.get('comparison_history', run.history_id) : null;
    // Keep the independent snapshot immutable, but never turn an old quota or JD
    // into a current action recommendation merely by reopening its report.
    const guarded = snapshot.items.map(item => {
        if (item.category !== 'recommendations') return item;
        const company = run.companies.find(c => c.company_id === item.company_id), scope = company.scopes.find(s => sameScope(s, item));
        const job = store.get('job', item.job_id, false);
        if (!job || job.content_hash !== item.job_hash || snapshot.profile_hash !== profileDigest(store)) return { ...item, rank: null,
            category: 'qualification_hold', reason: '封存后岗位正文或候选人资料发生变化，需重新评估后再决定行动。' };
        const decision = assessmentDisposition(store, run, company, scope, job, { ...item, evidence_refs: item.evidence_refs.map(({ text, ...ref }) => ref) });
        const view = scopeView(store, run, company, scope);
        if (!view.complete || !view.collection.external_ids.includes(item.external_id)) return { ...item, rank: null,
            category: 'qualification_hold', reason: '封存后当前范围的官网目录、正文或独立评估尚未全部核齐，先补齐范围核验。' };
        return { ...item, ...decision, rank: decision.category === 'recommendations' ? item.rank : null };
    });
    const result = { ...snapshot, items: guarded,
        ...Object.fromEntries(['recommendations', 'qualification_hold', 'reference_entries', 'misjudged', 'excluded'].map(category => [category, guarded.filter(i => i.category === category)])),
        warnings: guarded.flatMap(i => (i.warnings ?? []).map(reason => ({ company_id: i.company_id, job_id: i.job_id, reason }))),
        action_checked_at: now(), ...(history ? { diff: withoutScoring(history.diff), previous: { independent_snapshot_hash: history.independent_snapshot_hash,
        previous_run_id: history.previous_run_id, previous_batch_id: history.previous_batch_id, compared_at: history.compared_at } } : {}) };
    return { report: result, markdown: renderComparisonReport(result), cursor: cursor(store, run), budget: publicBudget(store, run) };
}

export function comparison(store, a) {
    if (a.operation === 'start') {
        assert(a.company_ids?.length > 0 && a.company_ids.length <= 20, 'comparison_company_limit', '一次比较必须明确指定 1 至 20 家已登记公司。');
        assert(new Set(a.company_ids).size === a.company_ids.length, 'comparison_duplicate_company', '同一公司只计一次，不以重复条目扩大比较范围或投递额度。');
        noSecrets(a.comparison_key);
        const mode = a.mode ?? 'live', key = hash([store.workspace, 'comparison', a.comparison_key, mode]);
        const byStableKey = store.all('comparison_run').filter(r => r.comparison_key === a.comparison_key && r.mode === mode);
        assert(byStableKey.length <= 1, 'comparison_restore_conflict', '恢复数据中存在相同幂等键的多份比较；先用原 run_id 恢复，不新建预算。');
        const existing = store.get('comparison_run', key, false) ?? byStableKey[0];
        if (existing) {
            assert(hash(existing.companies.map(c => c.company_id).sort()) === hash([...a.company_ids].sort()), 'comparison_scope_changed', '同一幂等键不能改为另一组公司；读取原 run_id 续跑。');
            return { run: existing, budget: publicBudget(store, existing), cursor: cursor(store, existing) };
        }
        const limits = { ...COMPARISON_DEFAULTS, ...(a.limits ?? {}) };
        assert(['details', 'assessments'].every(k => Number.isSafeInteger(limits[k]) && limits[k] >= 0 && limits[k] <= 10000) && Number.isSafeInteger(limits.batch_size) && limits.batch_size > 0 && limits.batch_size <= 100,
            'comparison_invalid_budget', '使用 0 至 10000 的累计正文/评估额度和 1 至 100 的批次大小。');
        const companies = a.company_ids.map(companyId => {
            const c = store.get('company', companyId);
            assert(c.scopes?.length && c.scopes.every(s => s.track && s.campaign && s.source_url), 'comparison_scope_required', '每家公司需要明确招聘类型、批次和官方入口，不能由公司名推断范围。');
            c.scopes.forEach(s => publicUrl(s.source_url));
            return { company_id: c.id, name: c.name, aliases: c.aliases ?? [], scopes: c.scopes.map(s => ({ ...s })) };
        });
        const timezone = a.timezone ?? store.get('settings', 'preferences', false)?.timezone ?? 'Asia/Shanghai';
        try { localDate(now(), timezone); } catch { assert(false, 'invalid_timezone', '请使用有效 IANA 时区。'); }
        const run = store.put('comparison_run', key, { comparison_key: a.comparison_key, mode, timezone, companies, limits, state: 'running', started_at: now() });
        store.put('comparison_budget', run.id, { detail_versions: [], assessment_versions: [], reserved_details: 0, reserved_assessments: 0 });
        return { run, budget: publicBudget(store, run), cursor: cursor(store, run) };
    }
    if (['ingest', 'assess', 'observe'].includes(a.operation)) {
        const prior = store.get('comparison_receipt', receiptKey(a), false);
        if (prior) return prior.result;
    }
    if (a.operation === 'next') return next(store, a.run_id, a.limit);
    if (a.operation === 'ingest') return ingest(store, a);
    if (a.operation === 'assess') return assess(store, a);
    if (a.operation === 'observe') return observe(store, a);
    if (a.operation === 'seal') return seal(store, a);
    if (a.operation === 'previous') return previous(store, a);
    if (a.operation === 'report') return report(store, a.run_id);
    assert(false, 'comparison_operation', '不支持的比较操作；本工具只负责只读来源的采集、证据评估和报告。');
}
