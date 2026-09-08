/** Optional developer QA: npm playwright or a caller-selected installed module.
 * Only an intercepted synthetic portal and a local dashboard are opened.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { environment, seedApplication, seedPlan, checkpointArgs, seedProfile, seedJob } from '../plugins/coming-jobs/tests/helpers.mjs';
import { fillGroup, readControl, preserveTab } from '../plugins/coming-jobs/src/browser.mjs';
import { startDashboard } from '../plugins/coming-jobs/src/web.mjs';
import { now } from '../plugins/coming-jobs/src/core.mjs';
const { chromium } = await import(process.env.JOBOS_PLAYWRIGHT || 'playwright');
const out = process.env.JOBOS_QA_OUT ?? path.resolve('qa-output');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.JOBOS_QA_CHROMIUM || undefined, headless: true });
const env = environment(), checks = [];
let d, portal;
const check = (name, condition) => { assert(condition, name); checks.push({ name, status: 'PASS' }); };
try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let received = 0;
    portal = http.createServer((req, res) => { received++; res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><html><head><meta charset="utf-8"><title>合成招聘表单</title></head><body><h1>合成企业 · AI 产品经理</h1><label>姓名<input id="name"></label><label for="school">学校</label><select id="school"><option value="">请选择</option><option value="synthetic">合成大学</option></select><label>自我描述<textarea id="summary"></textarea></label><label>简历附件<input type="file" id="cv" accept="application/pdf"></label><p>这是隔离演练，不能访问真实招聘服务。</p><button id="submit">提交</button><output id="result"></output><script>document.getElementById('submit').onclick=()=>document.getElementById('result').textContent='合成结果：笔试中';</script></body></html>`); });
    await new Promise(resolve => portal.listen(0, '127.0.0.1', resolve));
    const portalUrl = `http://127.0.0.1:${portal.address().port}/form`, portalOrigin = new URL(portalUrl).origin;
    await page.goto(portalUrl);
    const s = seedApplication(env, 'demo'), plan = seedPlan(env, s, portalUrl), grant = env.store.get('application', s.app.id).authorization;
    const facade = { getByLabel: page.getByLabel.bind(page), getByRole: page.getByRole.bind(page), locator: page.locator.bind(page), waitForEvent: page.waitForEvent.bind(page), domSnapshot: () => page.locator('body').innerText() };
    let retained = 0;
    const tab = { playwright: facade, url: () => page.url(), markHandoff: async () => { retained++; } };
    const groups = plan.groups.map(g => ({ ...g, fields: g.fields.map(f => ({ ...f, locator: { kind: 'label', value: ({ name: '姓名', school: '学校', cv: '简历附件' })[f.key] }, local_file: f.material ? env.store.uploadPath(f.material) : undefined })) }));
    const readUpload = async (f) => {
        const meta = await page.locator('#cv').evaluate(el => ({ count: el.files.length, name: el.files[0]?.name, bytes: el.files[0]?.size }));
        return meta.count ? { key: f.key, file_count: meta.count, file_name: meta.name, file_bytes: meta.bytes, upload_complete: true, local_sha256: f.material.sha256 } : { key: f.key, file_count: 0, upload_complete: false };
    };
    for (const g of groups)
        await fillGroup(tab, g, { origin: portalOrigin, authorization: grant, readUpload,
            saveBefore: async ({ group, before }) => env.run('checkpoint', { ...checkpointArgs(s, plan, [{ key: group, before, fields: before }]), portal_url: portalUrl }),
            saveAfter: async ({ group, before, fields }) => env.run('checkpoint', { ...checkpointArgs(s, plan, [{ key: group, before, fields }]), portal_url: portalUrl }) });
    check('actual text field contains planned value', await page.inputValue('#name') === '陈同学');
    check('native select has a real selected option', await page.inputValue('#school') === 'synthetic');
    const review = env.run('review', { application_id: s.app.id, portal_url: portalUrl });
    check('all required actual browser observations pass', review.ready);
    check('adapter preserves page at every group boundary', retained === 3);
    check('adapter did not click final submit', await page.locator('#result').innerText() === '');
    await page.reload();
    check('synthetic portal reload really clears unsaved text', await page.inputValue('#name') === '');
    const recovery = env.run('recover', { application_id: s.app.id, fields: [{ key: 'name', value: '', selected: false }] });
    check('persisted original and target enable draft restoration', recovery.operations.some(f => f.key === 'name'));
    await page.locator('#name').fill('用户在页面新改的值');
    const conflict = env.run('recover', { application_id: s.app.id, fields: [{ key: 'name', value: await page.inputValue('#name'), selected: false }] });
    check('new user edit is a conflict, not overwritten', conflict.conflicts.length === 1);
    await page.screenshot({ path: path.join(out, 'synthetic-portal.png'), fullPage: true });
    d = await startDashboard(env.store);
    await page.goto(d.url);
    await page.getByText('今日工作台', { exact: true }).first().waitFor();
    await page.waitForFunction(() => document.querySelector('#stage')?.textContent !== '读取工作区');
    check('local dashboard loads through authenticated HTTP', await page.locator('#stage').innerText() !== '读取工作区');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(out, 'dashboard-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: '我的资料', exact: true }).click();
    const card = page.locator('.fact').filter({ has: page.getByRole('heading', { name: '姓名', exact: true }) });
    await card.getByRole('button', { name: '更正' }).click();
    await page.locator('#editor-value').fill('陈同学·已更正');
    await page.locator('#editor-save').click();
    await page.waitForFunction(() => !document.querySelector('#editor').open);
    check('profile edit persists in live database', env.store.all('fact').find(f => f.key === 'name').value === '陈同学·已更正');
    await page.getByRole('button', { name: '投递进度', exact: true }).click();
    check('application appears even without a provider', await page.locator('#panel').innerText().then(t => t.includes('合成企业')));
    await page.getByRole('button', { name: '偏好与跟进', exact: true }).click();
    await page.selectOption('#template', 'clean');
    await page.locator('#save-settings').click();
    await page.waitForTimeout(100);
    check('template preference persists', env.store.get('settings', 'preferences').template === 'clean');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '今日工作台', exact: true }).click();
    await page.screenshot({ path: path.join(out, 'dashboard-mobile.png'), fullPage: true });
    check('mobile viewport has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check('page retains one visible next action', await page.locator('#next-detail').innerText().then(t => t.length > 10));
    check('synthetic portal served on loopback only', received >= 2);
    writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify({ environment: 'real Chromium; synthetic loopback portal; not Codex host CUA', checks, external_submissions: 0 }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, output: out }, null, 2));
}
finally {
    await browser.close();
    if (portal)
        await new Promise(r => portal.close(r));
    if (d)
        await new Promise(r => d.server.close(r));
    env.store.close();
    rmSync(env.dir, { recursive: true, force: true });
}
