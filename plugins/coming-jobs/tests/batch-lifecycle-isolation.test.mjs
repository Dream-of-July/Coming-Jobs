import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFixture, startBatch, approveBatch, executePlan } from './batch-helpers.mjs';
import { call } from '../src/service.mjs';
import { now } from '../src/core.mjs';

function submitObserved(e, batch, item) {
    assert.equal(executePlan(e, item).ready, true);
    e.run('apply_batch', { operation: 'clear_submit', batch_id: batch.id, application_id: item.app.id, session_id: 'synthetic-session' });
    e.run('outcome', { application_id: item.app.id, source: 'official_portal', job_id: item.job.external_id,
        observation_ref: 'Synthetic official result', stage: 'submitted', observed_at: now() });
}

test('partial approved outcomes leave unapproved batch members available for later approval', t => {
    const e = batchFixture(t, 3), batch = startBatch(e);
    approveBatch(e, batch, [1]);
    submitObserved(e, batch, e.apps[0]);
    assert.equal(e.store.get('apply_batch', batch.id).state, 'active');
    assert.equal(e.store.get('settings', 'active_apply_batch').batch_id, batch.id);
    const sheet = e.run('apply_batch', { operation: 'sheet', batch_id: batch.id, application_id: e.apps[1].app.id });
    const approved = call(e.store, 'jobos1_apply_batch', { operation: 'approve', batch_id: batch.id,
        application_id: e.apps[1].app.id, session_id: 'synthetic-session', sheet_code: sheet.code,
        sheet_issued_at: sheet.issued_at, reply: `批准 ${sheet.code} 全部`, confirmed: true, user_ref: 'Synthetic second approval' });
    assert.equal(approved.ok, true, JSON.stringify(approved.error));
    assert.equal(e.store.get('application', e.apps[2].app.id).stage, 'preparing');
});

test('completing an older batch preserves the currently active other batch', t => {
    const e = batchFixture(t, 2);
    const first = startBatch(e, { application_ids: [e.apps[0].app.id] });
    approveBatch(e, first);
    const second = startBatch(e, { application_ids: [e.apps[1].app.id] });
    submitObserved(e, first, e.apps[0]);
    assert.equal(e.store.get('apply_batch', first.id).state, 'complete');
    assert.equal(e.store.get('settings', 'active_apply_batch').batch_id, second.id);
    assert.equal(e.store.get('apply_batch', second.id).state, 'active');
});

test('Claude upload preparation isolates an unavailable file and starts healthy applications', t => {
    const previous = process.env.JOBOS_HOST;
    process.env.JOBOS_HOST = 'claude';
    t.after(() => previous === undefined ? delete process.env.JOBOS_HOST : process.env.JOBOS_HOST = previous);
    const e = batchFixture(t, 2), broken = e.apps[0].material;
    e.store.put('material', broken.id, { ...e.store.get('material', broken.id), asset: { ...broken.asset, sha256: '0'.repeat(64) } });
    const started = call(e.store, 'jobos1_apply_batch', { operation: 'start', application_ids: e.apps.map(item => item.app.id), session_id: 'synthetic-session' });
    assert.equal(started.ok, true, JSON.stringify(started.error));
    assert.equal(started.data.state, 'active');
    assert.deepEqual(started.data.uploads.map(item => item.application_id), [e.apps[1].app.id]);
    assert.equal(started.data.upload_failures.length, 1);
    assert.equal(started.data.upload_failures[0].application_id, e.apps[0].app.id);
    assert.equal(started.data.upload_failures[0].action, 'repair_material');
    assert.match(started.data.upload_failures[0].code, /^[a-z][a-z0-9_]{0,79}$/);
    const sheet = e.run('apply_batch', { operation: 'sheet', batch_id: started.data.id });
    assert(sheet.items[0].blockers.length);
    assert.equal(sheet.items[1].blockers.length, 0);
    approveBatch(e, started.data, [2]);
    assert.equal(e.store.get('apply_batch', started.data.id).state, 'active');
});
