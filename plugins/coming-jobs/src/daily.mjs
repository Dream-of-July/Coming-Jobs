import { assert, consent, hash, now, iso, noSecrets, publicUrl } from './core.mjs';
import { facts, coverage, profileDigest } from './profile.mjs';
import { collectionStatus, saveJobs, assessJobs, createApplication } from './jobs.mjs';
import { registerCompany, setOpportunity, opportunity, companyMatches, scopeKey, submitted, migrateCompanies, linkApplication } from './opportunities.mjs';

export const DAILY_DEFAULTS = Object.freeze({ timezone: 'Asia/Shanghai', time: '09:00', target_companies: 5,
    metadata_limit: 20, company_limit: 5, assessment_limit: 100, minutes: 20, expansion_limit: 1, intro_days: 30 });
const localDate = tz => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const currentDay = (date, tz) => localDate(tz) === date;
const fresh = (time, days = 1) => !!time && Date.parse(time) <= Date.now() + 300000 && Date.now() - Date.parse(time) <= days * 86400000;
const config = s => s.get('settings', 'daily', false);
const runKey = (s, c, mode) => hash([s.workspace, localDate(c.timezone), c.timezone, c.config_version, mode]);
const sourceKey = (companyId, scope, mode) => hash([companyId, scopeKey(scope), mode]);
const eligibleScopes = (store, company, mode) => {
    const tracks = facts(store, 'matching').find(f => f.key === 'intent.tracks')?.value;
    return company.scopes.filter(s => (!tracks || JSON.stringify(tracks).includes(s.track)) && opportunity(store, company, s, mode).state !== 'exhausted');
};
function sourceState(store, company, scope, mode) { return store.get('daily_source', sourceKey(company.id, scope, mode), false); }
function scopedJobs(store, company, scope, mode) {
    const collection = store.all('collection').sort((a,b) => Number(b.company === company.name)-Number(a.company === company.name) || Date.parse(b.observed_at)-Date.parse(a.observed_at)).find(c => companyMatches(company, c.company) && c.track === scope.track && c.campaign === scope.campaign && c.mode === mode);
    const jobs = store.all('job').filter(j => j.company === collection?.company && j.track === scope.track && j.campaign === scope.campaign && j.mode === mode && collection?.external_ids.includes(j.external_id));
    return { collection, jobs };
}
function validAssessment(store, job) {
    const a = store.get('assessment', job.id, false);
    return a?.job_hash === job.content_hash && a.profile_hash === profileDigest(store) ? a : null;
}
function scopeReady(store, run, company, scope) {
    const source = sourceState(store, company, scope, run.mode);
    const { collection, jobs } = scopedJobs(store, company, scope, run.mode);
    return source?.state === 'verified' && currentDay(source.checked_date, run.timezone) &&
        collectionStatus(store, collection).complete && jobs.every(j => j.source === 'official' && validAssessment(store, j));
}
function candidates(store, run) {
    return store.all('company').filter(c => {
        const f = store.get('daily_feedback', hash([c.id, run.mode]), false);
        return (!f || f.decision === 'save' || f.decision === 'defer' && f.until && Date.parse(f.until) <= Date.now()) && eligibleScopes(store, c, run.mode).length;
    }).map(company => {
        const scopes = eligibleScopes(store, company, run.mode);
        const pending = store.get('daily_todo', hash([company.id, run.mode]), false)?.state === 'pending' || store.all('application').some(a => a.mode === run.mode && a.stage === 'preparing' && companyMatches(company, a.company));
        const deadlines = scopes.flatMap(s => scopedJobs(store, company, s, run.mode).jobs).filter(j => j.state === 'open' && j.deadline && Date.parse(j.deadline) > Date.now()).map(j => Date.parse(j.deadline));
        deadlines.push(...scopes.map(s => Date.parse(sourceState(store, company, s, run.mode)?.deadline ?? '')).filter(d => d > Date.now()));
        const deadline = deadlines.length ? Math.min(...deadlines) : Infinity;
        const last = Math.max(0, ...scopes.map(s => Date.parse(sourceState(store, company, s, run.mode)?.checked_at ?? '') || 0));
        return { company, scopes, pending, deadline, last };
    }).sort((a, b) => Number(b.deadline <= Date.now() + 3 * 86400000) - Number(a.deadline <= Date.now() + 3 * 86400000) ||
        (a.deadline <= Date.now() + 3 * 86400000 && b.deadline <= Date.now() + 3 * 86400000 ? a.deadline - b.deadline : 0) ||
        Number(b.pending) - Number(a.pending) || (a.last < Date.now() - 7 * 86400000 && b.last < Date.now() - 7 * 86400000 ? a.last - b.last : 0) ||
        b.company.priority - a.company.priority || a.last - b.last || a.company.id.localeCompare(b.company.id));
}
function budget(store, run) { return store.get('daily_budget', run.budget_id); }
function activeRun(store, runId) {
    const run = store.get('daily_run', runId), c = config(store);
    assert(c?.enabled && run.config_version === c.config_version, 'daily_config_changed', '每日设置已变更或暂停，请读取当天进度后重新开始。');
    assert(currentDay(run.date, run.timezone), 'daily_run_expired', '这是此前日期的运行，开始今天的任务；保留已采集资料继续使用。');
    assert(Date.now() < Date.parse(budget(store, run).expires_at), 'daily_budget_exhausted', '今日时间预算已用完，已保存进度，下一日续读。');
    return run;
}
function currentTask(store, a, kind) {
    const run = activeRun(store, a.run_id);
    const task = store.get('daily_task', a.task_id);
    assert(task.run_id === run.id && task.state === 'pending' && (!kind || task.kind === kind), 'daily_task_mismatch', '任务不属于当前运行或已完成，读取 next 恢复。');
    return { run, task };
}
function reserve(store, run, task, updates = {}) {
    const key = hash([run.id, task.kind, task.company_id ?? '', task.scope ?? '', task.job_ids ?? []]);
    store.put('daily_budget', run.budget_id, { ...budget(store, run), ...updates });
    return store.put('daily_task', key, { ...task, run_id: run.id, state: 'pending', created_at: now() });
}
function presentationTask(store, task) {
    const company = task.company_id ? store.get('company', task.company_id) : null;
    const jobs = (task.job_ids ?? []).map(id => store.get('job', id));
    const run = store.get('daily_run', task.run_id);
    return { ...task, ...(task.kind === 'collect' ? { detail_limit: Math.max(0, config(store).assessment_limit - budget(store, run).downloaded) } : {}), company: company?.name, opportunity: company && task.scope ? opportunity(store, company, task.scope, store.get('daily_run', task.run_id).mode) : undefined, jobs: jobs.length ? jobs : undefined,
        introduction_due: company ? !fresh(company.introduction?.observed_at, 30) : undefined,
        next: task.kind === 'metadata' ? '只读核验完整岗位目录与变更标识；observe 保存公开游标、变化和核验结果。无可靠标识时标 changed=true。' :
            task.kind === 'collect' ? '按 scope 完成全部分页和完整 JD；用 daily(ingest) 分批保存，使用 next 恢复；预算不足保留游标。' :
            task.kind === 'assess' ? '仅评估本批完整 JD 的每项要求，再 daily(assess)；包含硬性不符的排除理由。' : '从已授权目录来源发现至多一家新公司；只登记官方入口，不自动准备材料。' };
}
function nextTask(store, runId) {
    const run = activeRun(store, runId), c = config(store), b = budget(store, run);
    const pending = store.all('daily_task').find(t => t.run_id === run.id && t.state === 'pending');
    if (pending) return { task: presentationTask(store, pending), budget: b };
    const attempted = (kind, company, scope) => store.all('daily_task').some(t => t.run_id === run.id && t.kind === kind && t.company_id === company.id && scopeKey(t.scope) === scopeKey(scope));
    const ordered = candidates(store, run);
    for (const { company, scopes } of ordered) {
        if (!b.metadata.includes(company.id) && b.metadata.length >= c.metadata_limit) continue;
        for (const scope of scopes) {
            const source = sourceState(store, company, scope, run.mode);
            if (!currentDay(source?.checked_date, run.timezone) && !attempted('metadata', company, scope)) {
                const task = reserve(store, run, { kind: 'metadata', company_id: company.id, scope,
                    cursor: source?.cursor ?? null, previous_fingerprint: source?.fingerprint ?? null }, { metadata: [...new Set([...b.metadata, company.id])] });
                return { task: presentationTask(store, task), budget: budget(store, run) };
            }
        }
    }
    const readyIds = new Set(buildReport(store, run).cards.map(c => c.company_id));
    let readyCount = 0;
    for (const { company, scopes } of ordered) {
        if (readyIds.has(company.id)) {
            if (++readyCount >= c.target_companies) return { task: null, budget: b, next: '有效待办已补足，report 保存今日结果，无需继续深读新公司。' };
            continue;
        }
        if (!b.companies.includes(company.id) && b.companies.length >= c.company_limit) continue;
        for (const scope of scopes) {
            const source = sourceState(store, company, scope, run.mode);
            if (opportunity(store, company, scope, run.mode).state === 'needs_verification' || !currentDay(source?.checked_date, run.timezone) || source.state === 'blocked') continue;
            const { collection, jobs } = scopedJobs(store, company, scope, run.mode);
            if (source.state !== 'verified' || !collectionStatus(store, collection).complete) {
                if (attempted('collect', company, scope) || b.downloaded >= c.assessment_limit) continue;
                const task = reserve(store, run, { kind: 'collect', company_id: company.id, scope, cursor: source.cursor ?? null,
                    detail_limit: c.assessment_limit - b.downloaded }, { companies: [...new Set([...b.companies, company.id])] });
                return { task: presentationTask(store, task), budget: budget(store, run) };
            }
            const missing = jobs.filter(j => !validAssessment(store, j));
            const available = c.assessment_limit - b.assessed;
            if (missing.length && available > 0) {
                const slice = missing.slice(0, Math.min(10, available));
                const task = reserve(store, run, { kind: 'assess', company_id: company.id, scope, job_ids: slice.map(j => j.id), job_hashes: slice.map(j => j.content_hash) },
                    { companies: [...new Set([...b.companies, company.id])], assessed: b.assessed + slice.length });
                return { task: presentationTask(store, task), budget: budget(store, run) };
            }
        }
    }
    if (b.expanded < c.expansion_limit && !store.all('daily_task').some(t => t.run_id === run.id && t.kind === 'expand')) {
        const task = reserve(store, run, { kind: 'expand' }, { expanded: b.expanded + 1 });
        return { task: presentationTask(store, task), budget: budget(store, run) };
    }
    return { task: null, budget: b, next: '调用 report 保存完整推荐及未完成原因；不为凑够五家公司扩大今天预算。' };
}
function buildReport(store, run) {
    const c = config(store), cards = [], pending = [];
    for (const { company, scopes, pending: retained } of candidates(store, run)) {
        const reason = !fresh(company.introduction?.observed_at, c.intro_days) ? 'company_introduction_pending' : scopes.some(s => opportunity(store, company, s, run.mode).state === 'needs_verification') ? 'opportunity_unverified' :
            scopes.some(s => !scopeReady(store, run, company, s)) ? 'scope_review_incomplete' : null;
        if (reason) { pending.push({ company_id: company.id, company: company.name, reason }); continue; }
        const items = scopes.flatMap(scope => scopedJobs(store, company, scope, run.mode).jobs.map(job => ({ job, scope, assessment: validAssessment(store, job) })))
            .filter(({ job: j, assessment: a }) => j.source === 'official' && j.state === 'open' && (!j.deadline || Date.parse(j.deadline) > Date.now()) && a?.eligibility !== 'fail' && a?.score >= 50 &&
                !store.all('application').some(x => x.mode === run.mode && submitted(x) && (x.job_id === j.id || companyMatches(company, x.company) && x.job_snapshot?.external_id === j.external_id && (x.job_snapshot?.campaign ?? store.get('application_scope', x.id, false)?.campaign) === j.campaign)) &&
                (() => { const f = store.get('feedback', j.id, false); return !f || f.decision === 'save' || f.decision === 'defer' && f.until && Date.parse(f.until) <= Date.now(); })())
            .sort((a, b) => b.assessment.score - a.assessment.score || Number(a.assessment.eligibility !== 'pass') - Number(b.assessment.eligibility !== 'pass') || a.job.id.localeCompare(b.job.id))
            .slice(0, 3).map(({ job: j, scope, assessment: a }) => ({ job_id: j.id, job_hash: j.content_hash, title: j.title, url: j.url, locations: j.locations ?? [], deadline: j.deadline ?? null,
                score: a.score, eligibility: a.eligibility, reason: a.reason, advantages: a.advantages, gaps: a.gaps,
                risks: [...a.gaps, ...a.mappings.filter(m => ['unknown', 'gap'].includes(m.relation)).map(m => m.reason)],
                opportunity: opportunity(store, company, scope, run.mode), verified_at: sourceState(store, company, scope, run.mode).checked_at }));
        if (!items.length) { pending.push({ company_id: company.id, company: company.name, reason: 'no_matching_open_jobs' }); continue; }
        cards.push({ company_id: company.id, company: company.name, introduction: company.introduction, retained, items });
        if (cards.length >= c.target_companies) break;
    }
    const tasks = store.all('daily_task').filter(t => t.run_id === run.id && t.state !== 'done').map(t => ({ kind: t.kind, company_id: t.company_id, state: t.state, reason: t.reason ?? 'in_progress' }));
    return { cards: cards.map((c, i) => ({ ...c, label: String.fromCharCode(65 + i) })), pending, tasks };
}
function reconcileTodos(store, mode) {
    for (const todo of store.all('daily_todo').filter(t => t.mode === mode && t.state === 'pending')) {
        const snapshot = store.get('daily_report', todo.report_id, false);
        const card = snapshot?.cards.find(c => c.company_id === todo.company_id);
        if (card?.items.some(i => store.all('application').some(a => a.mode === mode && a.job_id === i.job_id && submitted(a))))
            store.put('daily_todo', todo.id, { ...todo, state: 'completed' });
    }
}
function report(store, runId) {
    const run = store.get('daily_run', runId), c = config(store);
    assert(c && run.config_version === c.config_version && currentDay(run.date, run.timezone), 'daily_run_expired', '请先开始今天的任务。');
    reconcileTodos(store, run.mode);
    const result = buildReport(store, run);
    if (!candidates(store, run).length) result.pending.push({ reason: 'company_scope_required', next: '从已授权目录登记仍有机会的公司和明确招聘批次；不让用户逐个提供岗位链接。' });
    const semantic = result.cards.map(({ company_id, introduction, items }) => ({ company_id, introduction: introduction.text,
        items: items.map(({ verified_at, opportunity: o, ...rest }) => ({ ...rest, opportunity: { state: o.state, remaining: o.remaining } })) }));
    const digest = hash([semantic, result.pending.map(p => [p.company_id, p.reason]), result.tasks.filter(t => t.state === 'blocked').map(t => [t.kind, t.company_id, t.reason])]);
    const previous = store.get('settings', `daily_notice_${run.mode}`, false);
    const notify = previous?.digest !== digest && (result.cards.length > 0 || result.pending.length > 0 || result.tasks.some(t => t.state === 'blocked'));
    const snapshot = store.put('daily_report', hash([run.id, digest]), { ...result, run_id: run.id, date: run.date, timezone: run.timezone, digest, created_at: now(),
        status: result.cards.length >= c.target_companies ? 'ready' : result.cards.length ? 'partial' : 'blocked',
        shortage: Math.max(0, c.target_companies - result.cards.length), budget: budget(store, run) });
    if (notify) store.put('settings', `daily_notice_${run.mode}`, { digest, report_id: snapshot.id, state: 'reserved', reserved_at: now() });
    for (const card of result.cards) store.put('daily_todo', hash([card.company_id, run.mode]), { company_id: card.company_id, mode: run.mode, state: 'pending', report_id: snapshot.id });
    store.put('daily_run', run.id, { ...run, state: snapshot.status, report_id: snapshot.id, finished_at: now() });
    const binding = store.get('settings', 'daily_scheduler', false);
    if (binding && run.mode === 'live') store.put('settings', binding.id, { ...binding, last_run: { id: run.id, state: snapshot.status, at: now() } });
    return { report: snapshot, notify, delivery: '本次通知已预留；成功展示后 acknowledge。失败或结果未知保留 reserved，不自动重发。' };
}
export function dailySummary(store) {
    const c = config(store);
    if (!c) return { configured: false, next: '复用已有画像和意图；用户已要求每日推荐时 configure，再绑定真实宿主任务。' };
    const run = store.all('daily_run').filter(r => r.mode === 'live' && r.config_version === c.config_version).at(-1);
    return { configured: true, enabled: c.enabled, timezone: c.timezone, time: c.time, target_companies: c.target_companies,
        scheduler: store.get('settings', 'daily_scheduler', false), last_run: run ? { id: run.id, date: run.date, state: run.state, report_id: run.report_id ?? null } : null,
        due_today: c.enabled && (!run || run.date !== localDate(c.timezone) || !run.report_id), pending_companies: store.all('daily_todo').filter(t => t.mode === 'live' && t.state === 'pending').length };
}
export function daily(store, a) {
    if (a.operation === 'configure') {
        consent(a.confirmed, a.user_ref);
        const old = config(store), values = { ...DAILY_DEFAULTS, ...(old?.values ?? {}), ...(a.settings ?? {}) };
        try { localDate(values.timezone); } catch { assert(false, 'invalid_timezone', '请使用有效 IANA 时区。'); }
        const enabled = a.enabled ?? old?.enabled ?? true, version = hash([values, enabled]);
        const saved = store.put('settings', 'daily', { ...values, values, enabled, config_version: version });
        if (old && old.config_version !== version) {
            const binding = store.get('settings', 'daily_scheduler', false);
            if (binding) store.put('settings', 'daily_scheduler', { ...binding, state: 'needs_rebind' });
        }
        return saved;
    }
    if (a.operation === 'company') {
        if (a.run_id) currentTask(store, a, 'expand');
        const company = registerCompany(store, a.company);
        if (a.run_id) { const task = store.get('daily_task', a.task_id); store.put('daily_task', task.id, { ...task, state: 'done' }); }
        return company;
    }
    if (a.operation === 'link_application') return linkApplication(store, a);
    if (a.operation === 'opportunity') return setOpportunity(store, a);
    if (a.operation === 'status') return { ...dailySummary(store), companies: store.all('company').map(c => ({ ...c, opportunities: c.scopes.map(s => ({ ...s, ...opportunity(store, c, s, a.mode ?? 'live') })) })) };
    if (a.operation === 'bind') {
        assert(a.host_success && a.result_ref, 'scheduler_unverified', '需要宿主实际绑定成功的结果。');
        noSecrets(a.result_ref);
        return store.put('settings', 'daily_scheduler', { state: 'host_reported_active', provider_task_id: a.provider_task_id,
            target_thread_id: a.target_thread_id, result_ref: a.result_ref, bound_at: now(), last_run: null });
    }
    if (a.operation === 'health') {
        noSecrets(a.result_ref);
        const old = store.get('settings', 'daily_scheduler');
        return store.put('settings', old.id, { ...old, state: a.state, result_ref: a.result_ref, checked_at: now() });
    }
    if (a.operation === 'start') {
        const c = config(store);
        assert(c?.enabled, 'daily_not_enabled', '每日推荐未启用或已暂停。');
        assert(coverage(store).ready, 'profile_incomplete', '先复用已确认资料，补齐唯一必要问题再推荐。');
        migrateCompanies(store);
        reconcileTodos(store, a.mode ?? 'live');
        const mode = a.mode ?? 'live', key = runKey(store, c, mode), existing = store.get('daily_run', key, false);
        if (existing) return { run: existing, next: '读取 next 续跑或 report 获取当前结果；不要重复创建任务。' };
        const budgetId = hash([store.workspace, localDate(c.timezone), c.timezone, mode]);
        if (!store.get('daily_budget', budgetId, false)) store.put('daily_budget', budgetId, { metadata: [], companies: [], downloaded: 0, assessed: 0, expanded: 0,
            expires_at: new Date(Date.now() + c.minutes * 60000).toISOString() });
        const run = store.put('daily_run', key, { date: localDate(c.timezone), timezone: c.timezone, config_version: c.config_version, mode, state: 'running', budget_id: budgetId, started_at: now() });
        const binding = store.get('settings', 'daily_scheduler', false);
        if (binding && mode === 'live') store.put('settings', binding.id, { ...binding, last_run: { id: run.id, state: 'started', at: now() } });
        return { run, next: 'next 提供有预算的任务；无任务时 report。仅读取已授权公开来源，不运行仓库代码。' };
    }
    if (a.operation === 'next') return nextTask(store, a.run_id);
    if (a.operation === 'observe') {
        const { run, task } = currentTask(store, a);
        noSecrets(a);
        assert(['metadata', 'collect', 'expand'].includes(task.kind), 'daily_task_mismatch', '评估任务使用 assess 完成。');
        if (a.cursor) { assert(!/https?:\/\//i.test(a.cursor), 'private_cursor', '仅保存无秘密的公开分页游标，不保存整段链接。'); }
        if (task.company_id) {
            const company = store.get('company', task.company_id), source = sourceState(store, company, task.scope, run.mode);
            const unchanged = task.kind === 'metadata' && a.changed === false;
            if (unchanged) assert(a.fingerprint && a.fingerprint === source?.fingerprint && source.complete && ['complete_jd_manifest', 'revalidated_details'].includes(a.change_basis), 'change_unverified', '没有上次完整范围的相同可靠标识，需重新采集。');
            if (task.kind === 'collect' && a.state === 'done') assert(collectionStatus(store, scopedJobs(store, company, task.scope, run.mode).collection).complete, 'collection_incomplete', '完整目录和 JD 尚未齐全。');
            if (unchanged && a.state === 'done') {
                const { collection } = scopedJobs(store, company, task.scope, run.mode);
                assert(collection, 'collection_incomplete', '没有可复用的完整范围。');
                store.put('collection', collection.id, { ...collection, observed_at: now() });
            }
            store.put('daily_source', sourceKey(company.id, task.scope, run.mode), { ...source, company_id: company.id, scope: task.scope, mode: run.mode,
                state: a.state === 'blocked' ? 'blocked' : a.state === 'partial' ? 'partial' : task.kind === 'collect' || unchanged ? 'verified' : 'changed',
                complete: a.state === 'done' && (task.kind === 'collect' || unchanged), checked_date: run.date, checked_at: now(),
                deadline: a.deadline ? iso(a.deadline) : unchanged ? source?.deadline ?? null : null,
                fingerprint: a.fingerprint ?? source?.fingerprint ?? null, cursor: a.cursor ?? null, reason: a.reason ?? null });
        }
        return store.put('daily_task', task.id, { ...task, state: a.state, reason: a.reason ?? null });
    }
    if (a.operation === 'ingest') {
        const { run, task } = currentTask(store, a, 'collect'), c = config(store), b = budget(store, run);
        const company = store.get('company', task.company_id);
        assert(a.collection.company === company.name && a.collection.track === task.scope.track && a.collection.campaign === task.scope.campaign && a.jobs.every(j => j.mode === run.mode && j.source === 'official'), 'collection_scope_mismatch', '只能保存本任务公司、批次和模式的数据。');
        noSecrets(a);
        if (a.cursor) assert(!/https?:\/\//i.test(a.cursor), 'private_cursor', '仅保存公开分页游标。');
        const changed = a.jobs.filter(j => { const old = scopedJobs(store, company, task.scope, run.mode).jobs.find(x => x.external_id === j.external_id); return !old || old.jd !== j.jd; }).length;
        assert(b.downloaded + changed <= c.assessment_limit, 'daily_budget_exhausted', '今日新增正文预算已用完，保存游标后次日继续。');
        const result = saveJobs(store, { ...a, mode: run.mode, compact: true, coverage: 'partial' });
        store.put('daily_budget', b.id, { ...b, downloaded: b.downloaded + changed });
        const source = sourceState(store, company, task.scope, run.mode);
        store.put('daily_source', sourceKey(company.id, task.scope, run.mode), { ...source, company_id: company.id, scope: task.scope, mode: run.mode, state: 'partial', complete: false, cursor: a.cursor ?? source?.cursor ?? null });
        return result;
    }
    if (a.operation === 'assess') {
        const { task } = currentTask(store, a, 'assess');
        assert(a.assessments.length === task.job_ids.length && a.assessments.every(x => task.job_ids.includes(x.job_id) && task.job_hashes[task.job_ids.indexOf(x.job_id)] === x.job_hash) && new Set(a.assessments.map(x => x.job_id)).size === task.job_ids.length, 'daily_task_mismatch', '仅评估本次已分配的完整任务。');
        const result = assessJobs(store, a);
        store.put('daily_task', task.id, { ...task, state: 'done' });
        return { assessed: result.assessments.map(x => ({ job_id: x.job_id, score: x.score })) };
    }
    if (a.operation === 'report') return report(store, a.run_id);
    if (a.operation === 'acknowledge') {
        const snapshot = store.get('daily_report', a.report_id), run = store.get('daily_run', snapshot.run_id);
        noSecrets(a.result_ref);
        const pending = store.get('settings', `daily_notice_${run.mode}`, false);
        assert(pending?.digest === snapshot.digest, 'stale_delivery', '已有更新的日报通知，不回退展示状态。');
        return store.put('settings', `daily_notice_${run.mode}`, { digest: snapshot.digest, state: 'delivered', report_id: snapshot.id, result_ref: a.result_ref, delivered_at: now() });
    }
    if (a.operation === 'feedback') {
        consent(a.confirmed, a.user_ref); store.get('company', a.company_id);
        const mode = a.mode ?? 'live';
        const f = store.put('daily_feedback', hash([a.company_id, mode]), { company_id: a.company_id, decision: a.decision, until: a.until ? iso(a.until) : null });
        if (a.decision !== 'save') store.put('daily_todo', hash([a.company_id, mode]), { company_id: a.company_id, mode, state: a.decision });
        return f;
    }
    if (a.operation === 'choose') {
        consent(a.confirmed, a.user_ref);
        const snapshot = store.get('daily_report', a.report_id), run = store.get('daily_run', snapshot.run_id);
        const oldCard = snapshot.cards.find(c => c.label === a.label);
        assert(oldCard, 'invalid_selection', '这份日报没有该公司编号。');
        assert(currentDay(run.date, run.timezone), 'daily_report_stale', '先只读核验今天的岗位与名额，再继续这家公司。');
        const current = buildReport(store, run).cards.find(c => c.company_id === oldCard.company_id);
        const selected = oldCard.items[a.role_number - 1];
        assert(selected && current?.items.some(i => i.job_id === selected.job_id && i.job_hash === selected.job_hash), 'daily_report_stale', '岗位、画像或名额有变化，请更新推荐，不消耗机会。');
        const application = createApplication(store, selected.job_id, a.user_ref, selected.job_hash);
        store.put('settings', 'focus', { kind: 'application', application_id: application.id, operation: 'choose' });
        return { application };
    }
}
export function dailyFlow(data) {
    return { stage: '每日推荐', can_auto_continue: !!data.task || !!data.run, next: { owner: data.task || data.run ? 'agent' : 'user', action: data.task ? data.task.kind : 'daily',
        prompt: data.task?.next ?? data.next ?? '查看今日公司推荐；选定后准备材料，不在后台自动投递。' } };
}
