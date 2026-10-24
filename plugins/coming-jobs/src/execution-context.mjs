import { assert } from './core.mjs';
import { authorizationState } from './authorization.mjs';
import { itinerary } from './execution.mjs';
import { authenticationContext } from './authentication.mjs';

/** A read-only work packet: one application, one field batch, no accumulated history.
 * This is context for observation, never permission to execute a browser write.
 * Only checkpoint(prepare) returns a persisted write receipt.
 */
export function executionContext(store, applicationId) {
    assert(applicationId, 'application_required', '执行上下文需要 application_id。', '先读取 apply_batch(status/next)，再传当前申请的 application_id。');
    const app = store.get('application', applicationId);
    const plan = app.plan_id ? store.get('plan', app.plan_id) : null;
    const records = store.all('execution_batch').filter(batch => batch.application_id === app.id && batch.plan_id === app.plan_id);
    const specs = plan ? itinerary(plan) : [];
    const next = specs.find(spec => !records.some(record => record.number === spec.number && record.state === 'complete'));
    const record = next && records.find(item => item.number === next.number);
    const material = app.resume_id ? store.get('material', app.resume_id, false) : null;
    const summary = batch => ({ id: batch.id, number: batch.number, state: batch.state,
        recovery_required: ['pending','unknown','conflict'].includes(batch.state),
        retry_keys: batch.retry_keys ?? [], conflicts: batch.conflicts ?? [], observed_at: batch.observed_at ?? null });
    return {
        compact: true,
        application: { id: app.id, company: app.company, title: app.title, stage: app.stage,
            job_id: app.job_id, plan_id: app.plan_id ?? null, resume_id: app.resume_id ?? null,
            apply_batch_id: app.apply_batch_id ?? null, handoff: app.handoff ?? null },
        plan: plan ? { id: plan.id, content_hash: plan.content_hash, origin: plan.origin,
            page_fingerprint: plan.page_fingerprint, total_batches: specs.length } : null,
        authorization_status: plan ? authorizationState(app, plan) : null,
        next_batch: next ? { ...next, checkpoint_id: record?.id ?? null, state: record?.state ?? 'not_started',
            recovery_required: !!record && ['pending','unknown','conflict'].includes(record.state),
            targets: plan.groups.flatMap(group => group.fields).filter(field => next.field_keys.includes(field.key)),
            before: record?.before ?? [], observations: record?.observations ?? [],
            retry_keys: record?.retry_keys ?? [], conflicts: record?.conflicts ?? [],
            protected_field_keys: next.kind === 'file_upload' ? plan.groups.flatMap(group => group.fields).filter(field => !field.manual && field.type !== 'file_upload').map(field => field.key) : [],
            write_authority: false } : null,
        execution_batches: records.map(summary),
        review: app.review ? { ready: app.review.ready, reviewed_at: app.review.reviewed_at,
            portal_persistence: app.review.portal_persistence, blockers: app.review.blockers ?? [] } : null,
        resume: material ? { id: material.id, approved: material.approved, sha256: material.asset?.sha256 ?? null,
            name: material.asset?.name ?? null, bytes: material.asset?.bytes ?? null } : null,
        authentication: authenticationContext(store),
        next: '只读观察当前 next_batch；pending/unknown 先 recover。实际写入必须使用新的 checkpoint(prepare) 回执；完整最终核对用 context(scope=application)。'
    };
}
