import { currentHost } from './host.mjs';
import { authorizationState } from './authorization.mjs';
import { assertPlanCurrent } from './applications.mjs';
import { assert, hash, id } from './core.mjs';

export const DEFAULT_BATCH_MODE = 'prefill_only';
export const batchMode = store => store.get('settings', 'preferences', false)?.batch_submit ?? DEFAULT_BATCH_MODE;
export const APPLY_QUEUE_LIMITS = Object.freeze({ attempts: 3, lease_ms: 5 * 60000, retry_min_ms: 1000, retry_max_ms: 5 * 60000 });
export const APPLY_DEFER_REASONS = Object.freeze(['portal_unavailable', 'host_unavailable', 'readback_failed', 'interrupted', 'outcome_unknown', 'needs_user', 'content_changed']);
const stamp = time => new Date(time).toISOString();
const errorCode = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/i.test(value) ? value.toLowerCase() : 'host_error';
const delay = attempts => [15000, 60000, 300000][Math.min(Math.max(attempts - 1, 0), 2)];
const next = (owner, action, prompt, tool, args, extra = {}) => ({ owner, action, prompt, ...(tool ? { tool, args } : {}), ...extra });

function describe(store, batch, app, context, active) {
    const plan = app.plan_id ? store.get('plan', app.plan_id, false) : null;
    const material = app.resume_id ? store.get('material', app.resume_id, false) : null;
    const execution = context.execution.filter(record => record.application_id === app.id && record.plan_id === app.plan_id);
    const drafts = context.drafts.filter(record => record.application_id === app.id && record.plan_id === app.plan_id);
    const human = context.human.filter(step => !step.application_id || step.application_id === app.id);
    const approved = context.grant?.state === 'active' ? context.grant.items.find(item => item.application_id === app.id) : null;
    const authority = approved?.authorization ?? context.grant;
    const auth = plan ? authorizationState(app, plan) : null;
    const pending = execution.find(record => ['pending', 'unknown'].includes(record.state));
    const conflict = execution.find(record => record.state === 'conflict');
    const base = { application_id: app.id, number: batch.application_ids.indexOf(app.id) + 1, stage: app.stage };
    const args = { application_id: app.id };
    const contextNext = (action, prompt, readOnly = false) => next('agent', action, prompt, 'jobos1_context', { scope: ['fill_groups', 'recover_fields'].includes(action) ? 'execution' : 'application', ...args }, { read_only: readOnly });
    const sheetNext = scoped => next('agent', 'build_sheet', '生成当前范围审批单，复用未变化的授权。', 'jobos1_apply_batch', { operation: 'sheet', batch_id: batch.id, ...(scoped ? args : {}) }, { read_only: true });
    let reviewCurrent = !!app.review?.ready && !!plan && !!material;
    if (reviewCurrent) {
        try {
            // Keep readiness aligned with review/authorization, including scoped
            // profile bindings, observed controls and every attachment guard.
            assertPlanCurrent(store, app, plan);
            const currentJob = store.get('job', app.job_id, false);
            reviewCurrent = app.review.snapshot?.plan_hash === plan.content_hash && currentJob?.content_hash === app.job_snapshot.content_hash;
        } catch { reviewCurrent = false; }
    }
    let state = 'queued', phase, instruction;
    if (!['preparing', 'unknown'].includes(app.stage)) {
        state = 'complete'; phase = 'complete'; instruction = next('user', 'track', '本项已结束；继续跟踪已记录结果。', undefined, undefined, { read_only: true });
    } else if (app.stage === 'unknown') {
        phase = 'verify_outcome'; instruction = contextNext(phase, '只读核验本岗位的官方结果；结果不明时 defer(outcome_unknown)，禁止再次点击提交。', true);
    } else if (!material || !plan) {
        phase = 'prepare_materials'; instruction = contextNext(phase, '复用已确认资料，准备本岗位材料和当前页面的完整计划。');
    } else if ((batch.paused_items ?? []).some(item => item.application_id === app.id)) {
        state = 'waiting_approval'; phase = 'build_sheet'; instruction = sheetNext(true);
    } else if (context.grant?.state === 'active' && !approved) {
        state = 'waiting_approval'; phase = 'build_sheet'; instruction = sheetNext(true);
    } else if (conflict) {
        state = 'waiting_user'; phase = 'resolve_conflict'; instruction = next('user', phase, '当前值与原值、目标值存在冲突，保留页面并核对本项。', undefined, undefined, { read_only: true });
    } else if (app.review?.ready && !reviewCurrent) {
        phase = 'update_plan'; instruction = contextNext(phase, '已保存审核所依据的计划、材料或事实已变化；更新受影响内容并重新回读。');
    } else if (!pending && reviewCurrent && !(batchMode(store) === 'on' && context.grant?.mode === 'on' && authority?.mode === 'on')) {
        state = 'ready_for_user'; phase = 'human_submit'; instruction = next('user', phase, '本项草稿已保存并回读；全部可处理项目完成后集中交接本人检查和提交。', undefined, undefined, { read_only: true });
    } else if (!context.grant || context.grant.state !== 'active') {
        phase = 'build_sheet'; instruction = sheetNext(false);
    } else if (Date.parse(context.grant.expires_at) <= context.at || Date.parse(authority.expires_at) <= context.at) {
        phase = 'build_sheet'; instruction = sheetNext(true);
    } else if (app.authorization && Date.parse(app.authorization.expires_at) > context.at && app.authorization.session_id !== batch.session_id) {
        state = 'waiting_writer'; phase = 'writer_busy'; instruction = next('user', phase, '另一会话仍持有本项写入租约；保留本项并继续其他申请。', undefined, undefined, { read_only: true });
    } else if (!auth.content_authorized) {
        state = 'waiting_approval'; phase = 'build_sheet'; instruction = sheetNext(true);
    } else if (!auth.lease_active) {
        phase = 'renew_lease'; instruction = next('agent', phase, '复用当前内容授权续租，不扩大字段或提交权限。', 'jobos1_authorize', {
            ...args, plan_hash: plan.content_hash, portal_url: plan.origin, session_id: batch.session_id,
            reuse: true, confirmed: true, user_ref: app.authorization.user_ref
        }, { read_only: false });
    } else if (pending && (pending.state === 'unknown' || !active || active.phase === 'recover_fields' || active.phase === 'renew_lease')) {
        phase = 'recover_fields'; instruction = next('agent', phase, '先只读回读已持久化的未定批次，保存 recover 结果后再决定剩余写入。', 'jobos1_checkpoint', {
            ...args, plan_hash: plan.content_hash, session_id: batch.session_id, portal_url: plan.origin,
            page_fingerprint: plan.page_fingerprint, phase: 'recover', batch_number: pending.number
        }, { read_only: true, required_inputs: ['observed_at', 'groups', ...(pending.targets?.some(field => field.type === 'file_upload') ? ['controls', 'protected_fields'] : [])] });
    } else if (app.review?.ready) {
        phase = 'clear_submit'; instruction = next('agent', phase, '仅对已明确批准自动提交的本项重新核验；成功后才可点击一次。', 'jobos1_apply_batch', {
            operation: 'clear_submit', batch_id: batch.id, ...args, session_id: batch.session_id
        }, { read_only: false });
    } else {
        phase = 'fill_groups'; instruction = contextNext(phase, '继续本项未完成区域；先 prepare，再执行并回读。失败时用当前 claim_id defer，继续其他申请。');
    }
    if (state !== 'complete' && (human.some(step => ['open', 'done'].includes(step.state)) || app.handoff?.state === 'open')) {
        state = 'waiting_user';
        instruction = next('user', 'human_checkpoint', app.handoff?.prompt ?? '本项有待完成或待回读的人工步骤；先推进其他可处理申请。', undefined, undefined, { read_only: true });
    }
    // New timestamps on a review, lease renewal, or repeated unknown outcome are
    // bookkeeping. Only persisted content/authorization or verified field evidence
    // starts a new retry budget. Failed preparations do not replenish that budget.
    const evidence = app.stage === 'unknown' ? hash([app.stage, app.submit_attempt_id ?? null,
        human.map(step => [step.id, step.state]), app.handoff ? [app.handoff.state, app.handoff.kind, app.handoff.created_at] : null]) : hash({
        stage: app.stage, plan: plan?.content_hash ?? null, resume: material?.asset?.sha256 ?? null,
        grant: approved ? [approved.fingerprint, authority.approved_at] : null,
        authorization: app.authorization ? [app.authorization.scope_hash, app.authorization.field_grants] : null,
        completed: execution.filter(record => record.state === 'complete').map(record => [record.number, record.observed_at, record.observations]),
        drafts: drafts.map(record => [record.group_key, record.passed, record.portal_saved, record.passed ? record.observed_at : null,
            (record.observed ?? []).filter(observation => record.checks?.some(check => check.key === observation.key && check.ok))]),
        review: app.review ? [app.review.ready, app.review.snapshot_hash] : null,
        human: human.map(step => [step.id, step.state]), handoff: app.handoff ? [app.handoff.state, app.handoff.kind, app.handoff.created_at] : null
    });
    return { ...base, state, phase, evidence, next: instruction };
}

function inspect(store, batch) {
    const at = Date.now(), saved = batch.queue ?? {};
    const queue = { version: 1, cursor: saved.cursor ?? 0, active: saved.active ? { ...saved.active } : null, items: {} };
    const context = {
        at, grant: batch.grant_id ? store.get('apply_grant', batch.grant_id, false) : null,
        execution: store.all('execution_batch'), drafts: store.all('draft'),
        human: store.all('human_step').filter(step => step.batch_id === batch.id)
    };
    const expired = queue.active && Date.parse(queue.active.expires_at) <= at ? queue.active : null;
    if (expired) queue.active = null;
    let rows = batch.application_ids.map(applicationId => {
        const app = store.get('application', applicationId), previous = saved.items?.[applicationId] ?? {};
        const row = describe(store, batch, app, context, queue.active?.application_id === applicationId ? queue.active : null);
        const phases = { ...(previous.phases ?? {}) }, phase = phases[row.phase];
        phases[row.phase] = phase?.evidence === row.evidence ? { ...phase } : { evidence: row.evidence, attempts: 0 };
        const progressed = previous.evidence !== row.evidence;
        const record = { ...previous, evidence: row.evidence, phase: row.phase, phases, state: row.state,
            ...(progressed ? { retry_at: null, manual_hold: null, last_error: null } : {}) };
        if (expired?.application_id === applicationId && !progressed) {
            record.last_error = 'lease_expired';
            record.retry_at = row.phase === 'recover_fields' ? null : stamp(Date.parse(expired.expires_at) + delay(phases[row.phase].attempts));
        }
        if (row.state === 'queued') {
            if (record.manual_hold) row.state = 'waiting_user';
            else if (phases[row.phase].attempts >= APPLY_QUEUE_LIMITS.attempts && !(queue.active?.application_id === applicationId && queue.active.phase === row.phase && queue.active.evidence === row.evidence)) row.state = row.phase === 'verify_outcome' ? 'unresolved_outcome' : 'blocked';
            else if (record.retry_at && Date.parse(record.retry_at) > at) row.state = 'deferred';
        }
        record.state = row.state; queue.items[applicationId] = record;
        return { ...row, attempts: phases[row.phase].attempts, retry_at: record.retry_at ?? null, last_error: record.last_error ?? null };
    });
    if (queue.active) {
        const row = rows.find(item => item.application_id === queue.active.application_id);
        if (!row || row.evidence !== queue.active.evidence || row.phase !== queue.active.phase || row.state !== 'queued') {
            const current = batch.application_ids.indexOf(queue.active.application_id);
            // Keep a healthy form on the same page while verified regions advance.
            // Failures, handoffs and completed drafts release it to the next job.
            queue.cursor = row?.state === 'queued' && ['fill_groups', 'recover_fields', 'renew_lease'].includes(row.phase)
                ? current : (current + 1) % batch.application_ids.length;
            queue.active = null;
        } else {
            row.state = 'running'; queue.items[row.application_id].state = 'running';
        }
    }
    if (expired) queue.cursor = (batch.application_ids.indexOf(expired.application_id) + 1) % batch.application_ids.length;
    return { queue, rows, at };
}

function candidate(batch, state) {
    if (state.queue.active) return null;
    const ordered = [...state.rows.slice(state.queue.cursor), ...state.rows.slice(0, state.queue.cursor)];
    const runnable = ordered.filter(item => item.state === 'queued');
    // Prepare all selected jobs before requesting an aggregated approval sheet.
    return runnable.find(item => item.phase !== 'build_sheet') ?? runnable[0] ?? null;
}

function projection(batch, state) {
    const enabled = batch.state === 'active';
    const item = enabled ? candidate(batch, state) : null, active = enabled ? state.queue.active : null;
    const items = state.rows.map(({ evidence, ...row }) => enabled || row.state === 'complete' ? row : {
        ...row, state: 'inactive', next: next('user', 'track', '本批次已结束或撤销，保留草稿和历史记录。', undefined, undefined, { read_only: true })
    });
    const counts = Object.fromEntries([...new Set(items.map(row => row.state))].map(key => [key, items.filter(row => row.state === key).length]));
    const ready = items.filter(row => row.state === 'ready_for_user').map(row => row.application_id);
    const wake = items.filter(row => row.state === 'deferred').map(row => row.retry_at).sort()[0] ?? null;
    let status, instruction, canContinue = false;
    if (!enabled) {
        status = batch.state; instruction = next('user', 'track', '本批次已结束或撤销，保留草稿和历史记录。');
    } else if (active) {
        status = 'working'; canContinue = true;
        instruction = { ...items.find(row => row.application_id === active.application_id).next, claim_id: active.claim_id,
            prompt: '继续当前已领取工作并保存检查点；失败时 defer 当前 claim_id。不要重复领取或重放外部动作。' };
    } else if (item) {
        status = 'runnable'; canContinue = true;
        instruction = next('agent', 'next_application', '领取下一项可处理工作；逐项保存进度。', 'jobos1_apply_batch', { operation: 'next', batch_id: batch.id, session_id: batch.session_id });
    } else if (wake) {
        status = 'waiting'; instruction = next('agent', 'wait_until', '其余可处理项目已完成；到 retry_at 后续跑，不连续轮询。', 'jobos1_apply_batch', { operation: 'next', batch_id: batch.id, session_id: batch.session_id }, { retry_at: wake });
    } else if (ready.length) {
        status = 'ready_for_user'; instruction = next('user', 'human_submit', '可处理的草稿已保存并回读；请集中检查、处理本人声明并亲自提交，受阻项已单独保留。', undefined, undefined, { application_ids: ready });
    } else if (items.every(row => row.state === 'complete')) {
        status = 'complete'; instruction = next('user', 'track', '本批结果已记录，继续跟踪申请进展。');
    } else {
        status = 'needs_attention'; instruction = next('user', 'resolve_items', '可处理项目已推进；仅处理列出的人工步骤、内容变化或达到重试上限的项目。');
    }
    return { version: 1, batch_id: batch.id, state: status, items, counts, ready_application_ids: ready, retry_at: wake, next_application_id: item?.application_id ?? active?.application_id ?? null,
        active: active ? { application_id: active.application_id, claim_id: active.claim_id, host: active.host, session_id: active.session_id, expires_at: active.expires_at } : null,
        can_auto_continue: canContinue, next: instruction };
}

export function applicationQueueStatus(store, batch) { return projection(batch, inspect(store, batch)); }

export function applicationQueueGuidance(store, batch, human) {
    const queue = applicationQueueStatus(store, batch);
    return { stage: '批次推进', batch_id: batch.id, application_id: queue.next_application_id,
        human_queue: human.steps, repeat_prompt: false, can_auto_continue: queue.can_auto_continue, next: queue.next,
        progress: { counts: queue.counts, ready_application_ids: queue.ready_application_ids, retry_at: queue.retry_at } };
}

export function applicationQueueOperation(store, batch, a) {
    assert(batch.state === 'active', 'batch_inactive', '批次已结束或撤销。');
    assert(batch.session_id === a.session_id && batch.host === currentHost().id, 'batch_session_mismatch', '仅由原宿主会话恢复本批次；续跑不转移已有授权。');
    const state = inspect(store, batch), { queue, at } = state;
    let claimed = null;
    if (a.operation === 'defer') {
        assert(batch.application_ids.includes(a.application_id), 'batch_scope', '申请不属于本批次。');
        const original = batch.queue?.active, app = store.get('application', a.application_id);
        const current = state.rows.find(item => item.application_id === a.application_id);
        const ready = current.state === 'ready_for_user' || current.phase === 'clear_submit';
        // A failed host receipt is persisted before deferral. It can legitimately
        // change fill_groups into recover_fields and invalidate the derived lease.
        // Only the original still-persisted claim may report that failure; a newer
        // claimant, or a completed/ready draft, can never be released by it.
        assert(original?.application_id === a.application_id && original.claim_id === a.claim_id &&
            ['preparing', 'unknown'].includes(app.stage) && !ready,
            'queue_claim_changed', '领取已结束或已有新进度；先读取当前队列，不能用旧错误覆盖新工作。');
        assert(APPLY_DEFER_REASONS.includes(a.reason), 'invalid_defer_reason', '使用已定义的延期原因。');
        const record = queue.items[a.application_id], attempts = record.phases[record.phase].attempts;
        record.last_error = errorCode(a.error_code ?? a.reason);
        record.last_reason = a.reason;
        if (['needs_user', 'content_changed'].includes(a.reason)) record.manual_hold = a.reason;
        record.retry_at = stamp(at + Math.min(APPLY_QUEUE_LIMITS.retry_max_ms, Math.max(APPLY_QUEUE_LIMITS.retry_min_ms, a.retry_after_ms ?? delay(attempts))));
        queue.active = null; queue.cursor = (batch.application_ids.indexOf(a.application_id) + 1) % batch.application_ids.length;
    } else if (a.operation === 'retry') {
        assert(batch.application_ids.includes(a.application_id), 'batch_scope', '申请不属于本批次。');
        const record = queue.items[a.application_id];
        if (record.retry_at && Date.parse(record.retry_at) <= at) record.retry_at = null;
        // Explicit retry is a scheduling request, never a fresh budget or consent.
    } else {
        assert(['next', 'resume'].includes(a.operation), 'invalid_operation', '不支持的队列操作。');
        const selected = candidate(batch, state);
        if (selected) {
            const record = queue.items[selected.application_id];
            record.phases[selected.phase].attempts++;
            record.last_attempt_at = stamp(at);
            queue.active = { application_id: selected.application_id, phase: selected.phase, evidence: selected.evidence,
                claim_id: id('claim'), host: currentHost().id, session_id: a.session_id, expires_at: stamp(at + APPLY_QUEUE_LIMITS.lease_ms) };
            claimed = { ...selected, evidence: undefined, attempts: record.phases[selected.phase].attempts,
                claim_id: queue.active.claim_id, lease_expires_at: queue.active.expires_at };
        }
    }
    const updated = store.put('apply_batch', batch.id, { ...batch, queue });
    const view = applicationQueueStatus(store, updated);
    const flow = claimed ? { stage: '批次推进', application_id: claimed.application_id, can_auto_continue: true, next: claimed.next }
        : { stage: '批次推进', can_auto_continue: !view.active && view.can_auto_continue,
            next: view.active ? next('agent', 'wait_checkpoint', '已有工作领取尚未完成；等待当前执行保存检查点，不重放。') : view.next };
    return { batch_id: batch.id, item: claimed, queue: view, flow };
}
