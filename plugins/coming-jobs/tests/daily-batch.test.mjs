import test from 'node:test';
import assert from 'node:assert/strict';
import { environment } from './helpers.mjs';
import { dailySetup, addCompany, collect } from './daily-helpers.mjs';

function finishMetadata(e, run, task) {
    e.run('daily', { operation: 'observe', run_id: run.id, task_id: task.id, state: 'done', changed: true, fingerprint: 'batch-fixture-v1' });
}

test('next without limit keeps the legacy singleton response', t => {
    const e = environment(t);
    dailySetup(e);
    addCompany(e);
    const { run } = e.run('daily', { operation: 'start' });
    const result = e.run('daily', { operation: 'next', run_id: run.id });
    assert.ok(result.task);
    assert.equal(result.tasks, undefined);
});

test('limited next allocates independent company tasks atomically and retries pending tasks', t => {
    const e = environment(t);
    dailySetup(e, { metadata_limit: 3 });
    addCompany(e, '批次甲');
    addCompany(e, '批次乙');
    addCompany(e, '批次丙');
    const { run } = e.run('daily', { operation: 'start' });
    const first = e.run('daily', { operation: 'next', run_id: run.id, limit: 3 });
    assert.equal(first.tasks.length, 3);
    assert.equal(new Set(first.tasks.map(t => `${t.company_id}:${t.scope.track}:${t.scope.campaign}`)).size, 3);
    const retry = e.run('daily', { operation: 'next', run_id: run.id, limit: 3 });
    assert.deepEqual(new Set(retry.tasks.map(t => t.id)), new Set(first.tasks.map(t => t.id)));
});

test('a pending dependency does not prevent an independent company from joining a batch', t => {
    const e = environment(t);
    dailySetup(e, { metadata_limit: 2 });
    const a = addCompany(e, '依赖甲'), b = addCompany(e, '依赖乙');
    const { run } = e.run('daily', { operation: 'start' });
    const one = e.run('daily', { operation: 'next', run_id: run.id });
    finishMetadata(e, run, one.task);
    const batch = e.run('daily', { operation: 'next', run_id: run.id, limit: 2 });
    assert.equal(batch.tasks.length, 2);
    assert.deepEqual(new Set(batch.tasks.map(task => task.company_id)), new Set([a.company.id, b.company.id]));
    assert.notEqual(batch.tasks[0].id, batch.tasks[1].id);
});

test('batch reservations never exceed the configured assessment budget', t => {
    const e = environment(t);
    dailySetup(e, { assessment_limit: 4, metadata_limit: 3 });
    addCompany(e, '预算甲');
    addCompany(e, '预算乙');
    const { run } = e.run('daily', { operation: 'start' });
    const metadata = e.run('daily', { operation: 'next', run_id: run.id, limit: 2 });
    metadata.tasks.forEach(task => finishMetadata(e, run, task));
    const next = e.run('daily', { operation: 'next', run_id: run.id, limit: 3 });
    const issued = next.tasks.filter(task => task.kind === 'collect').reduce((sum, task) => sum + task.detail_limit, 0);
    assert.ok(issued <= 4);
    assert.equal(next.budget.reserved_downloaded, issued);
    assert.equal(new Set(next.tasks.flatMap(task => task.job_ids ?? [])).size, next.tasks.flatMap(task => task.job_ids ?? []).length);
});


test('collect consumes only its reserved quota and partial releases the rest', t => {
    const e = environment(t); dailySetup(e, { assessment_limit: 6 });
    const fixtures = [addCompany(e, '额度甲', 1), addCompany(e, '额度乙', 1)];
    const { run } = e.run('daily', { operation: 'start' });
    e.run('daily', { operation: 'next', run_id: run.id, limit: 2 }).tasks.forEach(task => finishMetadata(e, run, task));
    const batch = e.run('daily', { operation: 'next', run_id: run.id, limit: 2 });
    const task = batch.tasks.find(t => t.kind === 'collect');
    collect(e, run, task, fixtures.find(f => f.company.id === task.company_id));
    const pending = e.run('daily', { operation: 'next', run_id: run.id, limit: 2 });
    assert.equal(pending.budget.downloaded, 1);
    assert.equal(pending.tasks.find(t => t.id === task.id).detail_limit, task.detail_limit - 1);
    e.run('daily', { operation: 'observe', run_id: run.id, task_id: task.id, state: 'partial', cursor: 'page:2' });
    const budget = e.store.get('daily_budget', run.budget_id);
    assert.equal(budget.reserved_downloaded, batch.budget.reserved_downloaded - task.detail_limit);
});
