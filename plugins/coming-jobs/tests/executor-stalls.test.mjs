import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { environment, seedApplication } from './helpers.mjs';
import { call } from '../src/service.mjs';
import { INTERNAL_SCHEMAS } from '../src/catalog.mjs';
import { validate, exampleFor } from '../src/core.mjs';
import { HOST_POLICY } from '../src/policy.mjs';

const operations = schema => schema.oneOf?.every(s => s.properties?.operation) ? schema.oneOf : [schema];
const read = file => readFileSync(new URL('../skills/jobos/' + file, import.meta.url), 'utf8');

test('invalid_arguments reports every missing field at once with a working example', t => {
    const e = environment(t);
    const r = call(e.store, 'jobos1_material', { operation: 'lineage', material_id: 'synthetic-material' });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'invalid_arguments');
    const missing = r.error.details.errors.map(x => x.path.split('.').pop());
    assert.deepEqual(missing.sort(), ['base_id', 'confirmed', 'extracted_text', 'extraction_ref', 'sha256', 'user_ref']);
    for (const key of missing) assert(r.error.message.includes(key), key);
    assert.equal(r.error.details.operation, 'lineage');
    assert.equal(r.error.details.example.operation, 'lineage');
    validate(INTERNAL_SCHEMAS.get('jobos1_material'), r.error.details.example);
});

test('wrong types, unknown fields and missing fields are reported together', t => {
    const e = environment(t);
    const r = call(e.store, 'jobos1_handoff', { operation: 'open', application_id: 7, kind: 'nope', extra: true });
    assert.equal(r.ok, false);
    assert.deepEqual(r.error.details.errors.map(x => x.path).sort(), ['参数.open.application_id', '参数.open.extra', '参数.open.kind', '参数.open.prompt'].sort());
    const unknown = call(e.store, 'jobos1_handoff', { operation: 'reopen' });
    assert.match(unknown.error.message, /可选 .*open/);
    assert(unknown.error.details.operations.includes('resolve'));
});

test('every operation of material, apply_batch, daily and handoff has a schema-valid minimal example', () => {
    for (const name of ['jobos1_material', 'jobos1_apply_batch', 'jobos1_daily', 'jobos1_handoff']) {
        const schema = INTERNAL_SCHEMAS.get(name);
        assert(schema, name);
        for (const branch of operations(schema)) {
            const example = exampleFor(branch);
            validate(schema, example);
            const required = (branch.required ?? []).filter(k => k !== 'operation');
            if (required.length) {
                const bare = { operation: example.operation };
                assert.throws(() => validate(schema, bare), err => err.details.errors.length === required.length && err.details.example.operation === example.operation, `${name}.${example.operation}`);
            }
        }
    }
    for (const [name, schema] of INTERNAL_SCHEMAS) for (const branch of operations(schema)) validate(schema, exampleFor(branch), name);
});

const excerpt = (s, extra = '') => `投递记录 ${s.job.title} 职位编号 ${s.job.external_id} 已投递 2026-10-23 10:00 ${extra}`;

test('official_portal outcome accepts URL plus matching page excerpt without a screenshot path', t => {
    const e = environment(t), s = seedApplication(e, 'live');
    const before = call(e.store, 'jobos1_outcome', { application_id: s.app.id, stage: 'submitted', source: 'official_portal', observed_at: new Date().toISOString(), job_id: s.job.external_id });
    assert.equal(before.error.code, 'job_evidence_missing');
    assert.equal(before.error.details.example.evidence.url.startsWith('https://'), true);
    const r = e.run('outcome', { application_id: s.app.id, stage: 'submitted', source: 'official_portal', observed_at: new Date().toISOString(),
        evidence: { url: 'https://jobs.example.com/my/applications', page_excerpt: excerpt(s), submitted_at: '2026-10-23T10:00:00+08:00' } });
    assert.equal(r.application.stage, 'submitted');
    assert.equal(r.application.submission_evidence, 'portal_observed');
    const observation = e.store.all('observation').find(o => o.application_id === s.app.id);
    assert.equal(observation.reference, 'https://jobs.example.com/my/applications');
    assert.equal(observation.evidence.matched_by, 'job_id');
    assert.equal(observation.evidence.submitted_at, '2026-10-23T02:00:00.000Z');
});

test('official_portal evidence is still rejected for a different job or a missing submission time', t => {
    const e = environment(t), s = seedApplication(e, 'live');
    const base = { application_id: s.app.id, stage: 'submitted', source: 'official_portal', observed_at: new Date().toISOString() };
    const evidence = { url: 'https://jobs.example.com/my/applications', page_excerpt: excerpt(s), submitted_at: '2026-10-23T10:00:00+08:00' };
    assert.equal(call(e.store, 'jobos1_outcome', { ...base, job_id: 'another-job', evidence }).error.code, 'job_evidence_missing');
    assert.equal(call(e.store, 'jobos1_outcome', { ...base, evidence: { ...evidence, page_excerpt: '投递记录 其他岗位 编号 999 已投递' } }).error.code, 'job_evidence_missing');
    assert.equal(call(e.store, 'jobos1_outcome', { ...base, evidence: { url: evidence.url, page_excerpt: evidence.page_excerpt } }).error.code, 'job_evidence_missing');
    assert.equal(call(e.store, 'jobos1_outcome', { ...base, evidence: { ...evidence, url: 'http://jobs.example.com/my' } }).error.code, 'invalid_url');
    assert.equal(e.store.all('observation').length, 0);
    assert.equal(e.store.get('application', s.app.id).submission_evidence, s.app.submission_evidence);
});

test('Skill no longer stalls on graphical verification, auto-synced fields or preview reloads', () => {
    const docs = [HOST_POLICY, read('SKILL.md'), read('references/hosts/codex.md'), read('references/hosts/claude.md')].join('\n');
    assert(!/图形\/滑块验证始终由用户处理|图形验证、滑块、密码|变化项暂停/.test(docs));
    assert(!/QR, CAPTCHA and declarations into the human queue/.test(docs));
    assert(HOST_POLICY.includes('图形/滑块验证只把这一个动作交给用户'));
    assert(HOST_POLICY.includes('仅当已审批的语义内容变化时暂停'));
    assert(HOST_POLICY.includes('门户自动同步的字段') && HOST_POLICY.includes('已恢复为审批值的字段不算变化'));
    assert(HOST_POLICY.includes('进入预览页后不刷新、不离开'));
    for (const file of ['references/hosts/codex.md', 'references/hosts/claude.md']) assert(/预览页后不刷新|preview page, do not reload/.test(read(file)), file);
});
