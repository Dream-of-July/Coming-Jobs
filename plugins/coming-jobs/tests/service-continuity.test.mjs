import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, seedApplication } from './helpers.mjs';
import { call } from '../src/service.mjs';

test('a guidance failure after commit cannot turn a saved fact into a failed mutation', t => {
    const e = environment(t), { app } = seedApplication(e);
    e.store.put('plan', 'broken-plan', { application_id: app.id, groups: null });
    e.store.put('application', app.id, { ...e.store.get('application', app.id), plan_id: 'broken-plan' });
    const result = call(e.store, 'jobos1_remember', { mode: 'user_statement', confirmed: true,
        user_ref: 'Synthetic correction', facts: [{ key: 'github', value: 'https://github.com/synthetic-candidate' }] });
    assert(e.store.all('fact').some(fact => fact.key === 'github' && fact.value === 'https://github.com/synthetic-candidate'));
    assert.equal(result.ok, true, 'committed data must not be reported as a failed write');
    assert.equal(result.flow.status, 'unavailable');
    assert.equal(result.flow.next.action, 'refresh_context');
    assert.equal(result.flow.can_auto_continue, false);
});
