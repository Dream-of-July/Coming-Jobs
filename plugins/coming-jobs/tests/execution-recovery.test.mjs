import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, seedApplication, seedPlan, correctObservations } from './helpers.mjs';
import { now } from '../src/core.mjs';
import { call } from '../src/service.mjs';

function preparedTextBatch(t) {
    const e = environment(t), s = seedApplication(e), p = seedPlan(e, s);
    const protected_fields = [{ key: 'name', value: '', read_state: 'known' }, { key: 'school', value: '', read_state: 'known' }];
    const controls = p.groups.flatMap(group => group.fields).map(field => ({key:field.key,type:field.type,label:field.label,required:field.required}));
    const base = { controls, protected_fields, portal_saved:true, application_id: s.app.id, plan_hash: p.content_hash, session_id: 'session', portal_url: p.origin,
        page_fingerprint: p.page_fingerprint, observed_at: now(), batch_number: 1 };
    e.run('checkpoint', { ...base, phase: 'prepare', protected_fields: [{ key: 'name', value: '', read_state: 'known' }, { key: 'school', value: '', read_state: 'known' }],
        groups: [{ key: 'resume', fields: [{ key: 'cv', read_state: 'known', file_count: 0 }] }] });
    e.run('checkpoint', { ...base, phase: 'complete', groups: [{ key: 'resume', fields: correctObservations(s)[2].fields.map(field => ({ ...field,
        read_state: 'known', file_selected: true, parse_complete: true, attachment_associated: true, portal_saved: true })) }] });
    base.batch_number = 2;
    e.run('checkpoint', { ...base, phase: 'prepare', groups: [{ key: 'identity', fields: [{ key: 'name', value: 'original', read_state: 'known' }] }] });
    return { e, base };
}

test('recovery compares text values without mistaking added observation metadata for a user edit', t => {
    const { e, base } = preparedTextBatch(t);
    const result = e.run('checkpoint', { ...base, phase: 'recover', groups: [{ key: 'identity', fields: [{ key: 'name', value: 'original', read_state: 'known', selected: false }] }] });
    assert.equal(result.state, 'recovered');
    assert.deepEqual(result.retry_keys, ['name']);
    assert.deepEqual(result.conflicts, []);
});

test('a user edit between recovery and retry preparation cannot become a new overwrite baseline', t => {
    const { e, base } = preparedTextBatch(t);
    e.run('checkpoint', { ...base, phase: 'recover', groups: [{ key: 'identity', fields: [{ key: 'name', value: 'original', read_state: 'known' }] }] });
    const result = call(e.store, 'jobos1_checkpoint', { ...base, phase: 'prepare', groups: [{ key: 'identity', fields: [{ key: 'name', value: 'user edit', read_state: 'known' }] }] });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'user_conflict');
    assert.equal(e.store.all('execution_batch').find(batch => batch.number === 2).state, 'recovered');
});
