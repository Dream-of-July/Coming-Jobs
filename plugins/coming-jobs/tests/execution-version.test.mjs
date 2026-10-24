import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFixture } from './batch-helpers.mjs';
import { itinerary } from '../src/execution.mjs';
import { hash } from '../src/core.mjs';

function withAgreement(t) {
    const e = batchFixture(t, 1), item = e.apps[0];
    const groups = item.plan.groups.map(group => ({ ...group, fields: group.fields.map(({material, local_file, evidence_versions, value_kind, manual, ...field}) => field) }));
    groups[0].fields.push({ key: 'privacy', label: 'Privacy', type: 'agreement', required: true, value: true,
        text_hash: hash('Synthetic privacy terms'), agreement_title: 'Privacy', excerpt: 'Synthetic privacy terms' });
    return e.run('plan', { application_id: item.app.id, portal_url: item.plan.origin, page_fingerprint: 'synthetic-agreement', groups });
}

test('new plans give an observed agreement its own execution step', t => {
    const { plan, batches } = withAgreement(t);
    assert.equal(plan.execution_version, 2);
    assert.deepEqual(batches.map(batch => batch.kind), ['file_upload', 'ordinary', 'agreement']);
    assert.deepEqual(batches.find(batch => batch.kind === 'ordinary').field_keys, ['name']);
    assert.deepEqual(batches.find(batch => batch.kind === 'agreement').field_keys, ['privacy']);
});

test('legacy plans keep their original checkpoint numbers after upgrade', t => {
    const { plan } = withAgreement(t), { execution_version, ...legacy } = plan;
    const batches = itinerary(legacy);
    assert.deepEqual(batches.map(batch => batch.kind), ['file_upload', 'ordinary']);
    assert.deepEqual(batches[1].field_keys, ['name', 'privacy']);
    assert.deepEqual(batches.map(batch => batch.number), [1, 2]);
});
