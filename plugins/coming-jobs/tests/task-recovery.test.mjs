import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, seedProfile, seedJob } from './helpers.mjs';
import { call } from '../src/service.mjs';

function setup(t, count = 6) {
    const e = environment(t);
    seedProfile(e);
    const jobs = Array.from({ length: count }, (_, i) => seedJob(e, i + 1));
    const tasks = jobs.map(job => ({ kind: 'job_assessment', inputs: [{ kind: 'job', id: job.id }], authorization_ref: 'Synthetic authorized matching' }));
    e.run('tasks', { operation: 'plan', parent_run_id: 'recovery-run', tasks });
    return { ...e, jobs };
}
const claim = e => e.run('tasks', { operation: 'claim', parent_run_id: 'recovery-run', host_capacity: 3, worker_available: true, limit: 3 });
function expire(e, tasks) {
    for (const task of tasks) {
        const current = e.store.get('agent_task', task.id);
        e.store.put('agent_task', task.id, { ...current, expires_at: '2000-01-01T00:00:00Z' });
    }
}

test('expired workers release slots and input locks without accepting their late results', t => {
    const e = setup(t), first = claim(e).tasks;
    assert.equal(first.length, 3);
    expire(e, first);
    const second = claim(e).tasks;
    assert.equal(second.length, 3, 'expired workers must not starve the remaining queue');
    assert(second.every(task => !first.some(old => old.attempt_id === task.attempt_id)));
    assert(first.every(task => e.store.get('agent_attempt', task.attempt_id).state === 'expired'));
    const late = call(e.store, 'jobos1_tasks', { operation: 'complete', task_id: first[0].id, attempt_id: first[0].attempt_id, input_hash: first[0].input_hash, results: [] });
    assert.equal(late.ok, false);
    assert.equal(late.error.code, 'task_attempt_changed');
});

test('repeated worker crashes have a finite retry budget and allow explicit takeover', t => {
    const e = setup(t, 3);
    for (let attempt = 0; attempt < 3; attempt++) {
        const tasks = claim(e).tasks;
        assert.equal(tasks.length, 3);
        expire(e, tasks);
    }
    const exhausted = claim(e);
    assert.equal(exhausted.tasks.length, 0);
    assert.equal(exhausted.blocked.length, 3);
    assert(exhausted.blocked.every(task => task.needs_takeover));
    const resumed = e.run('tasks', { operation: 'takeover', task_id: exhausted.blocked[0].id, reason: 'interrupted' });
    assert.equal(resumed.owner, 'main');
    assert.equal(resumed.state, 'running');
});

test('one stale task cannot roll back dispatch of unrelated fresh tasks', t => {
    const e = setup(t, 6);
    const oldest = e.store.all('agent_task')[0];
    const job = e.store.get('job', oldest.spec.inputs[0].id);
    e.store.put('job', job.id, { ...job, jd: job.jd + '\nSynthetic changed duty.', content_hash: 'synthetic-new-content' });
    const result = claim(e);
    assert.equal(result.tasks.length, 3);
    assert(result.tasks.every(task => task.id !== oldest.id));
    assert.equal(result.blocked.find(task => task.id === oldest.id).blocked_reason, 'task_inputs_changed');
});

test('a live worker retains its lock and expiry in another run is reclaimed globally', t => {
    const e = setup(t, 6), first = claim(e).tasks;
    assert.equal(claim(e).tasks.length, 0);
    for (const task of first) {
        const current = e.store.get('agent_task', task.id);
        e.store.put('agent_task', task.id, { ...current, parent_run_id: 'older-run', expires_at: '2000-01-01T00:00:00Z' });
    }
    assert.equal(claim(e).tasks.length, 3);
});
