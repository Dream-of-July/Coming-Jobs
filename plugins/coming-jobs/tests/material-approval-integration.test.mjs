import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { environment, seedApplication, seedJob, simplePDF, reviewedFitFields } from './helpers.mjs';
import { approveMaterial, materialApproved } from '../src/materials.mjs';
import { batchFixture, startBatch, approveBatch, executePlan } from './batch-helpers.mjs';
import { call } from '../src/service.mjs';
import { now } from '../src/core.mjs';

function rewrittenApplication(t) {
    const e = environment(t), s = seedApplication(e);
    const original = 'SYNTHETIC TEST RESUME', rewritten = 'SYNTHETIC MOCK RESUME';
    e.run('material', { operation: 'baseline', material_id: s.material.id, sha256: s.material.asset.sha256,
        extracted_text: original, extraction_ref: 'Synthetic original PDF extraction',
        items: [{ key: 'project', category: 'project', text: original }], confirmed: true, user_ref: 'Synthetic baseline approval' });
    const fact = e.run('remember', { mode: 'user_statement', facts: [{ key: 'project.rewrite', value: rewritten, purposes: ['resume', 'form'] }],
        confirmed: true, user_ref: 'Synthetic rewrite source' }).saved[0];
    const file = path.join(e.dir, 'rewritten.pdf');
    writeFileSync(file, Buffer.from(simplePDF().toString().replaceAll(original, rewritten)));
    let material = e.run('material', { operation: 'register', kind: 'resume', job_id: s.job.id, file, authorized: true, user_ref: 'Synthetic export' });
    const mapping = { content_key: 'project', text: rewritten, evidence_ids: [fact.id], reason: 'Synthetic supported rewrite' };
    const lineage = { operation: 'lineage', material_id: material.id, base_id: s.material.id, sha256: material.asset.sha256,
        extracted_text: rewritten, extraction_ref: 'Synthetic rewritten PDF extraction', baseline_mappings: [mapping],
        confirmed: true, user_ref: 'Synthetic mapping review' };
    material = e.run('material', lineage);
    material = e.run('material', { operation: 'approve', material_id: material.id, sha256: material.asset.sha256,
        visual_ok: true, content_ok: true, text_quality: 'pass', reviewed_content_keys: ['project'], confirmed: true, user_ref: 'Synthetic editorial approval' });
    e.run('material', { operation: 'bind', application_id: s.app.id, material_id: material.id });
    const evidence = e.store.all('fact').find(f => f.key === 'project.anchor');
    e.run('jobs', { operation: 'assess', assessments: [{ job_id: s.job.id, job_hash: s.job.content_hash,
        mappings: s.job.requirements.map(r => ({ requirement_id: r.id, relation: 'direct', evidence_ids: [evidence.id], reason: 'Synthetic evidence' })),
        advantages: [], gaps: [], reason: 'Synthetic eligible', ...reviewedFitFields(evidence.id) }] });
    const planArgs = { application_id: s.app.id, portal_url: 'https://jobs.example.com/application', page_fingerprint: 'editorial-qa-v1',
        groups: [{ key: 'details', label: 'Details', required: true, fields: [{ key: 'project', label: 'Project contribution', type: 'free_text',
            required: true, value: rewritten, content_key: 'project', material_id: material.id }] },
        { key: 'resume', label: 'Resume', required: true, fields: [{ key: 'cv', label: 'Resume', type: 'file_upload', required: true, value: material.id }] }],
        observed_fields: [{ key: 'project', label: 'Project contribution', type: 'free_text', required: true }] };
    return { e, s, material, lineage, planArgs, file, rewritten };
}

test('batch approval preserves current editorial QA and an identical rewritten form can be planned again', t => {
    const { e, s, material, planArgs } = rewrittenApplication(t);
    assert.equal(e.run('plan', planArgs).field_coverage.state, 'covered');
    const batch = e.run('apply_batch', { operation: 'start', application_ids: [s.app.id], session_id: 'editorial-session' });
    const sheet = e.run('apply_batch', { operation: 'sheet', batch_id: batch.id });
    e.run('apply_batch', { operation: 'approve', batch_id: batch.id, sheet_code: sheet.code, sheet_issued_at: sheet.issued_at,
        session_id: 'editorial-session', reply: `批准 ${sheet.code} 全部`, confirmed: true, user_ref: 'Synthetic batch approval' });
    assert.deepEqual(e.store.get('material', material.id).qa.reviewed_content_keys, ['project']);
    assert.equal(e.run('plan', planArgs).field_coverage.state, 'covered');
});

test('a same-SHA mapping replacement cannot inherit old editorial QA through the shared PDF approval', t => {
    const { e, material, lineage, rewritten } = rewrittenApplication(t);
    const replacement = e.run('remember', { mode: 'user_statement', facts: [{ key: 'project.rewrite.alternative', value: rewritten, purposes: ['resume', 'form'] }],
        confirmed: true, user_ref: 'Synthetic alternate source' }).saved[0];
    const revised = e.run('material', { ...lineage, baseline_mappings: [{ ...lineage.baseline_mappings[0], evidence_ids: [replacement.id] }] });
    assert.equal(revised.asset.sha256, material.asset.sha256);
    assert.equal(revised.approved, false);
    assert.throws(() => approveMaterial(e.store, revised, 'Synthetic batch approval'), { code: 'resume_rewrite_review_required' });
    assert.equal(e.store.get('material', material.id).approved, false);
});

test('a changed PDF hash cannot inherit editorial QA after new lineage is recorded', t => {
    const { e, material, lineage, file, rewritten } = rewrittenApplication(t);
    writeFileSync(file, Buffer.from(simplePDF().toString().replaceAll('SYNTHETIC TEST RESUME', rewritten) + '\n% Synthetic changed export\n'));
    const changed = e.run('material', { operation: 'register', material_id: material.id, kind: 'resume', file, authorized: true, user_ref: 'Synthetic changed export' });
    assert.notEqual(changed.asset.sha256, material.asset.sha256);
    const revised = e.run('material', { ...lineage, sha256: changed.asset.sha256 });
    assert.throws(() => approveMaterial(e.store, revised, 'Synthetic batch approval'), { code: 'resume_rewrite_review_required' });
});

function readyRewrittenBatch(t) {
    const fixture = rewrittenApplication(t), { e, s, material } = fixture;
    e.store.put('settings', 'preferences', { batch_submit: 'on' });
    const name = e.store.all('fact').find(f => f.key === 'name');
    const plan = e.run('plan', { application_id: s.app.id, portal_url: 'https://jobs.example.com/application', page_fingerprint: 'editorial-upload-v1',
        groups: [{ key: 'identity', label: 'Identity', required: true, fields: [{ key: 'name', label: '姓名', type: 'free_text', required: true,
            value: name.value, source: { fact_id: name.id, transform: 'identity' } }] },
        { key: 'resume', label: 'Resume', required: true, fields: [{ key: 'cv', label: 'Resume', type: 'file_upload', required: true, value: material.id }] }] }).plan;
    e.apps = [{ app: s.app, job: s.job, material, plan }];
    const batch = startBatch(e); approveBatch(e, batch);
    assert.equal(executePlan(e, e.apps[0]).ready, true);
    return { ...fixture, batch, plan };
}

function replaceMapping(fixture) {
    const { e, lineage, rewritten } = fixture;
    const replacement = e.run('remember', { mode: 'user_statement', facts: [{ key: 'project.rewrite.alternative', value: rewritten, purposes: ['resume', 'form'] }],
        confirmed: true, user_ref: 'Synthetic replacement source' }).saved[0];
    return e.run('material', { ...lineage, baseline_mappings: [{ ...lineage.baseline_mappings[0], evidence_ids: [replacement.id] }] });
}

const clearSubmit = ({ e, s, batch }) => call(e.store, 'jobos1_apply_batch', { operation: 'clear_submit', batch_id: batch.id,
    application_id: s.app.id, session_id: 'synthetic-session' });

test('same-byte lineage changes invalidate the central material approval even when the PDF hash was approved', t => {
    const fixture = readyRewrittenBatch(t), revised = replaceMapping(fixture);
    assert.equal(revised.approved, false);
    assert.equal(revised.quality.editorial_review_required, true);
    assert.equal(materialApproved(fixture.e.store, revised), false);
    assert.equal(materialApproved(fixture.e.store, { ...revised, approved: true,
        quality: { ...revised.quality, editorial_review_required: false } }), false, 'a stale editorial digest cannot be rescued by local approval flags');
});

test('same-byte lineage changes prevent review, renewed authorization and further execution', t => {
    const fixture = readyRewrittenBatch(t), { e, s, plan } = fixture; replaceMapping(fixture);
    const attempts = [
        ['review', { application_id: s.app.id, portal_url: plan.origin }],
        ['authorize', { application_id: s.app.id, plan_hash: plan.content_hash, portal_url: plan.origin,
            session_id: 'synthetic-session', reuse: true, confirmed: false, user_ref: 'Synthetic lease renewal' }],
        ['checkpoint', { application_id: s.app.id, plan_hash: plan.content_hash, portal_url: plan.origin, page_fingerprint: plan.page_fingerprint,
            session_id: 'synthetic-session', observed_at: now(), phase: 'prepare', batch_number: 1,
            groups: [{ key: 'resume', fields: [{ key: 'cv', read_state: 'known', file_count: 0 }] }] }]
    ];
    for (const [operation, args] of attempts) {
        const result = call(e.store, 'jobos1_' + operation, args);
        assert.equal(result.ok, false, operation + ' must reject invalidated material approval');
        assert.equal(result.error.code, 'resume_review_required');
    }
});

test('same-byte lineage changes cannot clear an already reviewed batch for final submission', t => {
    const fixture = readyRewrittenBatch(t); replaceMapping(fixture);
    const result = clearSubmit(fixture);
    assert.equal(result.ok, false);
    assert.equal(fixture.e.store.all('submit_attempt').length, 0);
    assert.equal(fixture.e.store.get('application', fixture.s.app.id).stage, 'preparing');
});

test('renewing editorial QA after a mapping change still requires a new batch approval for that material state', t => {
    const fixture = readyRewrittenBatch(t), revised = replaceMapping(fixture), { e } = fixture;
    const reviewed = e.run('material', { operation: 'approve', material_id: revised.id, sha256: revised.asset.sha256,
        visual_ok: true, content_ok: true, text_quality: 'pass', reviewed_content_keys: ['project'], confirmed: true, user_ref: 'Synthetic revised editorial approval' });
    assert.equal(materialApproved(e.store, reviewed), true);
    const stale = clearSubmit(fixture);
    assert.equal(stale.ok, false, 'the old sheet approved different mapping evidence');
    assert.equal(stale.error.code, 'approved_item_changed');
    assert.equal(e.store.all('submit_attempt').length, 0);
    approveBatch(e, fixture.batch);
    assert.equal(clearSubmit(fixture).ok, true, 'a new scoped batch approval can cover the reviewed same-byte material');
});

test('a confirmed company-specific alias correction prevents explicit final-submit clearance', t => {
    const e = batchFixture(t, 1), batch = startBatch(e), s = e.apps[0]; approveBatch(e, batch);
    assert.equal(executePlan(e, s).ready, true);
    e.run('remember', { mode: 'user_statement', confirmed: true, user_ref: 'Synthetic company correction', facts: [
        { key: 'full_name', value: 'Synthetic corrected name', purposes: ['form'], scope: `company:${s.app.company}` }
    ] });
    assert.equal(call(e.store, 'jobos1_review', { application_id: s.app.id, portal_url: s.plan.origin }).error.code, 'fact_changed');
    const result = call(e.store, 'jobos1_apply_batch', { operation: 'clear_submit', batch_id: batch.id,
        application_id: s.app.id, session_id: 'synthetic-session' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'fact_changed');
    assert.equal(e.store.all('submit_attempt').length, 0);
});

test('an unapproved rendered PDF can enter the initial sheet and acquire approval before execution', t => {
    const e = batchFixture(t, 1), s = e.apps[0], current = e.store.get('material', s.material.id);
    const file = path.join(e.dir, 'synthetic-rendered.pdf'); writeFileSync(file, Buffer.concat([simplePDF(), Buffer.from('\n% Synthetic renderer fixture\n')]));
    const asset = e.store.asset(file);
    e.store.put('material', current.id, { ...current, asset, approved: false, qa: null, render_receipt: { passed: true } });
    const plan = e.run('plan', { application_id: s.app.id, portal_url: s.plan.origin, page_fingerprint: s.plan.page_fingerprint,
        groups: s.plan.groups.map(group => ({ ...group, fields: group.fields.map(field => {
            const { key, label, type, required, value, source } = field;
            return { key, label, type, required, value, ...(source ? { source } : {}) };
        }) })) }).plan;
    s.plan = plan;
    const batch = startBatch(e), sheet = e.run('apply_batch', { operation: 'sheet', batch_id: batch.id });
    assert.deepEqual(sheet.needs_decision, []);
    approveBatch(e, batch);
    assert.equal(materialApproved(e.store, e.store.get('material', current.id)), true);
    assert.equal(executePlan(e, s).ready, true);
});

test('valid legacy editorial QA without a digest remains reusable and receives a digest on reaffirmation', t => {
    const { e, material } = rewrittenApplication(t), { editorial_digest, ...qa } = material.qa;
    const legacy = e.store.put('material', material.id, { ...material, qa });
    assert.equal(materialApproved(e.store, legacy), true);
    const reaffirmed = approveMaterial(e.store, legacy, 'Synthetic unchanged legacy QA');
    assert.equal(materialApproved(e.store, reaffirmed), true);
    assert.equal(typeof reaffirmed.qa.editorial_digest, 'string');
});

test('same-byte register and reuse cannot revive pending lineage review from legacy QA', t => {
    const fixture = rewrittenApplication(t), { e, material, file } = fixture, { editorial_digest, ...qa } = material.qa;
    e.store.put('material', material.id, { ...material, qa });
    const revised = replaceMapping(fixture);
    const registered = e.run('material', { operation: 'register', material_id: revised.id, file, kind: 'resume',
        authorized: true, user_ref: 'Synthetic same-byte registration retry' });
    assert.equal(registered.approved, false);
    const job = seedJob(e, 2);
    const reused = call(e.store, 'jobos1_material', { operation: 'reuse', material_id: revised.id, job_id: job.id });
    assert.equal(reused.ok, false);
    assert.equal(reused.error.code, 'review_required');
    assert(!e.run('material', { operation: 'context', job_id: job.id }).reusable_materials.some(item => item.id === revised.id));
});
