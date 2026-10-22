import { assert, hash } from './core.mjs';
import { profileDigest } from './profile.mjs';
import { compareFitAssessments, isRecommendable } from './fit-assessment.mjs';
import { applicationChoiceKey, applicationScope, companyMatches, jobObservationCurrent, opportunity, previouslyApplied, scopeKey, submitted } from './opportunities.mjs';

export const MAX_COMPANY_CHOICES = 100;
const sameScope = (left, right) => left.track === right.track && (left.campaign ?? '') === (right.campaign ?? '');
const modeOf = value => value.mode ?? 'live';
const storedChoice = (store, app) => applicationChoiceKey({ ...applicationScope(store, app), job_id: app.job_id, id: app.id });
const feedbackAllows = feedback => !feedback || feedback.decision === 'save' || feedback.decision === 'defer' && feedback.until && Date.parse(feedback.until) <= Date.now();

export function preparations(store, company, scope, mode) {
    return store.all('application').filter(app => modeOf(app) === mode && companyMatches(company, app.company) &&
        app.stage === 'preparing' && !submitted(app) && sameScope(applicationScope(store, app), scope))
        .sort((a, b) => (a.application_choice_order?.preparation_position ?? Infinity) - (b.application_choice_order?.preparation_position ?? Infinity) ||
            String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id));
}

/** Current caller-verified scope evidence is required; a ranking is never submission permission. */
export function companyApplicationStrategy(store, company, { mode = 'live', scopes = company.scopes, candidates = [], reviewed_scopes = [], preferred_job_ids = [] } = {}) {
    const reviewed = new Set(reviewed_scopes), digest = profileDigest(store);
    const remembered = scopes.flatMap(scope => preparations(store, company, scope, mode).map(app => app.job_id));
    const preferred = new Map([...new Set([...remembered, ...preferred_job_ids])].map((jobId, index) => [jobId, index]));
    const companyAllowed = feedbackAllows(store.get('daily_feedback', hash([company.id, mode]), false));
    const compare = (a, b) => {
        const preferredA = preferred.get(a.job.id), preferredB = preferred.get(b.job.id);
        if (preferredA !== undefined || preferredB !== undefined) {
            if (preferredA === undefined) return 1;
            if (preferredB === undefined) return -1;
            if (preferredA !== preferredB) return preferredA - preferredB;
        }
        return compareFitAssessments(a.assessment, b.assessment);
    };
    let outputCount = 0;
    const plans = scopes.map(scope => {
        const quota = opportunity(store, company, scope, mode), drafts = preparations(store, company, scope, mode);
        const byChoice = new Map();
        for (const app of drafts) {
            const key = storedChoice(store, app);
            if (!byChoice.has(key)) byChoice.set(key, app);
        }
        const eligible = candidates.filter(({ job, assessment }) => companyAllowed && companyMatches(company, job.company) && sameScope(job, scope) && modeOf(job) === mode &&
            job.source === 'official' && job.state === 'open' && (!job.deadline || Date.parse(job.deadline) > Date.now()) &&
            jobObservationCurrent(job) &&
            assessment?.job_hash === job.content_hash && assessment.profile_hash === digest && isRecommendable(assessment) &&
            !previouslyApplied(store, job) && feedbackAllows(store.get('feedback', job.id, false)))
            .sort(compare);
        // A prepared direction owns its reservation. Another direction under the
        // same official parent must not silently replace that user's selection.
        const distinct = new Map();
        for (const candidate of eligible) {
            const key = applicationChoiceKey(candidate.job), existing = byChoice.get(key);
            if (existing && existing.job_id !== candidate.job.id) continue;
            if (!distinct.has(key)) distinct.set(key, candidate);
        }
        const blockers = [];
        if (quota.state !== 'available') blockers.push(quota.state === 'closed' ? 'campaign_closed' : quota.state === 'exhausted' ? 'opportunity_exhausted' : 'opportunity_unverified');
        if (!reviewed.has(scopeKey(scope))) blockers.push('scope_review_incomplete');
        if (!companyAllowed) blockers.push('company_preference');
        if (quota.remaining !== null && quota.reserved > quota.remaining) blockers.push('draft_capacity_conflict');
        const pending = [...distinct.values()].filter(({ job }) => byChoice.has(applicationChoiceKey(job)));
        const available = [...distinct.values()].filter(({ job }) => !byChoice.has(applicationChoiceKey(job)));
        const selected = blockers.length ? [] : [...pending, ...available.slice(0, quota.new_capacity)].sort(compare);
        const visible = selected.slice(0, Math.max(0, MAX_COMPANY_CHOICES - outputCount));
        outputCount += visible.length;
        const choices = visible.map(({ job, assessment }, index) => {
            const existing = byChoice.get(applicationChoiceKey(job));
            return { job_id: job.id, job_hash: job.content_hash, title: job.title, track: job.track, campaign: job.campaign,
                application_id: existing?.id ?? null, action: existing ? 'resume_preparation' : 'prepare',
                preparation_position: index + 1, assessment_rank: assessment.rank ?? null, tier: assessment.tier,
                portal_preference_rank: null, volunteer_order: quota.volunteer_order };
        });
        const plannedNew = selected.filter(({ job }) => !byChoice.has(applicationChoiceKey(job))).length;
        const unused = quota.new_capacity === null ? null : Math.max(0, quota.new_capacity - plannedNew);
        return { track: scope.track, campaign: scope.campaign, status: blockers.length ? quota.state === 'available' ? 'needs_review' : quota.state : choices.length ? 'ready' : 'no_matching_jobs',
            limit: quota.limit, used: quota.used, remaining: quota.remaining, reserved: quota.reserved, new_capacity: quota.new_capacity,
            reserved_application_ids: quota.reserved_application_ids, uncertain_application_ids: quota.uncertain_application_ids,
            uncertain_draft_application_ids: quota.uncertain_draft_application_ids, eligible_count: distinct.size,
            recommended_count: selected.length, choices, omitted_choice_count: selected.length - choices.length,
            unused_slots: unused, shortage_reason: unused > 0 && !blockers.length ? 'no_more_suitable_distinct_jobs' : null,
            volunteer_order: quota.volunteer_order, can_change: quota.can_change,
            order_confirmation_required: quota.volunteer_order !== 'parallel',
            order_note: quota.volunteer_order === 'ordered' ? '官方志愿有顺序；按用户已选偏好准备，填写前核实已有志愿位置，展示顺序不代表已登记的门户志愿。' :
                quota.volunteer_order === 'parallel' ? '官方允许并行选择；准备先后不代表志愿优先级。' : '官方志愿顺序含义尚未核验；准备顺序不推断为门户志愿顺序。',
            rule_source: quota.rule_source, rule_source_ref: quota.rule_source_ref, rule_observed_at: quota.rule_observed_at,
            rules_verification: quota.rules_verification, deadline: quota.deadline, blockers };
    });
    const choices = plans.flatMap(plan => plan.choices);
    return { company_id: company.id, company: company.name, mode, scopes: plans, choices,
        recommended_count: plans.reduce((sum, plan) => sum + plan.recommended_count, 0),
        omitted_choice_count: plans.reduce((sum, plan) => sum + plan.omitted_choice_count, 0),
        status: plans.some(plan => plan.status === 'needs_verification' || plan.status === 'needs_review') ? 'needs_verification' : choices.length ? 'ready' : 'no_matching_jobs',
        action: 'prepare_selected_choices', requires_user_selection: true,
        note: '仅规划已核验且合适的独立岗位；准备中申请预留名额，撤回或拒绝不自动返还已用机会，最终提交仍由用户完成。' };
}

/** Preflight the entire selection before creating any draft, under the service transaction. */
export function assertApplicationSelection(store, jobs) {
    assert(jobs.length > 0 && new Set(jobs.map(job => job.id)).size === jobs.length, 'invalid_selection', '请选择不重复的岗位编号。');
    const groups = new Map();
    for (const job of jobs) {
        assert(jobObservationCurrent(job), 'job_observation_stale', '岗位正文核验已过期，请先重新读取完整 JD 或核验完整正文变更标识。');
        const company = store.all('company').find(record => companyMatches(record, job.company));
        assert(company, 'opportunity_unverified', '先登记并核验当前公司的招聘范围和名额。');
        assert(feedbackAllows(store.get('feedback', job.id, false)) && feedbackAllows(store.get('daily_feedback', hash([company.id, modeOf(job)]), false)),
            'application_preference', '这个岗位或公司已被拒绝或暂缓；先明确恢复收藏，再选择准备。');
        const key = hash([company.id, scopeKey(job), modeOf(job)]);
        if (!groups.has(key)) groups.set(key, { company, scope: job, mode: modeOf(job), jobs: [] });
        groups.get(key).jobs.push(job);
    }
    for (const { company, scope, mode, jobs: selected } of groups.values()) {
        const quota = opportunity(store, company, scope, mode);
        assert(quota.state !== 'exhausted', 'opportunity_exhausted', '该公司本批次名额已用完，只作参考并继续跟进。');
        assert(quota.state !== 'closed', 'campaign_closed', '本招聘项目已经截止，请核验当前开放范围。');
        assert(quota.state === 'available', 'opportunity_unverified', '先复核当前公司名额、投递规则和既有申请。');
        assert(new Set(selected.map(applicationChoiceKey)).size === selected.length, 'duplicate_application_choice', '同一官方申请下的多个方向只算一个志愿，请选择一个方向。');
        const drafts = preparations(store, company, scope, mode), reserved = new Set(drafts.map(app => storedChoice(store, app)));
        let needed = 0;
        for (const job of selected) {
            assert(!previouslyApplied(store, job), 'already_applied', '这个岗位或同一官方申请方向已有提交记录，先跟进已有申请。');
            const draft = drafts.find(app => storedChoice(store, app) === applicationChoiceKey(job));
            assert(!draft || draft.job_id === job.id, 'application_choice_reserved', '同一官方申请的另一方向已在准备中，先核对已有选择，不创建重复志愿。');
            if (!reserved.has(applicationChoiceKey(job))) needed++;
        }
        assert(quota.reserved <= quota.remaining && needed <= quota.new_capacity, 'opportunity_reserved', '这些选择超过本公司本批次可用名额；准备中申请已预留名额，请保留合适且不重复的选择。');
    }
}
