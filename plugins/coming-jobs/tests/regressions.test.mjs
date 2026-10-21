import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, symlinkSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { environment, seedProfile, seedApplication, seedJob, reviewedFitFields } from './helpers.mjs';
import { call } from '../src/service.mjs';
import { Store } from '../src/store.mjs';
import { guidance } from '../src/flow.mjs';
test('restart context remembers the exact pending login and reply', t => {
    const e = environment(t), s = seedApplication(e);
    e.run('handoff', { operation: 'open', application_id: s.app.id, kind: 'login', prompt: '请在小米官方页面完成登录，完成后回复“已登录”。', reply: '已登录' });
    const another = new Store(e.dir);
    t.after(() => another.close());
    const g = guidance(another);
    assert.equal(g.next.action, 'login');
    assert.equal(g.next.reply, '已登录');
});
test('resolved login continues instead of asking whether to start filling', t => {
    const e = environment(t), s = seedApplication(e);
    e.run('handoff', { operation: 'open', application_id: s.app.id, kind: 'login', prompt: '登录', reply: '已登录' });
    e.run('handoff', { operation: 'resolve', application_id: s.app.id, completed: true, user_ref: '已登录' });
    assert.equal(guidance(e.store).can_auto_continue, true);
});
test('200 confirmed facts are retrieved in one task context, not 100 tiny pages', t => {
    const e = environment(t);
    for (let batch = 0; batch < 2; batch++)
        e.run('remember', { mode: 'user_statement', confirmed: true, user_ref: '用户授权资料', facts: Array.from({ length: 100 }, (_, i) => ({ key: 'fact.' + (batch * 100 + i), value: '已知信息' + i })) });
    assert.equal(e.run('context').facts.length, 200);
});
test('export and restore include exact attachment bytes without restoring external permission', t => {
    const e = environment(t), s = seedApplication(e);
    const out = e.run('workspace', { operation: 'export', authorized: true, user_ref: '备份' });
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jobos-restore-'));
    const restored = new Store(dir);
    t.after(() => { restored.close(); rmSync(dir, { recursive: true, force: true }); });
    const r = call(restored, 'jobos1_workspace', { operation: 'import', file: out.file, authorized: true, user_ref: '恢复该备份' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const m = restored.get('material', s.material.id);
    assert.deepEqual(readFileSync(restored.assetPath(m.asset)), readFileSync(s.file));
    assert.equal(restored.get('application', s.app.id).authorization, null);
});
test('restoration into nonempty database cannot overwrite the current user', t => {
    const e = environment(t);
    seedProfile(e);
    const out = e.run('workspace', { operation: 'export', authorized: true, user_ref: '备份' });
    const r = call(e.store, 'jobos1_workspace', { operation: 'import', file: out.file, authorized: true, user_ref: '恢复' });
    assert.equal(r.error.code, 'restore_not_empty');
});
test('import is idempotent for the same historical application', t => {
    const e = environment(t);
    const file = path.join(e.dir, 'transfer.json');
    writeFileSync(file, JSON.stringify({ format: 'jobos-transfer/1', facts: [], applications: [{ company: '历史公司', title: '产品经理', submitted: true, stage: 'assessment', external_id: 'one' }] }));
    e.run('workspace', { operation: 'import', file, authorized: true, user_ref: '导入' });
    e.run('workspace', { operation: 'import', file, authorized: true, user_ref: '导入' });
    assert.equal(e.store.all('application').length, 1);
    assert.equal(e.store.all('application')[0].provider_verified, false);
});
test('renderer fallback returns a Figma action rather than requiring a private server', t => {
    const e = environment(t);
    seedProfile(e);
    const j = seedJob(e), f = e.store.all('fact').find(f => f.key === 'project.anchor');
    const m = e.run('material', { operation: 'draft', template: 'classic', job_id: j.id, content: { name: '陈同学', headline: '产品经理', sections: [{ title: '项目', items: [{ text: String(f.value), evidence_ids: [f.id] }] }] }, change_summary: '沿用经典设计' });
    const r = e.run('material', { operation: 'render', material_id: m.id });
    assert.match(r.host_action, /真实 Figma/);
    assert.equal(r.figma, null);
});
test('invented numerical achievements do not pass resume content lint', t => {
    const e = environment(t);
    seedProfile(e);
    const j = seedJob(e), f = e.store.all('fact').find(f => f.key === 'project.anchor');
    const r = call(e.store, 'jobos1_material', { operation: 'draft', job_id: j.id, content: { name: '陈同学', headline: '产品经理', sections: [{ title: '项目', items: [{ text: '访谈500人', evidence_ids: [f.id] }] }] }, change_summary: 'test' });
    assert.equal(r.error.code, 'unbacked_number');
});
test('source registration requires a file or actual text', t => {
    const e = environment(t);
    const r = call(e.store, 'jobos1_workspace', { operation: 'source', label: '空', kind: 'notes', purposes: ['matching'], authorized: true, user_ref: '授权' });
    assert.equal(r.error.code, 'source_missing');
});
test('source symlinks outside an explicitly authorized root are rejected', t => {
    const e = environment(t), outside = mkdtempSync(path.join(os.tmpdir(), 'jobos-outside-'));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    const file = path.join(outside, 'private.txt');
    writeFileSync(file, 'private');
    const link = path.join(e.dir, 'link.txt');
    symlinkSync(file, link);
    const r = call(e.store, 'jobos1_workspace', { operation: 'source', label: '越界', kind: 'notes', file: link, allowed_root: e.dir, purposes: ['matching'], authorized: true, user_ref: '授权目录' });
    assert.equal(r.error.code, 'scope_violation');
});
test('new invalid timezone does not replace a valid preference', t => {
    const e = environment(t);
    const r = call(e.store, 'jobos1_profile', { operation: 'preferences', preferences: { timezone: 'Bad/Timezone' }, confirmed: true, user_ref: '偏好' });
    assert.equal(r.error.code, 'invalid_timezone');
    assert.equal(e.store.get('settings', 'preferences', false), null);
});
test('new shortlist guidance supersedes an old active application', t => {
    const e = environment(t);
    seedApplication(e);
    e.store.put('batch', 'batch-test', { items: [{ number: 1, job_id: 'test' }] });
    e.store.put('settings', 'focus', { kind: 'shortlist' });
    assert.equal(e.run('context').capabilities.final_submit, 'human_only');
    assert.equal(guidance(e.store).next.action, 'choose');
});
test('saved final response follows the new shortlist rather than an obsolete passed application', t => {
    const e = environment(t), s = seedApplication(e);
    e.store.put('batch', 'batch-test', { items: [{ number: 1, job_id: 'test' }] });
    e.store.put('settings', 'focus', { kind: 'shortlist' });
    const f = e.run('finish', { session_id: 's', turn_id: 't', reason: 'need_user', application_id: s.app.id, completed: '推荐已准备好' });
    assert.equal(f.guidance.next.action, 'choose');
    assert.match(f.text, /编号/);
});
test('interview guidance has a concrete practice action instead of resuming an unrelated fill', t => {
    const e = environment(t);
    seedApplication(e);
    e.store.put('settings', 'focus', { kind: 'interview' });
    assert.equal(guidance(e.store).next.reply, '开始练习第一题');
});
test('a changed JD cannot reuse a stale assessment in a new daily batch', t => {
    const e = environment(t);
    seedProfile(e);
    const j = seedJob(e);
    const f = e.store.all('fact').find(f => f.key === 'project.anchor');
    e.run('jobs', { operation: 'assess', assessments: [{ job_id: j.id, job_hash: j.content_hash, ...reviewedFitFields(f.id), mappings: j.requirements.map(r => ({ requirement_id: r.id, relation: 'direct', evidence_ids: [f.id], reason: 'fixture' })), advantages: [], gaps: [], reason: 'fixture' }] });
    assert.equal(e.run('shortlist', { operation: 'daily', mode: 'demo' }).items.length, 1);
    e.store.put('job', j.id, { ...j, content_hash: 'changed-jd' });
    assert.equal(e.run('shortlist', { operation: 'daily', mode: 'demo' }).items.length, 0);
});
test('an ambiguous portal observation does not become a verified submission count', t => {
    const e = environment(t), s = seedApplication(e, 'live');
    e.run('outcome', { application_id: s.app.id, stage: 'unknown', source: 'official_portal', job_id: s.job.external_id, observation_ref: 'result-not-clear', observed_at: new Date().toISOString() });
    assert.equal(e.run('context', { scope: 'metrics' }).portal_observed_submitted, 0);
});
test('upload copy preserves the reviewed display filename and exact PDF bytes', t => {
    const e = environment(t), s = seedApplication(e);
    const upload = e.store.uploadPath(s.material.asset);
    assert.equal(path.basename(upload), s.material.asset.name);
    assert.deepEqual(readFileSync(upload), readFileSync(s.file));
    assert.equal(e.store.uploadPath(s.material.asset), upload);
});
test('application context provides verified upload paths instead of hash filenames', t => {
    const e = environment(t), s = seedApplication(e);
    e.store.uploadPath(s.material.asset);
    const ctx = e.run('context', { scope: 'application', application_id: s.app.id });
    const m = ctx.materials.find(m => m.id === s.material.id);
    assert.equal(path.basename(m.upload_path), s.material.asset.name);
});
test('external backfill is idempotent and generates progress HTML',t=>{
 const e=environment(t),input={company:'Example',title:'Designer',job_id:'2027-2',stage:'submitted',source:'official_portal',observation_ref:'https://jobs.example.com/history',observed_at:new Date().toISOString()};
 const a=e.run('outcome',input),b=e.run('outcome',input);assert.equal(a.application.id,b.application.id);assert.equal(e.store.all('application').length,1);assert.equal(a.application.submission_evidence,'portal_observed');const html=readFileSync(a.presentation.file,'utf8');assert(html.includes('Designer'));assert(html.includes('未确认启用'));assert(!html.includes('https://jobs.example.com/history'));assert.equal(e.run('workspace',{operation:'dashboard'}).presentation.status,'ready');
});
test('backfill requires identity and escapes untrusted portal text',t=>{
 const e=environment(t);assert.equal(call(e.store,'jobos1_outcome',{stage:'submitted',source:'user_report',observed_at:new Date().toISOString()}).ok,false);
 const r=e.run('outcome',{company:'Example',title:'<script>alert(1)</script>',job_id:'a',stage:'submitted',source:'user_report',user_confirmed:true,user_ref:'explicit confirmation',observed_at:new Date().toISOString()});assert(!readFileSync(r.presentation.file,'utf8').includes('<script>'));assert.equal(r.application.submission_evidence,'user_reported');
});
