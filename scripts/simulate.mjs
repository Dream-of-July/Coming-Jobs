#!/usr/bin/env node
import { environment, seedApplication, seedPlan, checkpointArgs, seedJob } from '../plugins/coming-jobs/tests/helpers.mjs';
import { startDashboard } from '../plugins/coming-jobs/src/web.mjs';
import { now } from '../plugins/coming-jobs/src/core.mjs';
import { rmSync } from 'node:fs';
const env = environment();
try {
    const s = seedApplication(env, 'demo'), p = seedPlan(env, s);
    env.run('profile', { operation: 'recommend' });
    env.run('profile', { operation: 'preferences', preferences: { template: 'projects', timezone: 'Asia/Shanghai' }, confirmed: true, user_ref: '合成演练选择' });
    env.run('checkpoint', checkpointArgs(s, p));
    const review = env.run('review', { application_id: s.app.id, portal_url: 'https://jobs.example.com/application' });
    const outcome = env.run('outcome', { application_id: s.app.id, stage: 'assessment', source: 'official_portal', observed_at: now(), job_id: '1', observation_ref: 'synthetic-only', user_confirmed: true, user_ref: '模拟用户提交', actual_resume_sha256: s.material.asset.sha256 });
    const evidence = env.store.all('fact').find(f => f.key === 'project.anchor').id;
    for (let i = 2; i <= 13; i++) {
        const j = seedJob(env, i);
        env.run('jobs', { operation: 'assess', assessments: [{ job_id: j.id, job_hash: j.content_hash, eligibility: 'pass', mappings: j.requirements.map(r => ({ requirement_id: r.id, relation: i % 3 === 0 ? 'transferable' : 'direct', evidence_ids: [evidence], reason: '合成项目经验映射' })), advantages: ['用户研究与可运行原型', 'AI 记忆交互经验'], gaps: ['仅用于演练，不代表真实岗位或录用结果'], reason: '项目中涉及可纠正的 AI 记忆与交互验证，与岗位工作内容对应。' }] });
    }
    const batch = env.run('shortlist', { operation: 'daily', mode: 'demo' });
    const report = { synthetic: true, external_actions: 0, real_submissions: 0, review_ready: review.ready, stage: outcome.application.stage, recommendations: batch.items.length, workspace: env.dir };
    if (process.argv.includes('--serve')) {
        const d = await startDashboard(env.store);
        console.log(JSON.stringify({ ...report, url: d.url }));
        process.on('SIGINT', () => { d.server.close(); env.store.close(); rmSync(env.dir, { recursive: true, force: true }); process.exit(0); });
    }
    else {
        console.log(JSON.stringify(report, null, 2));
        env.store.close();
        rmSync(env.dir, { recursive: true, force: true });
    }
}
catch (e) {
    console.error(e.message);
    try {
        env.store.close();
    }
    catch { }
    process.exitCode = 1;
}
