import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFixture, startBatch, approveBatch, executePlan } from './batch-helpers.mjs';
import { call } from '../src/service.mjs';
import { Store } from '../src/store.mjs';
import { hash, now } from '../src/core.mjs';

const session = 'synthetic-session';
const operation = (e, b, operation, extra = {}) => e.run('apply_batch', { operation, batch_id: b.id, session_id: session, ...extra });
const defer = (e, b, item, extra = {}) => operation(e, b, 'defer', {
    application_id: item.application_id, claim_id: item.claim_id, reason: 'portal_unavailable', retry_after_ms: 1000, ...extra
});
function makeDue(e, b, applicationId) {
    const saved = e.store.get('apply_batch', b.id), item = saved.queue.items[applicationId];
    e.store.put('apply_batch', b.id, { ...saved, queue: { ...saved.queue, items: {
        ...saved.queue.items, [applicationId]: { ...item, retry_at: '2000-01-01T00:00:00Z' }
    } } });
}

test('default mode fills ten drafts before a grouped user submission handoff', t => {
    const e = batchFixture(t, 10, { batch_submit: null }), b = startBatch(e);
    const grant = approveBatch(e, b).grant;
    assert.equal(grant.mode, 'prefill_only');
    for (const application of e.apps) {
        const claimed = operation(e, b, 'next');
        assert.equal(claimed.item.application_id, application.app.id);
        assert.equal(claimed.item.next.action, 'fill_groups');
        assert.equal(executePlan(e, application).ready, true);
        const clear = call(e.store, 'jobos1_apply_batch', { operation: 'clear_submit', batch_id: b.id, application_id: application.app.id, session_id: session });
        assert.equal(clear.error.code, 'submit_disabled');
    }
    const finished = operation(e, b, 'next');
    assert.equal(finished.item, null);
    assert.equal(finished.queue.state, 'ready_for_user');
    assert.equal(finished.queue.ready_application_ids.length, 10);
    assert.equal(finished.flow.can_auto_continue, false);
    assert.equal(finished.flow.next.action, 'human_submit');
    assert.equal(e.store.all('submit_attempt').length, 0);
});

test('a failed portal defers only its claim and leaves another application runnable', t => {
    const e = batchFixture(t, 2), b = startBatch(e); approveBatch(e, b);
    const before = hash(e.apps.map(item => e.store.get('application', item.app.id).authorization));
    const first = operation(e, b, 'next').item;
    const deferred = defer(e, b, first, { error_code: 'Raw exception with private details' });
    const failed = deferred.queue.items.find(item => item.application_id === first.application_id);
    assert.equal(failed.state, 'deferred');
    assert.equal(failed.last_error, 'host_error');
    assert.equal(failed.attempts, 1);
    assert.equal(operation(e, b, 'next').item.application_id, e.apps[1].app.id);
    assert.equal(hash(e.apps.map(item => e.store.get('application', item.app.id).authorization)), before);
    assert(!JSON.stringify(e.store.get('apply_batch', b.id).queue).includes('Raw exception'));
});

test('a partial failure receipt can be saved before deferring its original fenced claim', t => {
    const e = batchFixture(t, 2), b = startBatch(e); approveBatch(e, b);
    const s = e.apps[0], claimed = operation(e, b, 'next').item;
    const base = { application_id: s.app.id, plan_hash: s.plan.content_hash, session_id: session,
        portal_url: s.plan.origin, page_fingerprint: s.plan.page_fingerprint, observed_at: now(), batch_number: 1,
        controls: s.plan.groups.flatMap(group => group.fields).map(field => ({ key: field.key, type: field.type, required: field.required })),
        protected_fields: [{ key: 'name', value: '', read_state: 'known' }]
    };
    e.run('checkpoint', { ...base, phase: 'prepare', groups: [{ key: 'resume', fields: [{ key: 'cv', read_state: 'known', file_count: 0 }] }] });
    const receipt = e.run('checkpoint', { ...base, phase: 'complete', groups: [{ key: 'resume', fields: [{ key: 'cv', read_state: 'unreadable' }] }] });
    assert.equal(receipt.state, 'unknown');
    const deferred = defer(e, b, claimed, { reason: 'readback_failed' });
    assert.equal(deferred.queue.items[0].phase, 'recover_fields');
    assert.equal(deferred.queue.items[0].state, 'deferred');
    assert.equal(operation(e, b, 'next').item.application_id, e.apps[1].app.id);
});

test('an original claim cannot defer a draft that has since become ready', t => {
    const e = batchFixture(t, 1, { batch_submit: null }), b = startBatch(e); approveBatch(e, b);
    const claimed = operation(e, b, 'next').item;
    executePlan(e, e.apps[0]);
    const late = call(e.store, 'jobos1_apply_batch', { operation: 'defer', batch_id: b.id, session_id: session,
        application_id: claimed.application_id, claim_id: claimed.claim_id, reason: 'interrupted' });
    assert.equal(late.error.code, 'queue_claim_changed');
    assert.equal(operation(e, b, 'next').queue.state, 'ready_for_user');
});

test('retries respect backoff and a three-attempt budget without replaying live claims', t => {
    const e = batchFixture(t, 1), b = startBatch(e); approveBatch(e, b);
    for (let attempt = 1; attempt <= 3; attempt++) {
        const claimed = operation(e, b, 'next');
        assert.equal(claimed.item.attempts, attempt);
        const duplicate = operation(e, b, 'next');
        assert.equal(duplicate.item, null);
        assert.equal(duplicate.flow.can_auto_continue, false);
        assert.equal(duplicate.queue.active.claim_id, claimed.item.claim_id);
        defer(e, b, claimed.item);
        const waiting = operation(e, b, 'retry', { application_id: claimed.item.application_id });
        assert.equal(waiting.item, null);
        assert.equal(waiting.queue.items[0].attempts, attempt);
        assert.equal(operation(e, b, 'next').item, null);
        makeDue(e, b, claimed.item.application_id);
        operation(e, b, 'retry', { application_id: claimed.item.application_id });
    }
    const capped = operation(e, b, 'resume');
    assert.equal(capped.item, null);
    assert.equal(capped.queue.items[0].state, 'blocked');
    assert.equal(capped.queue.items[0].attempts, 3);
    assert.equal(capped.flow.can_auto_continue, false);
});

test('unknown submission outcomes receive bounded read-only verification, never another submit', t => {
    const e = batchFixture(t, 1), b = startBatch(e); approveBatch(e, b);
    const app = e.store.get('application', e.apps[0].app.id);
    e.store.put('application', app.id, { ...app, stage: 'unknown', submit_attempt_id: 'synthetic-pending-submit' });
    for (let attempt = 1; attempt <= 3; attempt++) {
        const claimed = operation(e, b, 'next').item;
        assert.equal(claimed.next.action, 'verify_outcome');
        assert.equal(claimed.next.read_only, true);
        assert.equal(claimed.attempts, attempt);
        defer(e, b, claimed, { reason: 'outcome_unknown' });
        // Repeated unknown observations do not establish a new submission or
        // replenish the verification budget.
        const current = e.store.get('application', app.id);
        e.store.put('application', app.id, { ...current, last_observation_at: now(), observations: [...current.observations, `unknown-${attempt}`] });
        makeDue(e, b, app.id);
    }
    const capped = operation(e, b, 'next');
    assert.equal(capped.queue.items[0].state, 'unresolved_outcome');
    assert.equal(capped.flow.can_auto_continue, false);
    assert.equal(e.store.get('application', app.id).stage, 'unknown');
    assert.equal(e.store.all('submit_attempt').length, 0);
});

test('restart preserves the live owner and expired claims recover pending execution before writes', t => {
    const e = batchFixture(t, 1), b = startBatch(e); approveBatch(e, b);
    const s = e.apps[0], first = operation(e, b, 'next').item;
    e.run('checkpoint', { application_id: s.app.id, plan_hash: s.plan.content_hash, session_id: session,
        portal_url: s.plan.origin, page_fingerprint: s.plan.page_fingerprint, observed_at: now(), phase: 'prepare', batch_number: 1,
        groups: [{ key: 'resume', fields: [{ key: 'cv', read_state: 'known', file_count: 0 }] }],
        protected_fields: [{ key: 'name', value: '', read_state: 'known' }]
    });
    e.store.close();
    const reopened = new Store(e.dir); t.after(() => reopened.close());
    const resumed = call(reopened, 'jobos1_apply_batch', { operation: 'resume', batch_id: b.id, session_id: session });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.data.item, null);
    assert.equal(resumed.data.queue.active.claim_id, first.claim_id);
    const saved = reopened.get('apply_batch', b.id);
    reopened.put('apply_batch', b.id, { ...saved, queue: { ...saved.queue, active: { ...saved.queue.active, expires_at: '2000-01-01T00:00:00Z' } } });
    const recovery = call(reopened, 'jobos1_apply_batch', { operation: 'resume', batch_id: b.id, session_id: session });
    assert.equal(recovery.ok, true, JSON.stringify(recovery));
    assert.equal(recovery.data.item.next.action, 'recover_fields');
    assert.equal(recovery.data.item.next.read_only, true);
    assert.equal(recovery.data.item.next.args.phase, 'recover');
    assert.equal(recovery.data.item.next.args.batch_number, 1);
    assert.equal(recovery.data.queue.active.claim_id, recovery.data.item.claim_id);
    const duplicate = call(reopened, 'jobos1_apply_batch', { operation: 'next', batch_id: b.id, session_id: session });
    assert.equal(duplicate.data.item, null);
    assert.equal(duplicate.data.queue.active.claim_id, recovery.data.item.claim_id);
});

test('an expired field authorization is renewed locally before pending execution recovery', t => {
    const e = batchFixture(t, 1), b = startBatch(e); approveBatch(e, b);
    const s = e.apps[0]; operation(e, b, 'next');
    e.run('checkpoint', { application_id: s.app.id, plan_hash: s.plan.content_hash, session_id: session,
        portal_url: s.plan.origin, page_fingerprint: s.plan.page_fingerprint, observed_at: now(), phase: 'prepare', batch_number: 1,
        groups: [{ key: 'resume', fields: [{ key: 'cv', read_state: 'known', file_count: 0 }] }],
        protected_fields: [{ key: 'name', value: '', read_state: 'known' }]
    });
    const saved = e.store.get('apply_batch', b.id), app = e.store.get('application', s.app.id);
    e.store.put('apply_batch', b.id, { ...saved, queue: { ...saved.queue, active: { ...saved.queue.active, expires_at: '2000-01-01T00:00:00Z' } } });
    e.store.put('application', app.id, { ...app, authorization: { ...app.authorization, expires_at: '2000-01-01T00:00:00Z' } });
    const renewal = operation(e, b, 'resume').item;
    assert.equal(renewal.next.action, 'renew_lease');
    e.run('authorize', renewal.next.args);
    const recovery = operation(e, b, 'next');
    assert.equal(recovery.item.next.action, 'recover_fields');
    assert.equal(recovery.item.next.read_only, true);
    assert.equal(recovery.queue.active.claim_id, recovery.item.claim_id);
});

test('a verified prefill draft remains a user handoff after grant expiry, while changed facts invalidate it', t => {
    const e = batchFixture(t, 1, { batch_submit: null }), b = startBatch(e); approveBatch(e, b);
    const s = e.apps[0]; executePlan(e, s);
    const stored = e.store.get('apply_batch', b.id), grant = e.store.get('apply_grant', stored.grant_id);
    e.store.put('apply_grant', grant.id, { ...grant, expires_at: '2000-01-01T00:00:00Z' });
    assert.equal(operation(e, b, 'next').queue.state, 'ready_for_user');
    const name = e.store.all('fact').find(fact => fact.key === 'name');
    e.store.put('fact', name.id, { ...name, value: 'Synthetic corrected name' });
    const changed = operation(e, b, 'next');
    assert.equal(changed.item.next.action, 'update_plan');
    assert.equal(changed.queue.ready_application_ids.length, 0);
});

test('verified regional progress keeps a healthy form selected and a failure yields to the next job', t => {
    const e = batchFixture(t, 2), b = startBatch(e); approveBatch(e, b);
    const first = operation(e, b, 'next').item, s = e.apps[0];
    e.run('checkpoint', { application_id: s.app.id, plan_hash: s.plan.content_hash, session_id: session,
        portal_url: s.plan.origin, page_fingerprint: s.plan.page_fingerprint, observed_at: now(), portal_saved: true,
        groups: [{ key: 'identity', fields: [{ key: 'name', value: '陈同学', read_state: 'known' }] }]
    });
    const continued = operation(e, b, 'next').item;
    assert.equal(continued.application_id, first.application_id);
    assert.notEqual(continued.claim_id, first.claim_id);
    assert.equal(continued.attempts, 1);
    defer(e, b, continued);
    assert.equal(operation(e, b, 'next').item.application_id, e.apps[1].app.id);
});

test('claim mutations require the original host/session and reject a stale failure receipt', t => {
    const e = batchFixture(t, 2), b = startBatch(e); approveBatch(e, b);
    const first = operation(e, b, 'next').item;
    const rejected = call(e.store, 'jobos1_apply_batch', { operation: 'resume', batch_id: b.id, session_id: 'different-session' });
    assert.equal(rejected.error.code, 'batch_session_mismatch');
    executePlan(e, e.apps[0]);
    const second = operation(e, b, 'next').item;
    assert.equal(second.application_id, e.apps[1].app.id);
    const stale = call(e.store, 'jobos1_apply_batch', { operation: 'defer', batch_id: b.id, session_id: session,
        application_id: first.application_id, claim_id: first.claim_id, reason: 'interrupted' });
    assert.equal(stale.error.code, 'queue_claim_changed');
    assert.equal(e.store.get('apply_batch', b.id).queue.active.claim_id, second.claim_id);
    const previousHost = process.env.JOBOS_HOST;
    try {
        process.env.JOBOS_HOST = 'claude';
        assert.equal(call(e.store, 'jobos1_apply_batch', { operation: 'next', batch_id: b.id, session_id: session }).error.code, 'batch_session_mismatch');
    } finally { if (previousHost === undefined) delete process.env.JOBOS_HOST; else process.env.JOBOS_HOST = previousHost; }
});

test('human queues and existing application handoffs do not block other jobs', t => {
    const e = batchFixture(t, 3), b = startBatch(e); approveBatch(e, b);
    e.run('apply_batch', { operation: 'human_queue', batch_id: b.id,
        steps: [{ application_id: e.apps[0].app.id, kind: 'login', prompt: 'Synthetic login action' }] });
    e.run('handoff', { operation: 'open', application_id: e.apps[1].app.id, kind: 'captcha', prompt: 'Synthetic human verification' });
    const claimed = operation(e, b, 'next');
    assert.equal(claimed.item.application_id, e.apps[2].app.id);
    assert.equal(claimed.queue.counts.waiting_user, 2);
});

test('scoped sheets and healthy approvals survive another application missing its resume asset', t => {
    const e = batchFixture(t, 2), b = startBatch(e), broken = e.store.get('material', e.apps[0].material.id);
    e.store.put('material', broken.id, { ...broken, asset: { ...broken.asset, relative_path: '0'.repeat(64) + '.pdf' } });
    const scoped = e.run('apply_batch', { operation: 'sheet', batch_id: b.id, application_id: e.apps[1].app.id });
    assert.equal(scoped.items.length, 1);
    assert.deepEqual(scoped.items[0].blockers, []);
    const full = e.run('apply_batch', { operation: 'sheet', batch_id: b.id });
    assert.deepEqual(full.items[0].blockers, ['item_unavailable']);
    assert.deepEqual(full.items[1].blockers, []);
    const approved = approveBatch(e, b, [2]);
    assert.deepEqual(approved.grant.items.map(item => item.application_id), [e.apps[1].app.id]);
});

test('revoked batch status cannot advertise runnable work or an old writer claim', t => {
    const e = batchFixture(t, 1), b = startBatch(e); approveBatch(e, b); operation(e, b, 'next');
    e.run('apply_batch', { operation: 'revoke', batch_id: b.id, confirmed: true, user_ref: 'Synthetic cancellation' });
    const status = e.run('apply_batch', { operation: 'status', batch_id: b.id });
    assert.equal(status.queue.state, 'revoked');
    assert.equal(status.queue.active, null);
    assert.equal(status.queue.can_auto_continue, false);
    assert.equal(status.queue.items[0].state, 'inactive');
});
