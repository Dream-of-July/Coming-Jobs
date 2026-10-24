import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFixture, startBatch, approveBatch, executePlan } from './batch-helpers.mjs';
import { call } from '../src/service.mjs';
import { hash } from '../src/core.mjs';

const fingerprintKeys = ['application_id', 'job_id', 'job_hash', 'job_url', 'origin', 'plan_hash', 'fields', 'agreements', 'manual', 'parsed', 'resume', 'gates_digest', 'rules'];
function storedLegacyGrant(e, batch, { partial = false } = {}) {
    const current = e.store.get('apply_batch', batch.id), grant = e.store.get('apply_grant', current.grant_id);
    const items = structuredClone(grant.items).map(item => {
        delete item.resume.review_digest;
        if (!partial) for (const field of item.fields) if (field.material) delete field.material.review_digest;
        item.fingerprint = hash(Object.fromEntries(fingerprintKeys.map(key => [key, item[key]])));
        return item;
    });
    return e.store.put('apply_grant', grant.id, { ...grant, items });
}
const clear = (e, batch, application) => call(e.store, 'jobos1_apply_batch', { operation: 'clear_submit', batch_id: batch.id,
    application_id: application.app.id, session_id: 'synthetic-session' });

test('an unchanged legacy approval can clear submission without changing its scope or inventing a prior review digest', t => {
    const e = batchFixture(t, 1), batch = startBatch(e); approveBatch(e, batch);
    executePlan(e, e.apps[0]);
    const grant = storedLegacyGrant(e, batch), result = clear(e, batch, e.apps[0]);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(result.data.action, 'click_once_then_read_result');
    assert.deepEqual(e.store.get('apply_grant', grant.id), grant);
    assert.equal(e.store.get('apply_batch', batch.id).paused_items?.length ?? 0, 0);
});

test('scoped reapproval retains an unchanged legacy item with its original fingerprint and expiry', t => {
    const e = batchFixture(t, 2), batch = startBatch(e); approveBatch(e, batch);
    const original = storedLegacyGrant(e, batch), retainedBefore = original.items[1];
    const sheet = e.run('apply_batch', { operation: 'sheet', batch_id: batch.id, application_id: e.apps[0].app.id });
    const result = e.run('apply_batch', { operation: 'approve', batch_id: batch.id, application_id: e.apps[0].app.id,
        sheet_code: sheet.code, sheet_issued_at: sheet.issued_at, session_id: 'synthetic-session',
        reply: `批准 ${sheet.code} 全部`, confirmed: true, user_ref: 'Synthetic scoped renewal' });
    const retained = result.grant.items.find(item => item.application_id === retainedBefore.application_id);
    assert(retained, 'the unchanged item must remain approved');
    assert.deepEqual(retained, retainedBefore);
    assert(!Object.hasOwn(retained.resume, 'review_digest'));
    assert(Object.hasOwn(result.grant.items[0].resume, 'review_digest'), 'the newly approved item uses the new format');
    executePlan(e, e.apps[1]);
    assert.equal(clear(e, batch, e.apps[1]).ok, true);
});

test('legacy fingerprint compatibility still rejects a current source-alias correction', t => {
    const e = batchFixture(t, 1), batch = startBatch(e); approveBatch(e, batch);
    const application = e.apps[0]; executePlan(e, application); storedLegacyGrant(e, batch);
    e.run('remember', { mode: 'user_statement', confirmed: true, user_ref: 'Synthetic current correction', facts: [
        { key: 'full_name', value: 'Synthetic corrected name', purposes: ['form'], scope: `company:${application.app.company}` }
    ] });
    const result = clear(e, batch, application);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'fact_changed');
    assert.equal(e.store.all('submit_attempt').length, 0);
});

test('a partially missing review digest cannot downgrade a new approval to the legacy comparison', t => {
    const e = batchFixture(t, 1), batch = startBatch(e); approveBatch(e, batch);
    executePlan(e, e.apps[0]); storedLegacyGrant(e, batch, { partial: true });
    const result = clear(e, batch, e.apps[0]);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'approved_item_changed');
    assert.equal(e.store.all('submit_attempt').length, 0);
});
