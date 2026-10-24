import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { batchFixture, startBatch } from './batch-helpers.mjs';
import { seedJob, reviewedFitFields } from './helpers.mjs';
import { createApplication } from '../src/jobs.mjs';
import { jobOpportunity } from '../src/opportunities.mjs';
import { call } from '../src/service.mjs';
import { now } from '../src/core.mjs';

function aliasFixture(t, { secondMode = 'demo' } = {}) {
    const e = batchFixture(t, 1), company = e.store.all('company')[0], alias = 'Synthetic registered company alias';
    e.run('daily', { operation: 'company', company: { company_id: company.id, name: company.name, aliases: [alias] } });
    const job = seedJob(e, 2, secondMode, { company: alias });
    const evidence = e.store.all('fact').find(f => f.key === 'project.anchor'), name = e.store.all('fact').find(f => f.key === 'name');
    e.run('jobs', { operation: 'assess', assessments: [{ job_id: job.id, job_hash: job.content_hash,
        mappings: job.requirements.map(r => ({ requirement_id: r.id, relation: 'direct', evidence_ids: [evidence.id], reason: 'Synthetic evidence' })),
        advantages: [], gaps: [], reason: 'Synthetic eligible', ...reviewedFitFields(evidence.id) }] });
    const app = createApplication(e.store, job.id, 'Synthetic target selection');
    const material = e.run('material', { operation: 'register', file: path.join(e.dir, 'resume.pdf'), kind: 'resume',
        job_id: job.id, authorized: true, user_ref: 'Synthetic baseline reuse' });
    e.run('material', { operation: 'bind', application_id: app.id, material_id: material.id });
    const plan = e.run('plan', { application_id: app.id, portal_url: 'https://jobs.example.com/application', page_fingerprint: 'synthetic-v1',
        groups: [{ key: 'identity', label: 'Identity', required: true, fields: [{ key: 'name', label: '姓名', type: 'free_text',
            required: true, value: '陈同学', source: { fact_id: name.id, transform: 'identity' } }] },
        { key: 'resume', label: 'Resume', required: true, fields: [{ key: 'cv', label: 'Resume', type: 'file_upload', required: true, value: material.id }] }] }).plan;
    e.apps.push({ app, job, material, plan });
    return { ...e, company };
}

function refreshLimit(e, limit) {
    const job = e.apps[0].job;
    return e.run('daily', { operation: 'opportunity', company_id: e.company.id, track: job.track, campaign: job.campaign,
        limit, source: 'official', source_ref: 'https://example.com/synthetic-refreshed-rules', observed_at: now() });
}

function approve(e, batch, applicationId) {
    const scope = applicationId ? { application_id: applicationId } : {};
    const sheet = e.run('apply_batch', { operation: 'sheet', batch_id: batch.id, ...scope });
    return call(e.store, 'jobos1_apply_batch', { operation: 'approve', batch_id: batch.id, sheet_code: sheet.code,
        sheet_issued_at: sheet.issued_at, session_id: 'synthetic-session', reply: `批准 ${sheet.code} 全部`,
        confirmed: true, user_ref: 'Synthetic quota-scoped approval', ...scope });
}

test('refreshed remaining allowance is shared by canonical company and its registered alias', t => {
    const e = aliasFixture(t); refreshLimit(e, 1);
    const quota = jobOpportunity(e.store, e.apps[0].job);
    assert.equal(quota.remaining, 1);
    assert.equal(quota.reserved, 2);
    const result = approve(e, startBatch(e));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'opportunity_unverified');
    assert.equal(e.store.all('apply_grant').length, 0);
    assert(e.apps.every(item => !e.store.get('application', item.app.id).authorization));
});

test('scoped approval counts retained approved aliases against the same remaining allowance', t => {
    const e = aliasFixture(t); refreshLimit(e, 1);
    const batch = startBatch(e), first = approve(e, batch, e.apps[0].app.id);
    assert.equal(first.ok, true, JSON.stringify(first.error));
    assert.equal(first.data.grant.items.length, 1, 'unused draft reservations do not consume the official remaining allowance');
    const second = approve(e, batch, e.apps[1].app.id);
    assert.equal(second.ok, false);
    assert.equal(second.error.code, 'opportunity_unverified');
    assert.equal(e.store.get('apply_grant', first.data.grant.id).state, 'active');
    assert.equal(e.store.get('apply_batch', batch.id).grant_id, first.data.grant.id);
    assert(!e.store.get('application', e.apps[1].app.id).authorization);
});

test('reserved drafts can be approved together when official remaining capacity covers their canonical company', t => {
    const e = aliasFixture(t); refreshLimit(e, 2);
    const result = approve(e, startBatch(e));
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.deepEqual(result.data.approved_numbers, [1, 2]);
    const quota = jobOpportunity(e.store, e.apps[0].job);
    assert.equal(quota.used, 0, 'approval is not an official submission');
    assert.equal(quota.remaining, 2);
    assert.equal(quota.reserved, 2);
});

test('reapproving one scoped item does not double-count it alongside the retained approved item', t => {
    const e = aliasFixture(t); refreshLimit(e, 2);
    const batch = startBatch(e);
    assert.equal(approve(e, batch, e.apps[0].app.id).ok, true);
    assert.equal(approve(e, batch, e.apps[1].app.id).ok, true);
    const refreshed = approve(e, batch, e.apps[0].app.id);
    assert.equal(refreshed.ok, true, JSON.stringify(refreshed.error));
    assert.equal(refreshed.data.grant.items.length, 2);
});

test('live and demo modes retain separate allowance accounting for the same canonical company', t => {
    const e = aliasFixture(t, { secondMode: 'live' }); refreshLimit(e, 1);
    assert(e.apps.every(item => jobOpportunity(e.store, item.job).reserved === 1));
    const result = approve(e, startBatch(e));
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(result.data.grant.items.length, 2);
});
