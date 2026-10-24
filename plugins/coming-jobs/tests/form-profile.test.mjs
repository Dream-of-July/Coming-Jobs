import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, seedApplication, seedPlan, checkpointArgs, correctObservations } from './helpers.mjs';
import { call } from '../src/service.mjs';
import { facts } from '../src/profile.mjs';

const github = { key: 'social_7', label: 'GitHub profile (optional)', type: 'url', required: false };
function remember(env, entries) {
    return env.run('remember', { mode: 'user_statement', confirmed: true, user_ref: 'synthetic confirmed profile', facts: entries }).saved;
}

test('whole-form resolution finds a confirmed GitHub URL under an unrelated portal key', t => {
    const env = environment(t), { app } = seedApplication(env);
    const [fact] = remember(env, [{ key: 'links.github', value: 'https://github.com/example-candidate', purposes: ['form'] }]);
    const result = env.run('form_profile', { application_id: app.id, fields: [github] });
    assert.equal(result.fields[0].state, 'matched');
    assert.equal(result.fields[0].value, fact.value);
    assert.deepEqual(result.fields[0].evidence_ids, [fact.id]);
    assert.deepEqual(result.known_optional_fields, ['social_7']);
    assert.equal(env.store.all('plan').length, 0);
});

test('company-specific aliases override global answers without leaking to another company', t => {
    const env = environment(t), { app } = seedApplication(env);
    env.run('daily', { operation: 'company', company: { name: app.company, aliases: ['Example Alias'] } });
    remember(env, [
        { key: 'links.github', value: 'https://github.com/global-example', purposes: ['form'] },
        { key: 'github_url', value: 'https://github.com/company-example', scope: 'company:Example Alias', purposes: ['form'] }
    ]);
    const result = env.run('form_profile', { application_id: app.id, fields: [github] });
    assert.equal(result.fields[0].value, 'https://github.com/company-example');
    assert.equal(facts(env.store, 'form', `company:${app.company}`).some(f => f.scope === 'company:Example Alias'), true);
    assert.equal(facts(env.store, 'form', 'company:Another company').some(f => f.scope === 'company:Example Alias'), false);
});

test('conflicting profile aliases stay ambiguous and unknown optional answers remain empty', t => {
    const env = environment(t), { app } = seedApplication(env);
    remember(env, [
        { key: 'github', value: 'https://github.com/first-example', purposes: ['form'] },
        { key: 'github_url', value: 'https://github.com/second-example', purposes: ['form'] }
    ]);
    const result = env.run('form_profile', { application_id: app.id, fields: [github, { key: 'blog', label: 'Personal blog', type: 'url', required: false }] });
    assert.equal(result.fields[0].state, 'ambiguous');
    assert.equal(Object.hasOwn(result.fields[0], 'value'), false);
    assert.equal(result.fields[1].state, 'unknown');
    assert.equal(Object.hasOwn(result.fields[1], 'value'), false);
});

test('expired and unconfirmed facts cannot fill a field and GitHub cannot fill LinkedIn', t => {
    const env = environment(t), { app } = seedApplication(env);
    remember(env, [{ key: 'github', value: 'https://github.com/old-example', purposes: ['form'], expires_at: '2000-01-01T00:00:00Z' }]);
    const result = env.run('form_profile', { application_id: app.id, fields: [github, { key: 'linkedin', label: 'LinkedIn', type: 'url', required: true }] });
    assert.deepEqual(result.fields.map(f => f.state), ['unknown', 'unknown']);
    assert.deepEqual(result.missing_required_fields, ['linkedin']);
});

test('observed options use the confirmed company value and a long answer is never truncated', t => {
    const env = environment(t), { app } = seedApplication(env);
    remember(env, [{ key: 'company_school', value: 'Example University', purposes: ['form'] }, { key: 'personal_summary', value: 'A complete confirmed description.', purposes: ['form'] }]);
    const result = env.run('form_profile', { application_id: app.id, fields: [
        { key: 'school_2', profile_key: 'company_school', label: 'School', type: 'portal_select', required: true, options: [{ id: 'u1', label: 'Example University' }] },
        { key: 'about_1', profile_key: 'personal_summary', label: 'About you', type: 'free_text', required: true, max_length: 10 }
    ] });
    assert.equal(result.fields[0].option_id, 'u1');
    assert.equal(result.fields[0].state, 'matched');
    assert.equal(result.fields[1].state, 'needs_variation');
    assert.equal(Object.hasOwn(result.fields[1], 'value'), false);
});

test('code fields are routed to host authentication without becoming stored form answers', t => {
    const env = environment(t), { app } = seedApplication(env);
    const result = env.run('form_profile', { application_id: app.id, fields: [{ key: 'otp', label: 'Email verification code', type: 'free_text', required: true }] });
    assert.equal(result.fields[0].state, 'host_auth');
    assert.equal(Object.hasOwn(result.fields[0], 'value'), false);
    assert.equal(env.store.all('fact').some(f => f.key === 'otp'), false);
});

test('review reports a known optional GitHub omitted from the observed form inventory', t => {
    const env = environment(t), seeded = seedApplication(env);
    remember(env, [{ key: 'github', value: 'https://github.com/example-candidate', purposes: ['form'] }]);
    const original = seedPlan(env, seeded);
    const planned = env.run('plan', { application_id: seeded.app.id, portal_url: 'https://jobs.example.com/application', page_fingerprint: 'synthetic-page-v1', groups: original.groups.map(g => ({ key: g.key, label: g.label, required: g.required, fields: g.fields.map(({ evidence_versions, material, local_file, ...f }) => f) })), observed_fields: [github] });
    assert.deepEqual(planned.field_coverage.blockers.map(f => f.key), ['social_7']);
    env.run('authorize', { application_id: seeded.app.id, plan_hash: planned.plan.content_hash, portal_url: 'https://jobs.example.com/application', session_id: 'session', confirmed: true, user_ref: 'synthetic prefill authorization' });
    env.run('checkpoint', checkpointArgs(seeded, planned.plan, correctObservations(seeded)));
    const result = env.run('review', { application_id: seeded.app.id, portal_url: 'https://jobs.example.com/application' });
    assert.equal(result.ready, false);
    assert.equal(result.blockers.some(f => f.key === 'social_7' && f.reason === 'known_field_omitted'), true);
});

test('unknown required fields remain actionable gaps instead of a false complete review', t => {
    const env = environment(t), seeded = seedApplication(env);
    const original = seedPlan(env, seeded);
    const groups = original.groups.map(g => ({ key: g.key, label: g.label, required: g.required, fields: g.fields.map(({ evidence_versions, material, local_file, ...f }) => f) }));
    const result = env.run('plan', { application_id: seeded.app.id, portal_url: 'https://jobs.example.com/application', page_fingerprint: 'synthetic-page-v1', groups, observed_fields: [{ key: 'start', label: 'Available start date', type: 'free_text', required: true }] });
    assert.equal(result.field_coverage.blockers[0].reason, 'required_field_omitted');
    const response = call(env.store, 'jobos1_context', { scope: 'application', application_id: seeded.app.id });
    assert.equal(response.flow.next.action, 'complete_form_inventory');
    assert.equal(response.flow.can_auto_continue, true);
});

test('a known optional field must pass real readback even inside an optional group', t => {
    const env = environment(t), seeded = seedApplication(env);
    const [source] = remember(env, [{ key: 'github', value: 'https://github.com/example-candidate', purposes: ['form'] }]);
    const original = seedPlan(env, seeded);
    const groups = original.groups.map(g => ({ key: g.key, label: g.label, required: g.required, fields: g.fields.map(({ evidence_versions, material, local_file, ...f }) => f) }));
    groups.push({ key: 'social', label: 'Optional profiles', required: false, fields: [{ ...github, value: source.value, evidence_ids: [source.id] }] });
    const { plan } = env.run('plan', { application_id: seeded.app.id, portal_url: 'https://jobs.example.com/application', page_fingerprint: 'synthetic-page-v1', groups, observed_fields: [github] });
    env.run('authorize', { application_id: seeded.app.id, plan_hash: plan.content_hash, portal_url: 'https://jobs.example.com/application', session_id: 'session', confirmed: true, user_ref: 'synthetic authorization' });
    env.run('checkpoint', checkpointArgs(seeded, plan, [...correctObservations(seeded), { key: 'social', fields: [{ key: github.key, value: '' }] }]));
    const review = env.run('review', { application_id: seeded.app.id, portal_url: 'https://jobs.example.com/application' });
    assert.equal(review.ready, false);
    assert.equal(review.blockers.some(f => f.key === 'social'), true);
});

test('an ambiguous known answer does not become resolved merely by being included in a plan', t => {
    const env = environment(t), seeded = seedApplication(env);
    const entries = remember(env, [{ key: 'github', value: 'https://github.com/example-one', purposes: ['form'] }, { key: 'github_url', value: 'https://github.com/example-two', purposes: ['form'] }]);
    const original = seedPlan(env, seeded);
    const groups = original.groups.map(g => ({ key: g.key, label: g.label, required: g.required, fields: g.fields.map(({ evidence_versions, material, local_file, ...f }) => f) }));
    groups.push({ key: 'social', label: 'Profiles', required: false, fields: [{ ...github, value: entries[0].value, evidence_ids: [entries[0].id] }] });
    const result = env.run('plan', { application_id: seeded.app.id, portal_url: 'https://jobs.example.com/application', page_fingerprint: 'synthetic-page-v1', groups, observed_fields: [github] });
    assert.equal(result.field_coverage.state, 'incomplete');
    assert.equal(result.field_coverage.blockers[0].reason, 'ambiguous_profile');
});
