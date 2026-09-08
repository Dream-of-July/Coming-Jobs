/** Offline DOM rendering + live core integration, NOT browser-navigation or Codex CUA certification. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { environment, seedApplication, seedPlan, checkpointArgs, seedJob } from '../plugins/coming-jobs/tests/helpers.mjs';
import { dashboardView } from '../plugins/coming-jobs/src/web.mjs';
import { call } from '../plugins/coming-jobs/src/service.mjs';
import { renderHTML } from '../plugins/coming-jobs/src/materials.mjs';
import { ROOT, now } from '../plugins/coming-jobs/src/core.mjs';
const { chromium } = await import(process.env.JOBOS_PLAYWRIGHT || 'playwright');
const out = process.env.JOBOS_QA_OUT ?? path.resolve('qa-output');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.JOBOS_QA_CHROMIUM || undefined, headless: true });
const e = environment(), checks = [];
const check = (name, ok) => { assert(ok, name); checks.push({ name, status: 'PASS' }); };
try {
    const s = seedApplication(e, 'demo'), plan = seedPlan(e, s);
    e.run('checkpoint', checkpointArgs(s, plan));
    e.run('outcome', { application_id: s.app.id, stage: 'assessment', source: 'official_portal', observed_at: now(), job_id: '1', observation_ref: 'synthetic-only', actual_resume_sha256: s.material.asset.sha256 });
    e.run('profile', { operation: 'recommend' });
    const ev = e.store.all('fact').find(f => f.key === 'project.anchor').id;
    for (let i = 2; i <= 11; i++) {
        const j = seedJob(e, i);
        e.run('jobs', { operation: 'assess', assessments: [{ job_id: j.id, job_hash: j.content_hash, eligibility: 'pass', mappings: j.requirements.map(r => ({ requirement_id: r.id, relation: 'direct', evidence_ids: [ev], reason: '合成项目映射' })), advantages: ['AI 记忆交互经验', '用户研究与可运行原型'], gaps: ['仅用于演练，不代表真实岗位'], reason: '岗位职责与已确认的项目经验对应，值得进一步核对。' }] });
    }
    e.run('shortlist', { operation: 'daily', mode: 'demo' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.exposeFunction('__localCore', ({ url, options }) => {
        if (url === '/api/view')
            return { status: 200, data: dashboardView(e.store) };
        if (url === '/api/call') {
            const { name, arguments: a } = JSON.parse(options.body);
            const r = call(e.store, name, a);
            return { status: r.ok ? 200 : 400, data: r };
        }
        return { status: 404, data: { error: 'not_found' } };
    });
    let html = readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace('<link rel="stylesheet" href="/app.css">', '').replace('<script src="/app.js" defer></script>', '');
    await page.setContent(html);
    await page.addStyleTag({ content: readFileSync(path.join(ROOT, 'web/app.css'), 'utf8') });
    await page.evaluate(() => { window.fetch = async (url, options = {}) => { const r = await window.__localCore({ url, options }); return { ok: r.status === 200, status: r.status, json: async () => r.data }; }; });
    await page.addScriptTag({ content: readFileSync(path.join(ROOT, 'web/app.js'), 'utf8') });
    await page.waitForFunction(() => document.querySelector('#stage').textContent !== '读取工作区');
    check('next action visible after initial render', await page.locator('#next-detail').innerText().then(t => t.includes('编号')));
    await page.screenshot({ path: path.join(out, 'dashboard-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: '我的资料', exact: true }).click();
    const card = page.locator('.fact').filter({ has: page.getByRole('heading', { name: '姓名', exact: true }) });
    await card.getByRole('button', { name: '更正' }).click();
    await page.locator('#editor-value').fill('陈同学·更正');
    await page.locator('#editor-save').click();
    await page.waitForFunction(() => !document.querySelector('#editor').open);
    check('profile edit saved through the actual core', e.store.all('fact').find(f => f.key === 'name').value === '陈同学·更正');
    await page.getByRole('button', { name: '岗位推荐', exact: true }).click();
    check('ten frozen recommendations displayed', await page.locator('.job-check').count() === 10);
    await page.locator('.job-check').first().check();
    await page.locator('#choose-jobs').click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('已保存'));
    check('selection creates a durable application', e.store.all('application').length === 2);
    await page.screenshot({ path: path.join(out, 'recommendations.png'), fullPage: true });
    await page.getByRole('button', { name: '投递进度', exact: true }).click();
    check('both applications displayed', await page.locator('#panel h3').count() === 2);
    await page.getByRole('button', { name: '面试与复盘', exact: true }).click();
    check('interview panel provides an actionable entry', await page.locator('#copy-interview').count() === 1);
    await page.getByRole('button', { name: '偏好与跟进', exact: true }).click();
    await page.selectOption('#template', 'clean');
    await page.locator('#save-settings').click();
    await page.waitForTimeout(100);
    check('template setting persists', e.store.get('settings', 'preferences').template === 'clean');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '今日工作台', exact: true }).click();
    await page.screenshot({ path: path.join(out, 'dashboard-mobile.png'), fullPage: true });
    check('mobile page has no body overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const form = await browser.newPage();
    await form.setContent('<label>姓名<input id="name"></label><label>学校<select id="school"><option value="">请选择</option><option value="school">合成大学</option></select></label><button>提交</button>');
    await form.getByLabel('姓名').fill('陈同学');
    await form.getByLabel('学校').selectOption('school');
    check('real DOM text and selection state are distinct', await form.locator('#school').evaluate(el => el.selectedOptions[0].label) === '合成大学');
    // Two exact production HTML templates are rendered to PDFs from owned content.
    const content = { name: '林澈', headline: 'AI 产品经理 / 交互体验 · 合成示例', contact: 'lin@example.com · 作品集可提供', sections: [
            { title: '个人概述', items: [{ text: '产品设计背景，关注 AI 体验、用户研究与软硬件协同。通过可运行原型验证交互，把抽象需求转化为能被团队讨论、测试和迭代的产品方案。' }] },
            { title: '实习经历', items: [{ text: '示例智能科技｜产品经理实习生\n围绕语音助手的记忆与纠错体验，梳理信息架构、权限状态和异常恢复路径；与设计、研发共同评审交互方案。' }, { text: '示例影像实验室｜交互产品实习生\n制作遥控设备交互原型，比较不同控制映射的学习成本；整理测试观察和问题优先级，推动下一轮验证。' }] },
            { title: '代表项目', items: [{ text: '可纠正的 AI 记忆\n将记忆采集、用户确认、纠正和删除拆成可理解的操作；设计状态反馈，避免用户把系统推测误认为已经确认的事实。' }, { text: '硬件交互验证原型\n为小屏设备建立可运行模拟器，对比不同控制策略的手感；记录误触、归中和模式切换问题，帮助团队在开发前验证边界。' }, { text: '社区连接概念\n结合位置、活动和轻量互动机制，探索从在线交流到线下参与的路径；明确用户目标、触发条件和活动结束后的反馈。' }] },
            { title: '教育背景', items: [{ text: '示例设计学院｜产品设计本科\n学习用户研究、设计表达、交互原型与产品化方法。' }] },
            { title: '方法与工具', items: [{ text: '需求定义与优先级 · 用户访谈与可用性测试 · Figma 交互原型 · AI 辅助开发 · PRD 与跨团队协作' }] }
        ] };
    for (const template of ['projects', 'clean']) {
        const p = await browser.newPage();
        await p.setContent(renderHTML(content, template));
        await p.emulateMedia({ media: 'print' });
        await p.pdf({ path: path.join(out, template + '.pdf'), printBackground: true, preferCSSPageSize: true });
        check('PDF generated from ' + template + ' template', true);
        await p.screenshot({ path: path.join(out, template + '.png'), fullPage: true });
    }
    writeFileSync(path.join(out, 'render-report.json'), JSON.stringify({ environment: 'Chromium owned-document rendering with direct local-core bridge; browser navigation blocked by environment policy', checks, not_tested: ['Codex CUA host', 'live websites', 'HTTP navigation lifecycle', 'real application timing'] }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, output: out }));
}
finally {
    await browser.close();
    e.store.close();
    rmSync(e.dir, { recursive: true, force: true });
}
