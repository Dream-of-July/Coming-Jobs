import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { environment, seedJob, simplePDF } from './helpers.mjs';
import { materialAction, assertMaterialCurrent } from '../src/materials.mjs';
import { call } from '../src/service.mjs';
import { hash } from '../src/core.mjs';
import { createApplication } from '../src/jobs.mjs';

function fact(env, key, value, extra = {}) {
    return env.run('remember', { mode: 'user_statement', confirmed: true, user_ref: 'Synthetic source statement', facts: [{ key, value, ...extra }] }).saved[0];
}
function content(text, evidence_ids) {
    return { name: 'Synthetic Candidate', headline: 'Product designer', sections: [{ title: 'Experience', items: [{ text, evidence_ids }] }] };
}
function draft(env, job, text, evidence_ids, extra = {}) {
    return materialAction(env.store, { operation: 'draft', job_id: job.id, content: content(text, evidence_ids), change_summary: 'Synthetic tailoring review', ...extra });
}
function pdfFile(env, name, text) {
    const stream = `BT /F1 10 Tf 40 750 Td ${text.split('\n').map(line => `(${line.replace(/[\\()]/g, '\\$&')}) Tj 0 -16 Td`).join(' ')} ET`;
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
    let body = '%PDF-1.4\n'; const offsets = [];
    for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; }
    const xref = Buffer.byteLength(body);
    body += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
    body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const file = path.join(env.dir, name); writeFileSync(file, body); return file;
}
const documentText = content => [content.name, content.headline, ...content.sections.flatMap(s => [s.title, ...s.items.map(i => i.text)])].join('\n');

test('changing the confirmed inventory with unchanged PDF bytes refreshes the draft quality report', t => {
    const env = environment(t), job = seedJob(env);
    const original = 'SYNTHETIC TEST RESUME\nSynthetic Award';
    const baseline = approvedBaseline(env, [{ key: 'combined', category: 'project', text: original }]);
    const source = fact(env, 'project.summary', original);
    const first = draft(env, job, original, [source.id]);
    env.run('material', { operation: 'baseline', material_id: baseline.id, sha256: baseline.asset.sha256, extracted_text: original, extraction_ref: 'Synthetic same PDF extraction', items: [{ key: 'project', category: 'project', text: 'SYNTHETIC TEST RESUME' }, { key: 'award', category: 'award', text: 'Synthetic Award' }], confirmed: true, user_ref: 'Synthetic corrected inventory' });
    const updated = draft(env, job, original, [source.id]);
    assert.notEqual(updated.id, first.id);
    assert.deepEqual(updated.quality.baseline.items.map(item => item.key), ['project', 'award']);
});

test('registering a shared portfolio for another job retains existing non-resume compatibility', t => {
    const env = environment(t), first = seedJob(env), second = seedJob(env, 2);
    const file = pdfFile(env, 'portfolio.pdf', 'SYNTHETIC PORTFOLIO');
    const material = env.run('material', { operation: 'register', file, kind: 'portfolio', job_id: first.id, authorized: true, user_ref: 'Synthetic shared portfolio' });
    const updated = env.run('material', { operation: 'register', material_id: material.id, file, kind: 'portfolio', job_id: second.id, authorized: true, user_ref: 'Synthetic shared portfolio reuse' });
    assert.equal(updated.kind, 'portfolio');
    assert.equal(updated.job_id, second.id);
});
function approvedBaseline(env, items = [{ key: 'project', category: 'project', text: 'SYNTHETIC TEST RESUME' }]) {
    const file = pdfFile(env, 'baseline.pdf', items.map(i => i.text).join('\n'));
    let material = env.run('material', { operation: 'register', file, kind: 'resume', authorized: true, user_ref: 'Synthetic existing file' });
    material = env.run('material', { operation: 'approve', material_id: material.id, sha256: material.asset.sha256, visual_ok: true, content_ok: true, text_quality: 'pass', confirmed: true, user_ref: 'Synthetic existing approval' });
    return env.run('material', { operation: 'baseline', material_id: material.id, sha256: material.asset.sha256, extracted_text: items.map(i => i.text).join('\n'), extraction_ref: 'Synthetic host extraction fixture', items, confirmed: true, user_ref: 'Synthetic inventory approval' });
}

test('numeric lint rejects a number that is only a substring of the cited number', t => {
    const env = environment(t), job = seedJob(env);
    const source = fact(env, 'project.research', 'Interviewed 12 participants.');
    assert.throws(() => draft(env, job, 'Interviewed 2 participants.', [source.id]), { code: 'unbacked_number' });
});

test('numeric lint keeps percentages distinct and permits harmless grouping formatting', t => {
    const env = environment(t), job = seedJob(env);
    const source = fact(env, 'project.results', 'A synthetic survey included 1,200 responses; the recorded ratio was 15%.');
    assert.throws(() => draft(env, job, 'The ratio was 5%.', [source.id]), { code: 'unbacked_number' });
    assert.throws(() => draft(env, job, 'Interviewed 15 people.', [source.id]), { code: 'unbacked_number' });
    assert.equal(draft(env, job, 'The survey included 1200 responses; the ratio was 15 %.', [source.id]).approved, false);
});

test('draft and currentness use the target company facts without borrowing another company scope', t => {
    const env = environment(t), job = seedJob(env);
    const companyFact = fact(env, 'project.example', 'Made a prototype for a research study.', { scope: `company:${job.company}` });
    const otherFact = fact(env, 'project.other', 'Made an unrelated prototype.', { scope: 'company:Other synthetic company' });
    const m = draft(env, job, String(companyFact.value), [companyFact.id]);
    assert.doesNotThrow(() => assertMaterialCurrent(env.store, m));
    assert.throws(() => draft(env, job, String(otherFact.value), [otherFact.id]), { code: 'resume_evidence' });
    fact(env, companyFact.key, 'Corrected research description.', { scope: `company:${job.company}` });
    assert.throws(() => assertMaterialCurrent(env.store, m), { code: 'material_evidence_changed' });
});

test('company variation length counts Unicode characters consistently with form fields', t => {
    const env = environment(t), job = seedJob(env), baseline = approvedBaseline(env);
    const source = fact(env, 'project.summary', 'Synthetic 😀');
    const variation = materialAction(env.store, { operation: 'variation', material_id: baseline.id, content_key: 'project', company: job.company, text: '😀😀', reason: 'portal_length', max_length: 2, evidence_ids: [source.id], confirmed: true, user_ref: 'Synthetic character limit' });
    assert.equal(variation.text, '😀😀');
    assert.equal(variation.max_length, 2);
});

test('an unchecked text review cannot approve a resume', t => {
    const env = environment(t), file = path.join(env.dir, 'resume.pdf');
    writeFileSync(file, simplePDF());
    const m = env.run('material', { operation: 'register', file, kind: 'resume', authorized: true, user_ref: 'Synthetic file' });
    for (const text_quality of ['not_checked', 'limited']) {
        const result = call(env.store, 'jobos1_material', { operation: 'approve', material_id: m.id, sha256: m.asset.sha256, visual_ok: true, content_ok: true, text_quality, confirmed: true, user_ref: 'Synthetic review' });
        assert.equal(result.error?.code, 'resume_text_review_required');
    }
    assert.equal(env.store.get('material', m.id).approved, false);
});

test('grounded baseline rewrites retain the original diff and require editorial review of changed keys', t => {
    const env = environment(t), job = seedJob(env), baseline = approvedBaseline(env);
    const source = fact(env, 'project.summary', 'Prepared a synthetic test resume.');
    const text = 'Prepared a resume for a synthetic test.';
    const mapping = { content_key: 'project', text, evidence_ids: [source.id], reason: 'Use a natural sentence while preserving the contribution.' };
    let m = draft(env, job, text, [source.id], { baseline_mappings: [mapping] });
    assert.equal(m.quality.baseline.items[0].state, 'mapped_rewrite');
    assert.equal(m.quality.baseline.items[0].original, 'SYNTHETIC TEST RESUME');
    assert.equal(m.quality.editorial_review_required, true);
    const extracted = documentText(m.content);
    m = env.run('material', { operation: 'register', material_id: m.id, file: pdfFile(env, 'rewritten.pdf', extracted), kind: 'resume', authorized: true, user_ref: 'Synthetic rendered file' });
    m = materialAction(env.store, { operation: 'lineage', material_id: m.id, base_id: baseline.id, sha256: m.asset.sha256, extracted_text: extracted, extraction_ref: 'Synthetic rewritten PDF extraction', confirmed: true, user_ref: 'Synthetic extraction review' });
    const approval = { operation: 'approve', material_id: m.id, sha256: m.asset.sha256, visual_ok: true, content_ok: true, text_quality: 'pass', confirmed: true, user_ref: 'Synthetic editorial review' };
    assert.throws(() => materialAction(env.store, approval), { code: 'resume_rewrite_review_required' });
    const approved = materialAction(env.store, { ...approval, reviewed_content_keys: ['project'] });
    assert.equal(approved.approved, true);
    assert.deepEqual(approved.qa.reviewed_content_keys, ['project']);
    assert.equal(approved.quality.semantic_verification, 'not_performed');
});

test('a rewrite mapping cannot cover missing text, unknown inventory keys or uncited facts', t => {
    const env = environment(t), job = seedJob(env);
    approvedBaseline(env);
    const source = fact(env, 'project.summary', 'Prepared a synthetic test resume.');
    const text = 'Prepared a resume for a synthetic test.';
    const mapping = { content_key: 'project', text, evidence_ids: [source.id], reason: 'Synthetic supported rewrite.' };
    assert.throws(() => draft(env, job, text, [source.id]), { code: 'resume_incomplete' });
    assert.throws(() => draft(env, job, text, [source.id], { baseline_mappings: [{ ...mapping, text: 'Text absent from the draft.' }] }), { code: 'resume_mapping_text_missing' });
    assert.throws(() => draft(env, job, text, [source.id], { baseline_mappings: [{ ...mapping, content_key: 'not-in-inventory' }] }), { code: 'unknown_content' });
    assert.throws(() => draft(env, job, text, [source.id], { baseline_mappings: [{ ...mapping, evidence_ids: ['not-confirmed'] }] }), { code: 'resume_evidence' });
});

test('a mapped rewrite never silently excuses a separate missing baseline item', t => {
    const env = environment(t), job = seedJob(env);
    approvedBaseline(env, [{ key: 'project', category: 'project', text: 'SYNTHETIC TEST RESUME' }, { key: 'award', category: 'award', text: 'Synthetic Award' }]);
    const source = fact(env, 'project.summary', 'Prepared a synthetic test resume.');
    const text = 'Prepared a resume for a synthetic test.';
    assert.throws(() => draft(env, job, text, [source.id], { baseline_mappings: [{ content_key: 'project', text, evidence_ids: [source.id], reason: 'Synthetic rewrite.' }] }), { code: 'resume_incomplete' });
});

test('including the old baseline elsewhere does not bypass review of an explicitly mapped rewrite', t => {
    const env = environment(t), job = seedJob(env);
    approvedBaseline(env);
    const source = fact(env, 'project.summary', 'Prepared a synthetic test resume.');
    const text = 'Prepared a resume for a synthetic test.';
    const m = draft(env, job, `${text}\nSYNTHETIC TEST RESUME`, [source.id], { baseline_mappings: [{ content_key: 'project', text, evidence_ids: [source.id], reason: 'Synthetic changed wording for review.' }] });
    assert.equal(m.quality.baseline.items[0].state, 'mapped_rewrite');
});

test('quality report surfaces uncited material and introduced scope wording without blocking genuine source wording', t => {
    const env = environment(t), job = seedJob(env);
    const source = fact(env, 'project.contribution', 'Supported a team by preparing prototype screens.');
    const unused = fact(env, 'award.design', 'Received a synthetic design award.');
    const m = draft(env, job, 'Led a team to deliver prototype screens.', [source.id]);
    assert(m.quality.unused_fact_ids.includes(unused.id));
    assert(m.quality.warnings.some(w => w.code === 'introduced_scope_wording'));
    assert.equal(m.quality.semantic_verification, 'not_performed');
    const leader = fact(env, 'project.lead', 'Led a team to deliver prototype screens.');
    const unchanged = draft(env, job, String(leader.value), [leader.id]);
    assert(!unchanged.quality.warnings.some(w => w.code === 'introduced_scope_wording'));
});

test('material context includes scoped facts and existing approved material before drafting', t => {
    const env = environment(t), job = seedJob(env), baseline = approvedBaseline(env);
    const source = fact(env, 'project.summary', 'Prepared a synthetic test resume.', { scope: `company:${job.company}` });
    const ctx = materialAction(env.store, { operation: 'context', job_id: job.id });
    assert(ctx.facts.some(f => f.id === source.id));
    assert.equal(ctx.baseline.material_id, baseline.id);
    assert(ctx.reusable_materials.some(m => m.id === baseline.id && m.sha256 === baseline.asset.sha256));
    assert.equal(ctx.preferences, null);
});

test('material context surfaces an approved version from another job only when its evidence applies to this recipient', t => {
    const env = environment(t), first = seedJob(env), second = seedJob(env, 2), baseline = approvedBaseline(env);
    const shared = fact(env, 'project.shared', 'SYNTHETIC TEST RESUME');
    const prior = materialAction(env.store, { operation: 'reuse', material_id: baseline.id, job_id: first.id });
    env.store.put('material', prior.id, { ...prior, evidence: [{ id: shared.id, digest: hash(shared.value) }] });
    const available = materialAction(env.store, { operation: 'context', job_id: second.id });
    assert(available.reusable_materials.some(item => item.id === prior.id && item.job_id === first.id && !item.job_current));
    const scoped = fact(env, 'project.recipient_specific', 'SYNTHETIC TEST RESUME', { scope: `company:${first.company}` });
    env.store.put('material', prior.id, { ...env.store.get('material', prior.id), evidence: [{ id: scoped.id, digest: hash(scoped.value) }] });
    const restricted = materialAction(env.store, { operation: 'context', job_id: second.id });
    assert(!restricted.reusable_materials.some(item => item.id === prior.id));
    assert(restricted.unavailable_materials.some(item => item.id === prior.id && item.reason === 'resume_evidence'));
});

test('reusing an approved PDF preserves exact bytes and content approval without altering the source job or carrying authorization', t => {
    const env = environment(t), job = seedJob(env), baseline = approvedBaseline(env);
    env.store.put('material', baseline.id, { ...baseline, authorization: { company: 'Unrelated recipient' } });
    const reused = materialAction(env.store, { operation: 'reuse', job_id: job.id, material_id: baseline.id });
    assert.equal(reused.job_id, job.id);
    assert.equal(reused.asset.sha256, baseline.asset.sha256);
    assert.equal(reused.source_material_id, baseline.id);
    assert.equal(reused.base_id, baseline.id);
    assert.equal(reused.approved, true);
    assert.equal(reused.approval_ref, baseline.approval_ref);
    assert.equal(reused.authorization, undefined);
    assert.equal(env.store.get('material', baseline.id).job_id, null);
    assert.doesNotThrow(() => assertMaterialCurrent(env.store, reused));
    assert.equal(materialAction(env.store, { operation: 'reuse', job_id: job.id, material_id: baseline.id }).id, reused.id);
});

test('material context inventories source metadata without returning every source body', t => {
    const env = environment(t), job = seedJob(env);
    const source = env.run('workspace', { operation: 'source', label: 'Synthetic source notes', kind: 'notes', text: 'Synthetic long-form source body.', purposes: ['resume'], authorized: true, user_ref: 'Synthetic source permission' });
    const ctx = materialAction(env.store, { operation: 'context', job_id: job.id });
    const item = ctx.sources.find(s => s.id === source.id);
    assert.equal(item.text, undefined);
    assert.equal(item.text_available, true);
});

test('a PDF that omits drafted content cannot pass merely because the baseline phrase remains', t => {
    const env = environment(t), job = seedJob(env), baseline = approvedBaseline(env);
    const source = fact(env, 'project.summary', 'SYNTHETIC TEST RESUME\nReceived a synthetic design award.');
    let m = draft(env, job, String(source.value), [source.id]);
    m = env.run('material', { operation: 'register', material_id: m.id, file: pdfFile(env, 'incomplete.pdf', 'SYNTHETIC TEST RESUME'), kind: 'resume', authorized: true, user_ref: 'Synthetic incomplete export' });
    assert.throws(() => materialAction(env.store, { operation: 'lineage', material_id: m.id, base_id: baseline.id, sha256: m.asset.sha256, extracted_text: 'SYNTHETIC TEST RESUME', extraction_ref: 'Synthetic incomplete PDF extraction', confirmed: true, user_ref: 'Synthetic extraction' }), { code: 'resume_pdf_content_mismatch' });
});

test('first generated resume uses registered hash-bound extraction before content approval', t => {
    const env = environment(t), job = seedJob(env), source = fact(env, 'project.summary', 'Prepared a synthetic test resume.');
    let m = draft(env, job, String(source.value), [source.id]);
    const extracted = documentText(m.content);
    m = env.run('material', { operation: 'register', material_id: m.id, file: pdfFile(env, 'generated.pdf', extracted), kind: 'resume', authorized: true, user_ref: 'Synthetic rendered file' });
    const approval = { operation: 'approve', material_id: m.id, sha256: m.asset.sha256, visual_ok: true, content_ok: true, text_quality: 'pass', confirmed: true, user_ref: 'Synthetic full review' };
    assert.equal(call(env.store, 'jobos1_material', approval).error?.code, 'resume_text_required');
    env.run('material_index', { operation: 'cache_host_text', sha256: m.asset.sha256, text: extracted, extraction_ref: 'Synthetic generated PDF extraction' });
    assert.equal(env.run('material', approval).approved, true);
});

test('photo approval does not require a resume text quality check', t => {
    const env = environment(t), file = path.join(env.dir, 'photo.png');
    writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH2QAAAAASUVORK5CYII=', 'base64'));
    const m = env.run('material', { operation: 'register', kind: 'photo', file, authorized: true, user_ref: 'Synthetic portrait fixture' });
    const reviewed = env.run('material', { operation: 'approve', material_id: m.id, sha256: m.asset.sha256, visual_ok: true, content_ok: true, text_quality: 'not_checked', confirmed: true, user_ref: 'Synthetic portrait review' });
    assert.equal(reviewed.approved, true);
});

test('corrected evidence in the approved baseline invalidates drafts before reuse', t => {
    const env = environment(t), job = seedJob(env), baseline = approvedBaseline(env);
    const source = fact(env, 'project.summary', 'SYNTHETIC TEST RESUME');
    env.store.put('material', baseline.id, { ...baseline, evidence: [{ id: source.id, digest: hash(source.value) }] });
    const corrected = fact(env, source.key, 'A corrected synthetic summary.');
    assert.throws(() => draft(env, job, 'SYNTHETIC TEST RESUME', [corrected.id]), { code: 'material_evidence_changed' });
});

test('registering an existing approved material for a different job requires a separate reuse record', t => {
    const env = environment(t), job = seedJob(env), baseline = approvedBaseline(env);
    const result = call(env.store, 'jobos1_material', { operation: 'register', material_id: baseline.id, job_id: job.id, file: path.join(env.dir, 'baseline.pdf'), kind: 'resume', authorized: true, user_ref: 'Synthetic second recipient' });
    assert.equal(result.error?.code, 'resume_reuse_required');
    assert.equal(env.store.get('material', baseline.id).job_id, null);
});

test('form content_key follows the approved rewritten PDF and rejects the superseded baseline wording', t => {
    const env = environment(t), job = seedJob(env), baseline = approvedBaseline(env);
    const source = fact(env, 'project.summary', 'Prepared a synthetic test resume.');
    const text = 'Prepared a resume for a synthetic test.';
    let m = env.run('material', { operation: 'draft', job_id: job.id, content: content(text, [source.id]), change_summary: 'Synthetic natural rewrite', baseline_mappings: [{ content_key: 'project', text, evidence_ids: [source.id], reason: 'Synthetic supported rewording.' }] });
    const extracted = documentText(m.content);
    m = env.run('material', { operation: 'register', material_id: m.id, file: pdfFile(env, 'form-resume.pdf', extracted), kind: 'resume', authorized: true, user_ref: 'Synthetic rendered PDF' });
    env.run('material', { operation: 'lineage', material_id: m.id, base_id: baseline.id, sha256: m.asset.sha256, extracted_text: extracted, extraction_ref: 'Synthetic exact PDF text', confirmed: true, user_ref: 'Synthetic extraction review' });
    m = env.run('material', { operation: 'approve', material_id: m.id, sha256: m.asset.sha256, visual_ok: true, content_ok: true, text_quality: 'pass', reviewed_content_keys: ['project'], confirmed: true, user_ref: 'Synthetic text and layout review' });
    const app = createApplication(env.store, job.id, 'Synthetic application selection');
    env.run('material', { operation: 'bind', application_id: app.id, material_id: m.id });
    const plan = value => ({ application_id: app.id, portal_url: 'https://jobs.example.com/application', page_fingerprint: 'synthetic-form', groups: [{ key: 'materials', label: 'Materials', required: true, fields: [
        { key: 'cv', label: 'Resume', type: 'file_upload', required: true, value: m.id },
        { key: 'project', label: 'Project contribution', type: 'free_text', required: true, content_key: 'project', material_id: m.id, value, evidence_ids: [source.id] }
    ] }] });
    assert.equal(call(env.store, 'jobos1_plan', plan(text)).ok, true);
    assert.equal(call(env.store, 'jobos1_plan', plan('SYNTHETIC TEST RESUME')).error?.code, 'resume_text_mismatch');
});

test('updated inventory refreshes reused quality including the same-job shortcut without discarding PDF approval', t => {
    const env = environment(t), job = seedJob(env);
    const original = 'SYNTHETIC TEST RESUME\nSynthetic Award';
    const baseline = approvedBaseline(env, [{ key: 'combined', category: 'project', text: original }]);
    const first = materialAction(env.store, { operation: 'reuse', job_id: job.id, material_id: baseline.id });
    assert.deepEqual(first.quality.baseline.items.map(item => item.key), ['combined']);
    env.run('material', { operation: 'baseline', material_id: baseline.id, sha256: baseline.asset.sha256, extracted_text: original, extraction_ref: 'Synthetic same PDF extraction',
        items: [{ key: 'project', category: 'project', text: 'SYNTHETIC TEST RESUME' }, { key: 'award', category: 'award', text: 'Synthetic Award' }], confirmed: true, user_ref: 'Synthetic corrected inventory' });
    const updated = materialAction(env.store, { operation: 'reuse', job_id: job.id, material_id: baseline.id });
    const sameJob = materialAction(env.store, { operation: 'reuse', job_id: job.id, material_id: first.id });
    for (const refreshed of [updated, sameJob]) {
        assert.notEqual(refreshed.id, first.id);
        assert.deepEqual(refreshed.quality.baseline.items.map(item => item.key), ['project', 'award']);
        assert.equal(refreshed.asset.sha256, first.asset.sha256);
        assert.equal(refreshed.approved, true);
        assert.equal(refreshed.approval_ref, first.approval_ref);
        assert.doesNotThrow(() => assertMaterialCurrent(env.store, refreshed));
    }
    assert.deepEqual(env.store.get('material', first.id).quality.baseline.items.map(item => item.key), ['combined']);
    assert.equal(materialAction(env.store, { operation: 'reuse', job_id: job.id, material_id: sameJob.id }).id, sameJob.id);
});

test('registering the same approved photo for another job preserves non-resume compatibility and byte approval', t => {
    const env = environment(t), first = seedJob(env), second = seedJob(env, 2);
    const file = path.join(env.dir, 'shared-photo.png');
    writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH2QAAAAASUVORK5CYII=', 'base64'));
    let material = env.run('material', { operation: 'register', kind: 'photo', file, job_id: first.id, authorized: true, user_ref: 'Synthetic shared portrait' });
    material = env.run('material', { operation: 'approve', material_id: material.id, sha256: material.asset.sha256, visual_ok: true, content_ok: true, text_quality: 'not_checked', confirmed: true, user_ref: 'Synthetic portrait review' });
    const updated = env.run('material', { operation: 'register', material_id: material.id, kind: 'photo', file, job_id: second.id, authorized: true, user_ref: 'Synthetic portrait reuse' });
    assert.equal(updated.kind, 'photo');
    assert.equal(updated.job_id, second.id);
    assert.equal(updated.approved, true);
    assert.equal(updated.approval_ref, material.approval_ref);
});

test('self lineage is rejected without revoking or mutating the current approved baseline', t => {
    const env = environment(t), job = seedJob(env), baseline = approvedBaseline(env);
    const storedMaterial = env.store.get('material', baseline.id);
    const storedBaseline = env.store.get('settings', 'resume_baseline');
    assert.throws(() => materialAction(env.store, { operation: 'lineage', material_id: baseline.id, base_id: baseline.id, sha256: baseline.asset.sha256,
        extracted_text: 'SYNTHETIC TEST RESUME', extraction_ref: 'Synthetic existing PDF text', confirmed: true, user_ref: 'Synthetic lineage request' }), { code: 'resume_self_lineage' });
    assert.deepEqual(env.store.get('material', baseline.id), storedMaterial);
    assert.deepEqual(env.store.get('settings', 'resume_baseline'), storedBaseline);
    assert.doesNotThrow(() => assertMaterialCurrent(env.store, storedMaterial));
    assert.equal(materialAction(env.store, { operation: 'reuse', job_id: job.id, material_id: baseline.id }).approved, true);
});

test('changing an inventory original cannot reinterpret the approval of an older rewrite mapping', t => {
    const env = environment(t), job = seedJob(env);
    const original = 'SYNTHETIC TEST RESUME\nSynthetic Award';
    const baseline = approvedBaseline(env, [{ key: 'project', category: 'project', text: original }]);
    const inventory = text => env.run('material', { operation: 'baseline', material_id: baseline.id, sha256: baseline.asset.sha256, extracted_text: original,
        extraction_ref: 'Synthetic unchanged baseline PDF', items: [{ key: 'project', category: 'project', text }], confirmed: true, user_ref: 'Synthetic inventory correction' });
    inventory('SYNTHETIC TEST RESUME');
    const source = fact(env, 'project.summary', 'Prepared a synthetic test resume.');
    const text = 'Prepared a resume for a synthetic test.';
    let material = draft(env, job, text, [source.id], { baseline_mappings: [{ content_key: 'project', text, evidence_ids: [source.id], reason: 'Synthetic supported rewrite.' }] });
    const extracted = documentText(material.content);
    material = env.run('material', { operation: 'register', material_id: material.id, file: pdfFile(env, 'original-mapping.pdf', extracted), kind: 'resume', authorized: true, user_ref: 'Synthetic rendered PDF' });
    const lineage = { operation: 'lineage', material_id: material.id, base_id: baseline.id, sha256: material.asset.sha256, extracted_text: extracted, extraction_ref: 'Synthetic exact PDF text', confirmed: true, user_ref: 'Synthetic mapping review' };
    materialAction(env.store, lineage);
    const approval = { operation: 'approve', material_id: material.id, sha256: material.asset.sha256, visual_ok: true, content_ok: true, text_quality: 'pass', confirmed: true, user_ref: 'Synthetic editorial review' };
    material = materialAction(env.store, { ...approval, reviewed_content_keys: ['project'] });
    inventory('Synthetic Award');
    assert.throws(() => assertMaterialCurrent(env.store, material), { code: 'resume_mapping_baseline_changed' });
    assert.throws(() => materialAction(env.store, { operation: 'reuse', material_id: material.id, job_id: job.id }), { code: 'resume_mapping_baseline_changed' });
    const revised = materialAction(env.store, lineage);
    assert.equal(revised.approved, false);
    assert.equal(revised.quality.baseline.items[0].original, 'Synthetic Award');
    assert.throws(() => materialAction(env.store, approval), { code: 'resume_rewrite_review_required' });
});
