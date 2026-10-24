import test from 'node:test';
import assert from 'node:assert/strict';
import { fillGroup } from '../src/browser.mjs';
import { fieldDigest } from '../src/authorization.mjs';
import { hash } from '../src/core.mjs';

async function attempt(readAgreement) {
    const origin = 'https://jobs.example.com';
    const field = { key: 'privacy', label: 'Privacy', type: 'agreement', required: true, value: true,
        text_hash: hash('Synthetic approved terms'), agreement_title: 'Privacy', excerpt: 'Synthetic approved terms' };
    let writes = 0, checked = false;
    try {
        const result = await fillGroup({ url: async () => origin }, { key: 'terms', fields: [field] }, {
            origin, authorization: { origin, expires_at: new Date(Date.now() + 60000).toISOString(), field_grants: { privacy: fieldDigest(field) } },
            saveBefore: async () => {}, saveAfter: async () => {},
            readField: async () => ({ key: 'privacy', value: checked, read_state: 'known' }),
            writeField: async () => { checked = true; writes++; }, readAgreement
        });
        return { result, writes };
    } catch (error) { return { error, writes }; }
}

test('agreement writes require a fresh actual text observation', async () => {
    const value = await attempt();
    assert.equal(value.error?.code, 'agreement_observation_required');
    assert.equal(value.writes, 0);
});

test('changed agreement text blocks the write even when checkbox content was approved', async () => {
    const value = await attempt(async () => ({ text: 'Synthetic changed terms' }));
    assert.equal(value.error?.code, 'agreement_changed');
    assert.equal(value.writes, 0);
});

test('exactly observed approved agreement can use the native host adapter', async () => {
    const value = await attempt(async () => ({ text: 'Synthetic approved terms' }));
    assert(!value.error, value.error?.message);
    assert.equal(value.writes, 1);
    assert.equal(value.result.fields[0].value, true);
});
