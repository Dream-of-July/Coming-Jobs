import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { call } from '../src/service.mjs';
import { createApplication } from '../src/jobs.mjs';
import { now } from '../src/core.mjs';
export function environment(t) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jobos-test-'));
    const store = new Store(dir);
    t?.after(() => { try {
        store.close();
    }
    catch { } rmSync(dir, { recursive: true, force: true }); });
    return { store, dir, run: (name, args = {}) => { const r = call(store, 'jobos1_' + name, args); assert.equal(r.ok, true, JSON.stringify(r)); return r.data; } };
}
export function simplePDF() {
    const stream = 'BT /F1 14 Tf 40 750 Td (SYNTHETIC TEST RESUME) Tj ET';
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let text = '%PDF-1.4\n', offsets = [0];
    for (let i = 0; i < objects.length; i++) {
        offsets.push(Buffer.byteLength(text));
        text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref = Buffer.byteLength(text);
    text += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
    text += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(text);
}
export function seedProfile(env) {
    return env.run('remember', { mode: 'user_statement', confirmed: true, user_ref: '合成候选人明确陈述', facts: [
            { key: 'intent.tracks', value: ['campus'] }, { key: 'intent.direction', value: 'AI / 交互产品经理' },
            { key: 'intent.locations', value: '不限' }, { key: 'education.summary', value: '合成大学，产品设计本科，2027年毕业' },
            { key: 'experience.summary', value: '合成眼镜公司：产品经理实习生，负责用户研究与交互原型' },
            { key: 'project.anchor', value: '为语音助手设计可纠正的记忆，使用Figma原型访谈12人' },
            { key: 'school', value: '合成大学' }, { key: 'name', value: '陈同学' },
            { key: 'project.description', value: '设计可纠正的记忆交互，并访谈12人验证原型' }
        ] });
}
export function reviewedFitFields(evidenceId, overrides = {}) {
    return { eligibility: 'pass', service_object: 'consumer', core_deliverable: 'product_spec', tier: 'conditional',
        hard_gates: [], gates_complete: true, evidence_refs: [{ evidence_id: evidenceId, level: 'self_statement' }], ...overrides };
}
export function collectionFixture({ company, track = 'campus', campaign, source_url = 'https://jobs.example.com/roles', external_ids = [], complete = true, observed_at = now() }) {
    const entry = { source_url, track, ...(campaign === undefined ? {} : { campaign }), external_ids: [...external_ids], complete: true, total: external_ids.length, observed_at };
    return { company, track, ...(campaign === undefined ? {} : { campaign }), source_url, observed_at, total: external_ids.length,
        external_ids: [...external_ids], pages_read: 1, has_more: false, complete,
        entries: [entry], live_entries: [{ ...entry, external_ids: [...external_ids] }], live_checked_at: observed_at };
}
export function seedDefaultOpportunity(env, company, scope) {
    const existing = env.store.all('opportunity').find(rule => rule.company_id === company.id && rule.track === scope.track && rule.campaign === scope.campaign);
    return existing ?? env.run('daily', { operation: 'opportunity', company_id: company.id, track: scope.track, campaign: scope.campaign,
        limit: 100, source: 'official', source_ref: 'https://example.com/synthetic-rules', observed_at: now() });
}
export function seedCollection(env, { company, track = 'campus', campaign = 'synthetic-campus', mode = 'demo', source_url = `https://jobs.example.com/companies/${encodeURIComponent(company)}/${track}` }) {
    const jobs = env.store.all('job').filter(job => job.company === company && job.track === track && (job.campaign ?? '') === (campaign ?? '') && job.mode === mode);
    const scope = { track, campaign, source_url };
    let registered = env.store.all('company').find(record => record.name === company || record.aliases.includes(company));
    if (!registered || !registered.scopes.some(existing => existing.track === track && existing.campaign === campaign))
        registered = env.run('daily', { operation: 'company', company: { name: registered?.name ?? company, scopes: [...(registered?.scopes ?? []), scope] } });
    seedDefaultOpportunity(env, registered, scope);
    return env.run('jobs', { operation: 'ingest', jobs: [], mode, coverage: 'explicit_scope_complete',
        collection: collectionFixture({ company, track, campaign, source_url, external_ids: jobs.map(job => job.external_id) }) }).collection;
}
export function seedJob(env, index = 1, mode = 'demo', overrides = {}) {
    const job = env.run('jobs', { operation: 'ingest', coverage: 'partial', jobs: [{ company: '合成企业 ' + index, title: 'AI 产品经理', url: `https://jobs.example.com/role/${index}`, jd: '岗位职责：设计 AI 产品与记忆交互。\n任职要求：能够访谈用户，制作交互原型。\n加分项：智能硬件经验优先。', track: 'campus', campaign: 'synthetic-campus', external_id: String(index), observed_at: now(), source: 'official', mode, ...overrides }] }).jobs[0];
    seedCollection(env, { company: job.company, track: job.track, campaign: job.campaign, mode: job.mode });
    return job;
}
export function seedApplication(env, mode = 'demo') {
    const profile = seedProfile(env), job = seedJob(env, 1, mode), app = createApplication(env.store, job.id, '合成用户选择');
    const file = path.join(env.dir, 'sample.pdf');
    writeFileSync(file, simplePDF());
    let material = env.run('material', { operation: 'register', file, kind: 'resume', job_id: job.id, authorized: true, user_ref: '合成用户授权' });
    material = env.run('material', { operation: 'approve', material_id: material.id, sha256: material.asset.sha256, visual_ok: true, content_ok: true, text_quality: 'pass', confirmed: true, user_ref: '合成用户审核' });
    env.run('material', { operation: 'bind', application_id: app.id, material_id: material.id });
    return { profile, job, app: env.store.get('application', app.id), material, file };
}
export function seedPlan(env, s, portalUrl = 'https://jobs.example.com/application') {
    const school = env.store.all('fact').find(f => f.key === 'school');
    const name = env.store.all('fact').find(f => f.key === 'name');
    const plan = env.run('plan', { application_id: s.app.id, portal_url: portalUrl, page_fingerprint: 'synthetic-page-v1', required_groups: ['education', 'resume', 'identity'], groups: [
            { key: 'identity', label: '基本资料', required: true, fields: [{ key: 'name', label: '姓名', type: 'free_text', required: true, value: '陈同学', evidence_ids: [name.id] }] },
            { key: 'education', label: '教育经历', required: true, fields: [{ key: 'school', label: '学校', type: 'portal_select', required: true, value: '合成大学', evidence_ids: [school.id] }] },
            { key: 'resume', label: '简历附件', required: true, fields: [{ key: 'cv', label: '简历', type: 'file_upload', required: true, value: s.material.id }] }
        ] }).plan;
    env.run('authorize', { application_id: s.app.id, plan_hash: plan.content_hash, portal_url: portalUrl, session_id: 'session', confirmed: true, user_ref: '合成用户授权本企业普通资料与附件' });
    return plan;
}
export function correctObservations(s) {
    return [
        { key: 'identity', before: [{ key: 'name', value: '旧名' }], fields: [{ key: 'name', value: '陈同学' }] },
        { key: 'education', before: [{ key: 'school', value: '旧校', selected: true }], fields: [{ key: 'school', value: '合成大学', selected: true }] },
        { key: 'resume', fields: [{ key: 'cv', upload_complete: true, local_sha256: s.material.asset.sha256, file_name: s.material.asset.name, file_bytes: s.material.asset.bytes, file_count: 1 }] }
    ];
}
export function checkpointArgs(s, p, groups = correctObservations(s)) { return { application_id: s.app.id, plan_hash: p.content_hash, session_id: 'session', portal_url: 'https://jobs.example.com/application', page_fingerprint: 'synthetic-page-v1', observed_at: now(), groups }; }
