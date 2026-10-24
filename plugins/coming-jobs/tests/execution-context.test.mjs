import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFixture, startBatch, approveBatch, executePlan } from './batch-helpers.mjs';
import { call } from '../src/service.mjs';

test('execution context returns only the next current batch and excludes unrelated history', t => {
    const e = batchFixture(t, 2), current = e.apps[0];
    e.store.put('execution_batch', 'historical-batch', { application_id: current.app.id, plan_id: 'old-plan', number: 1,
        state: 'complete', observations: [{ key: 'old-answer', value: 'HISTORICAL_SENTINEL'.repeat(2000) }] });
    e.run('remember', { mode: 'user_statement', confirmed: true, user_ref: 'Synthetic private information', facts: [{ key: 'unrelated.personal.note', value: 'UNRELATED_PRIVATE_SENTINEL' }] });
    const result = call(e.store, 'jobos1_context', { scope: 'execution', application_id: current.app.id });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data;
    assert.equal(data.application.id, current.app.id);
    assert.equal(data.plan.content_hash, current.plan.content_hash);
    assert.equal(data.next_batch.number, 1);
    assert.equal(data.next_batch.kind, 'file_upload');
    assert.equal(data.next_batch.targets[0].material.sha256, current.material.asset.sha256);
    assert.equal(data.execution_batches.length, 0);
    assert(!JSON.stringify(data).includes('HISTORICAL_SENTINEL'));
    assert(!JSON.stringify(data).includes('UNRELATED_PRIVATE_SENTINEL'));
    assert(!JSON.stringify(data).includes(e.apps[1].app.id));
    assert(!data.facts && !data.materials && !data.drafts);
});

test('execution context preserves recovery evidence and never exposes a new write receipt', t => {
    const e = batchFixture(t, 1), current = e.apps[0], b = startBatch(e);
    approveBatch(e, b);
    const spec = current.plan.groups.find(group => group.fields.some(field => field.type === 'file_upload'));
    const file = spec.fields[0];
    const receipt = e.run('checkpoint', { phase: 'prepare', application_id: current.app.id, plan_hash: current.plan.content_hash,
        session_id: 'synthetic-session', portal_url: current.plan.origin, page_fingerprint: current.plan.page_fingerprint,
        observed_at: new Date().toISOString(), batch_number: 1,
        protected_fields: [{ key: 'name', value: '', read_state: 'known' }],
        groups: [{ key: spec.key, fields: [{ key: file.key, file_count: 0, read_state: 'known' }] }] });
    const count = e.store.db.prepare('SELECT count(*) n FROM audit').get().n;
    const view = e.run('context', { scope: 'execution', application_id: current.app.id });
    assert.equal(e.store.db.prepare('SELECT count(*) n FROM audit').get().n, count);
    assert.equal(view.next_batch.checkpoint_id, receipt.id);
    assert.equal(view.next_batch.recovery_required, true);
    assert.equal(view.next_batch.before[0].file_count, 0);
    assert.equal(view.next_batch.write_authority, false);
});

test('finished execution context reports no next field batch', t => {
    const e = batchFixture(t, 1), b = startBatch(e);
    approveBatch(e, b);
    executePlan(e, e.apps[0]);
    const view = e.run('context', { scope: 'execution', application_id: e.apps[0].app.id });
    assert.equal(view.next_batch, null);
    assert.equal(view.review.ready, true);
    assert(view.execution_batches.every(batch => batch.state === 'complete'));
});

test('execution scope rejects missing application ID with a concrete correction', t => {
    const e = batchFixture(t, 1);
    const result = call(e.store, 'jobos1_context', { scope: 'execution' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'application_required');
});
