import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { environment, seedApplication, seedPlan, seedJob, checkpointArgs, correctObservations } from './helpers.mjs';
import { call } from '../src/service.mjs';
import { createApplication } from '../src/jobs.mjs';

const portal = 'https://jobs.example.com/application';
const github = { key: 'social_7', label: 'GitHub profile (optional)', type: 'url', required: false };
function remember(env, entries) {
    return env.run('remember', { mode: 'user_statement', confirmed: true, user_ref: 'Synthetic confirmed profile', facts: entries }).saved;
}
function cleanGroups(plan) {
    return plan.groups.map(group => ({ key: group.key, label: group.label, required: group.required,
        fields: group.fields.map(({ evidence_versions, material, local_file, ...field }) => field) }));
}
function planWith(env, seeded, fields, observed_fields) {
    const groups = cleanGroups(seedPlan(env, seeded));
    if (fields.length) groups.push({ key: 'extra', label: 'Observed extra fields', required: false, fields });
    return env.run('plan', { application_id: seeded.app.id, portal_url: portal, page_fingerprint: 'synthetic-page-v1', groups,
        ...(observed_fields === undefined ? {} : { observed_fields }) });
}
function authorization(seeded, plan) {
    return { application_id: seeded.app.id, plan_hash: plan.content_hash, portal_url: portal, session_id: 'session', confirmed: true, user_ref: 'Synthetic prefill authorization' };
}

for (const fixture of [
    { name: 'unknown required answer with an unrelated citation', state: 'unknown',
        field: { key: 'start_date', label: 'Available start date', type: 'free_text', required: true }, value: '2027-04-01' },
    { name: 'unusable confirmed URL with an invented replacement', state: 'needs_format', fact: { key: 'github', value: 'Not a confirmed URL' },
        field: github, value: 'https://github.com/invented-example' },
    { name: 'select answer before actual options have been observed', state: 'needs_options', fact: { key: 'department_choice', value: 'Design' },
        field: { key: 'department_4', profile_key: 'department_choice', label: 'Department', type: 'portal_select', required: true }, value: 'Design', option_id: 'invented-option' },
    { name: 'unreviewed shortening of an overlong confirmed answer', state: 'needs_variation', fact: { key: 'personal_summary', value: 'A complete confirmed description.' },
        field: { key: 'intro_2', profile_key: 'personal_summary', label: 'About you', type: 'free_text', required: true, max_length: 5 }, value: 'Brief' }
]) {
    test(`authorization rejects an ${fixture.name}`, t => {
        const env = environment(t), seeded = seedApplication(env);
        const source = fixture.fact ? remember(env, [{ ...fixture.fact, purposes: ['form'] }])[0] : env.store.all('fact').find(f => f.key === 'school');
        const { profile_key, options, max_length, ...target } = fixture.field;
        const result = planWith(env, seeded, [{ ...target, value: fixture.value, evidence_ids: [source.id], ...(fixture.option_id ? { option_id: fixture.option_id } : {}) }], [fixture.field]);
        assert.equal(result.field_coverage.fields[0].state, fixture.state);
        assert.equal(result.field_coverage.fields[0].covered, false);
        const rejected = call(env.store, 'jobos1_authorize', authorization(seeded, result.plan));
        assert.equal(rejected.error?.code, 'unresolved_form_field');
    });
}

for (const mismatch of [
    { name: 'another semantic label', changes: { label: 'LinkedIn' } },
    { name: 'another control type', changes: { type: 'free_text' } },
    { name: 'a locator pointing at another semantic field', changes: { locator: { kind: 'label', value: 'LinkedIn' } } }
]) {
    test(`an observed GitHub field cannot be covered by ${mismatch.name}`, t => {
        const env = environment(t), seeded = seedApplication(env);
        const [source] = remember(env, [{ key: 'github', value: 'https://github.com/example-candidate', purposes: ['form'] }]);
        const result = planWith(env, seeded, [{ ...github, ...mismatch.changes, value: source.value, evidence_ids: [source.id] }], [github]);
        assert.equal(result.field_coverage.fields[0].covered, false);
        assert.equal(call(env.store, 'jobos1_authorize', authorization(seeded, result.plan)).error?.code, 'unresolved_form_field');
    });
}

test('a matching select label cannot authorize the wrong option ID and a genuine custom profile mapping remains usable', t => {
    const env = environment(t), seeded = seedApplication(env);
    const [source] = remember(env, [{ key: 'company_school', value: 'Example University', purposes: ['form'] }]);
    const observed = { key: 'school_2', label: 'School', type: 'portal_select', required: true, profile_key: 'company_school', options: [{ id: 'correct-option', label: 'Example University' }] };
    const target = { key: observed.key, label: observed.label, type: observed.type, required: true, value: source.value, evidence_ids: [source.id], option_id: 'wrong-option' };
    const result = planWith(env, seeded, [target], [observed]);
    assert.equal(result.field_coverage.fields[0].covered, false);
    assert.equal(call(env.store, 'jobos1_authorize', authorization(seeded, result.plan)).error?.code, 'unresolved_form_field');
    const groups = cleanGroups(result.plan);
    groups.find(group => group.key === 'extra').fields[0].option_id = 'correct-option';
    const corrected = env.run('plan', { application_id: seeded.app.id, portal_url: portal, page_fingerprint: result.plan.page_fingerprint, groups, observed_fields: [observed] });
    assert.equal(corrected.field_coverage.state, 'covered');
    env.run('authorize', authorization(seeded, corrected.plan));
    env.run('checkpoint', checkpointArgs(seeded, corrected.plan, [...correctObservations(seeded), { key: 'extra', fields: [{ key: observed.key, value: source.value, selected: true, option_id: 'correct-option' }] }]));
    assert.equal(env.run('review', { application_id: seeded.app.id, portal_url: portal }).ready, true);
});

for (const fixture of [
    { name: 'company override under another alias', scope: 'company', value: 'https://github.com/company-example', observed: true },
    { name: 'new same-value alias', scope: 'global', value: 'https://github.com/example-candidate', observed: true },
    { name: 'company override in a legacy call without inventory', scope: 'company', value: 'https://github.com/company-example', observed: false }
]) {
    test(`a ${fixture.name} invalidates an issued grant before execution prepare`, t => {
        const env = environment(t), seeded = seedApplication(env);
        const [source] = remember(env, [{ key: 'github', value: 'https://github.com/example-candidate', purposes: ['form'] }]);
        const { plan } = planWith(env, seeded, [{ ...github, value: source.value, evidence_ids: [source.id] }], fixture.observed ? [github] : undefined);
        env.run('authorize', authorization(seeded, plan));
        remember(env, [{ key: 'github_url', value: fixture.value, scope: fixture.scope === 'company' ? `company:${seeded.app.company}` : 'global', purposes: ['form'] }]);
        const prepared = call(env.store, 'jobos1_checkpoint', { ...checkpointArgs(seeded, plan, [{ key: 'resume', fields: [{ key: 'cv', read_state: 'known', file_count: 0 }] }]),
            phase: 'prepare', batch_number: 1, protected_fields: [
                { key: 'name', value: '', read_state: 'known' }, { key: 'school', value: '', read_state: 'known' }, { key: github.key, value: '', read_state: 'known' }
            ] });
        assert.equal(prepared.error?.code, 'fact_changed');
        assert.equal(env.store.all('execution_batch').length, 0);
        assert.equal(call(env.store, 'jobos1_authorize', authorization(seeded, plan)).error?.code, 'fact_changed');
        assert.equal(call(env.store, 'jobos1_checkpoint', checkpointArgs(seeded, plan)).error?.code, 'fact_changed');
    });
}

test('array facts cannot be coerced into scalar URL, text, date or select answers', t => {
    const env = environment(t), { app } = seedApplication(env);
    remember(env, [{ key: 'github', value: ['https://github.com/example-one', 'https://github.com/example-two'], purposes: ['form'] },
        { key: 'start_date', value: ['2027-04-01'], purposes: ['form'] }, { key: 'summary', value: ['First', 'Second'], purposes: ['form'] }]);
    const result = env.run('form_profile', { application_id: app.id, fields: [github,
        { key: 'start_date', label: 'Start date', type: 'date_picker', required: true },
        { key: 'summary', label: 'Summary', type: 'free_text', required: true },
        { key: 'select_start', profile_key: 'start_date', label: 'Start date choice', type: 'portal_select', required: true, options: [{ id: 'one', label: '2027-04-01' }] }
    ] });
    assert.deepEqual(result.fields.map(field => field.state), ['needs_format', 'needs_format', 'needs_format', 'needs_format']);
    assert(result.fields.every(field => !Object.hasOwn(field, 'value')));
});

test('recorded form inventory survives an empty or partial replacement and continues to block incomplete review', t => {
    const env = environment(t), seeded = seedApplication(env);
    remember(env, [{ key: 'github', value: 'https://github.com/example-candidate', purposes: ['form'] }]);
    const name = { key: 'name', label: '姓名', type: 'free_text', required: true };
    const original = planWith(env, seeded, [], [github, name]);
    for (const observed_fields of [[], [name]]) {
        const result = env.run('plan', { application_id: seeded.app.id, portal_url: portal, page_fingerprint: original.plan.page_fingerprint, groups: cleanGroups(original.plan), observed_fields });
        assert.deepEqual(result.plan.observed_fields.map(field => field.key), [github.key, name.key]);
        assert(result.field_coverage.blockers.some(field => field.key === github.key));
        env.run('authorize', authorization(seeded, result.plan));
        env.run('checkpoint', checkpointArgs(seeded, result.plan));
        const review = env.run('review', { application_id: seeded.app.id, portal_url: portal });
        assert.equal(review.ready, false);
        assert.equal(review.completeness, 'observed_fields_checked');
    }
});

test('a legacy plan with no recorded inventory keeps its existing readback workflow', t => {
    const env = environment(t), seeded = seedApplication(env), plan = seedPlan(env, seeded);
    env.run('checkpoint', checkpointArgs(seeded, plan));
    const result = env.run('review', { application_id: seeded.app.id, portal_url: portal });
    assert.equal(result.ready, true);
    assert.equal(result.completeness, 'legacy_inventory_unverified');
});

test('a conditionally removed field stays recorded and can retire only with an observed not-applicable state', t => {
    const env = environment(t), seeded = seedApplication(env);
    const field = { key: 'employer', label: 'Current employer', type: 'free_text', required: true };
    const original = planWith(env, seeded, [], [field]);
    assert.equal(original.field_coverage.state, 'incomplete');
    const retired = { ...field, applicable: false, observation_ref: 'Synthetic host readback: employer field absent after student selection' };
    const result = env.run('plan', { application_id: seeded.app.id, portal_url: portal, page_fingerprint: original.plan.page_fingerprint,
        groups: cleanGroups(original.plan), observed_fields: [retired] });
    assert.deepEqual(result.plan.observed_fields, [retired]);
    assert.equal(result.field_coverage.fields[0].state, 'not_applicable');
    assert.equal(result.field_coverage.state, 'covered');
    assert.deepEqual(env.run('form_profile', { application_id: seeded.app.id, fields: [retired] }).missing_required_fields, []);
    env.run('authorize', authorization(seeded, result.plan));
    env.run('checkpoint', checkpointArgs(seeded, result.plan));
    assert.equal(env.run('review', { application_id: seeded.app.id, portal_url: portal }).ready, true);
});

test('retiring an observed field without an actual observation reference cannot erase the gap', t => {
    const env = environment(t), seeded = seedApplication(env);
    const field = { key: 'employer', label: 'Current employer', type: 'free_text', required: true };
    const original = planWith(env, seeded, [], [field]);
    for (const observation_ref of [undefined, '   ']) {
        const retired = { ...field, applicable: false, ...(observation_ref === undefined ? {} : { observation_ref }) };
        assert.equal(call(env.store, 'jobos1_form_profile', { application_id: seeded.app.id, fields: [retired] }).error?.code, 'observation_required');
        assert.equal(call(env.store, 'jobos1_plan', { application_id: seeded.app.id, portal_url: portal, page_fingerprint: original.plan.page_fingerprint,
            groups: cleanGroups(original.plan), observed_fields: [retired] }).error?.code, 'observation_required');
        assert.equal(env.store.get('application', seeded.app.id).plan_id, original.plan.id);
    }
});

test('a field observed as not applicable cannot be included in authorized writes', t => {
    const env = environment(t), seeded = seedApplication(env);
    const [source] = remember(env, [{ key: 'employer', value: 'Synthetic Employer', purposes: ['form'] }]);
    const field = { key: 'employer', label: 'Current employer', type: 'free_text', required: true };
    const result = planWith(env, seeded, [{ ...field, value: source.value, evidence_ids: [source.id] }],
        [{ ...field, applicable: false, observation_ref: 'Synthetic host readback: employer field absent after student selection' }]);
    assert.equal(result.field_coverage.fields[0].covered, false);
    assert.equal(result.field_coverage.fields[0].reason, 'not_applicable_field_planned');
    assert.equal(call(env.store, 'jobos1_authorize', authorization(seeded, result.plan)).error?.code, 'unresolved_form_field');
});

test('an optional observed narrative sourced from the approved PDF still requires successful readback', t => {
    const env = environment(t), seeded = seedApplication(env), text = 'SYNTHETIC TEST RESUME';
    env.run('material', { operation: 'baseline', material_id: seeded.material.id, sha256: seeded.material.asset.sha256, extracted_text: text,
        extraction_ref: 'Synthetic exact existing PDF text', items: [{ key: 'project', category: 'project', text }], confirmed: true, user_ref: 'Synthetic baseline inventory' });
    const observed = { key: 'project', label: 'Project contribution', type: 'free_text', required: false };
    const result = planWith(env, seeded, [{ ...observed, content_key: 'project', material_id: seeded.material.id, value: text }], [observed]);
    assert.equal(result.field_coverage.state, 'covered');
    env.run('authorize', authorization(seeded, result.plan));
    env.run('checkpoint', checkpointArgs(seeded, result.plan));
    assert.equal(env.run('review', { application_id: seeded.app.id, portal_url: portal }).ready, false);
    env.run('checkpoint', checkpointArgs(seeded, result.plan, [{ key: 'extra', fields: [{ key: observed.key, value: text }] }]));
    assert.equal(env.run('review', { application_id: seeded.app.id, portal_url: portal }).ready, true);
});

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

test('material-only form text follows the current PDF and cannot reuse superseded baseline wording', t => {
    const env = environment(t), job = seedJob(env), original = 'SYNTHETIC TEST RESUME';
    let baseline = env.run('material', { operation: 'register', file: pdfFile(env, 'baseline.pdf', original), kind: 'resume', authorized: true, user_ref: 'Synthetic existing file' });
    baseline = env.run('material', { operation: 'approve', material_id: baseline.id, sha256: baseline.asset.sha256, visual_ok: true, content_ok: true, text_quality: 'pass', confirmed: true, user_ref: 'Synthetic baseline approval' });
    env.run('material', { operation: 'baseline', material_id: baseline.id, sha256: baseline.asset.sha256, extracted_text: original, extraction_ref: 'Synthetic exact baseline PDF text', items: [{ key: 'project', category: 'project', text: original }], confirmed: true, user_ref: 'Synthetic baseline inventory' });
    const [source] = remember(env, [{ key: 'project.summary', value: 'Prepared a synthetic test resume.' }]);
    const text = 'Prepared a resume for a synthetic test.';
    const content = { name: 'Synthetic Candidate', headline: 'Product designer', sections: [{ title: 'Experience', items: [{ text, evidence_ids: [source.id] }] }] };
    let material = env.run('material', { operation: 'draft', job_id: job.id, content, change_summary: 'Synthetic natural rewrite', baseline_mappings: [{ content_key: 'project', text, evidence_ids: [source.id], reason: 'Synthetic supported rewording.' }] });
    const extracted = [content.name, content.headline, ...content.sections.flatMap(section => [section.title, ...section.items.map(item => item.text)])].join('\n');
    material = env.run('material', { operation: 'register', material_id: material.id, file: pdfFile(env, 'current.pdf', extracted), kind: 'resume', authorized: true, user_ref: 'Synthetic rendered PDF' });
    env.run('material', { operation: 'lineage', material_id: material.id, base_id: baseline.id, sha256: material.asset.sha256, extracted_text: extracted, extraction_ref: 'Synthetic exact current PDF text', confirmed: true, user_ref: 'Synthetic extraction review' });
    material = env.run('material', { operation: 'approve', material_id: material.id, sha256: material.asset.sha256, visual_ok: true, content_ok: true, text_quality: 'pass', reviewed_content_keys: ['project'], confirmed: true, user_ref: 'Synthetic rewrite review' });
    const app = createApplication(env.store, job.id, 'Synthetic application selection');
    env.run('material', { operation: 'bind', application_id: app.id, material_id: material.id });
    const args = value => ({ application_id: app.id, portal_url: portal, page_fingerprint: 'synthetic-material-form', groups: [{ key: 'materials', label: 'Materials', required: true, fields: [
        { key: 'cv', label: 'Resume', type: 'file_upload', required: true, value: material.id },
        { key: 'description', label: 'Project description', type: 'free_text', required: true, material_id: material.id, value }
    ] }] });
    const current = env.run('plan', args(text));
    env.run('authorize', authorization({ app }, current.plan));
    const stale = call(env.store, 'jobos1_plan', args(original));
    assert.equal(stale.error?.code, 'unconfirmed_field');
    assert.equal(env.store.get('application', app.id).plan_id, current.plan.id);
});
