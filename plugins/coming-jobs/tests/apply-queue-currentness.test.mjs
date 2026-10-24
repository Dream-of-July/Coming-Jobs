import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFixture, startBatch, approveBatch, executePlan } from './batch-helpers.mjs';
import { call } from '../src/service.mjs';

test('a company-specific alias correction invalidates queue readiness without blocking another ready draft', t => {
    const e = batchFixture(t, 2, { batch_submit: null }), batch = startBatch(e);
    approveBatch(e, batch);
    for (const application of e.apps) assert.equal(executePlan(e, application).ready, true);
    const changed = e.apps[0], healthy = e.apps[1];
    e.run('remember', { mode: 'user_statement', confirmed: true, user_ref: 'Synthetic company correction', facts: [
        { key: 'full_name', value: 'Synthetic corrected name', purposes: ['form'], scope: `company:${changed.app.company}` }
    ] });
    const review = call(e.store, 'jobos1_review', { application_id: changed.app.id, portal_url: changed.plan.origin });
    assert.equal(review.error?.code, 'fact_changed');
    const queued = e.run('apply_batch', { operation: 'next', batch_id: batch.id, session_id: 'synthetic-session' });
    assert.equal(queued.queue.items.find(item => item.application_id === changed.app.id).phase, 'update_plan');
    assert.equal(queued.item.application_id, changed.app.id);
    assert.deepEqual(queued.queue.ready_application_ids, [healthy.app.id]);
    assert.equal(queued.queue.items.find(item => item.application_id === healthy.app.id).state, 'ready_for_user');
    assert.equal(e.store.all('submit_attempt').length, 0);
});

test('a saved draft whose attachment is no longer valid is isolated by the same plan guard as review', t => {
    const e = batchFixture(t, 2, { batch_submit: null }), batch = startBatch(e);
    approveBatch(e, batch);
    for (const application of e.apps) assert.equal(executePlan(e, application).ready, true);
    const changed = e.apps[0], healthy = e.apps[1], plan = e.store.get('plan', changed.plan.id);
    // Simulate an independently missing attachment reference in a restored plan;
    // the healthy application's asset and recorded review remain untouched.
    e.store.put('plan', plan.id, { ...plan, groups: plan.groups.map(group => ({ ...group,
        fields: group.fields.map(field => field.material ? { ...field, material: { ...field.material, relative_path: '0'.repeat(64) + '.pdf' } } : field)
    })) });
    const review = call(e.store, 'jobos1_review', { application_id: changed.app.id, portal_url: plan.origin });
    assert.equal(review.error?.code, 'ENOENT');
    const queued = e.run('apply_batch', { operation: 'next', batch_id: batch.id, session_id: 'synthetic-session' });
    assert.equal(queued.item.application_id, changed.app.id);
    assert.equal(queued.item.phase, 'update_plan');
    assert.deepEqual(queued.queue.ready_application_ids, [healthy.app.id]);
});

test('a repair claim for an invalidated stored review can defer without blocking an unfinished job', t => {
    const e = batchFixture(t, 2, { batch_submit: null }), batch = startBatch(e);
    approveBatch(e, batch);
    const changed = e.apps[0], healthy = e.apps[1];
    assert.equal(executePlan(e, changed).ready, true);
    e.run('remember', { mode: 'user_statement', confirmed: true, user_ref: 'Synthetic scoped correction', facts: [
        { key: 'full_name', value: 'Synthetic corrected name', purposes: ['form'], scope: `company:${changed.app.company}` }
    ] });
    const repair = e.run('apply_batch', { operation: 'next', batch_id: batch.id, session_id: 'synthetic-session' }).item;
    assert.equal(repair.phase, 'update_plan');
    e.run('apply_batch', { operation: 'defer', batch_id: batch.id, session_id: 'synthetic-session',
        application_id: changed.app.id, claim_id: repair.claim_id, reason: 'portal_unavailable', retry_after_ms: 1000 });
    const continued = e.run('apply_batch', { operation: 'next', batch_id: batch.id, session_id: 'synthetic-session' });
    assert.equal(continued.item.application_id, healthy.app.id);
    assert.equal(continued.item.phase, 'fill_groups');
});
