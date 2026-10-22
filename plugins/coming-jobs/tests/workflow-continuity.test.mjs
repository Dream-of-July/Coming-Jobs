import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, seedApplication, seedJob, seedPlan } from './helpers.mjs';
import { createApplication } from '../src/jobs.mjs';
import { guidance } from '../src/flow.mjs';
import { queue } from '../src/followup.mjs';
import { renderProgress } from '../src/progress.mjs';

test('after one submission guidance continues explicitly selected siblings in the user order', t => {
    const env = environment(t), seeded = seedApplication(env);
    const second = createApplication(env.store, seedJob(env, 2).id, 'Synthetic selection');
    const third = createApplication(env.store, seedJob(env, 3).id, 'Synthetic selection');
    env.store.put('application', seeded.app.id, { ...seeded.app, stage: 'submitted', application_choices: [seeded.app.id, third.id, second.id] });
    assert.equal(guidance(env.store, seeded.app.id).application_id, third.id);
});

test('an unrecorded grant first checks existing session authorization instead of demanding a new user turn', t => {
    const env = environment(t), seeded = seedApplication(env);
    seedPlan(env, seeded);
    const app = env.store.get('application', seeded.app.id);
    env.store.put('application', app.id, { ...app, authorization: null });
    const flow = guidance(env.store, app.id);
    assert.equal(flow.next.owner, 'agent');
    assert.equal(flow.next.action, 'check_authorization');
    assert.equal(flow.can_auto_continue, true);
    assert.equal(env.store.get('application', app.id).authorization, null);
});

test('a cancelled local preparation is neither resumed nor treated as an external application to follow up', t => {
    const env = environment(t), seeded = seedApplication(env, 'live');
    env.store.put('application', seeded.app.id, { ...seeded.app, stage: 'cancelled_preparation', plan_id: null, authorization: null, review: null });
    const flow = guidance(env.store, seeded.app.id);
    assert.equal(flow.next.action, 'choose');
    assert.equal(flow.can_auto_continue, false);
    assert.match(flow.next.prompt, /取消/);
    assert.deepEqual(queue(env.store), []);
    const html = renderProgress(env.store.all('application'), null, new Date().toISOString());
    assert.match(html, /已取消准备/);
    assert.match(html, /未提交（本地取消）/);
    assert.match(html, /无需跟进/);
    const nextApp = createApplication(env.store, seedJob(env, 2, 'live').id, 'Synthetic selection');
    assert.equal(guidance(env.store, seeded.app.id).application_id, nextApp.id);
});
