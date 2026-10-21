import test from 'node:test';
import assert from 'node:assert/strict';
import { environment } from './helpers.mjs';
import { dailySetup, addCompany, drive } from './daily-helpers.mjs';
import { opportunity } from '../src/opportunities.mjs';
import { call } from '../src/service.mjs';
import { now } from '../src/core.mjs';

const clock = t => t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-08T01:00:00Z') });
const rule = (e, f, fields = {}) => e.run('daily', { operation: 'opportunity', company_id: f.company.id,
    track: f.scope.track, campaign: f.scope.campaign, source: 'official',
    source_ref: 'https://example.com/synthetic-rules', observed_at: now(), ...fields });

test('daily diff uses the same global rank sequence for multiple companies', t => {
    const e = environment(t); dailySetup(e, { target_companies: 2 });
    const fixtures = [addCompany(e, '合成甲', 3), addCompany(e, '合成乙', 3)];
    const first = drive(e, fixtures);
    assert.equal(first.report.report.cards.length, 2);
    const assessment = e.store.all('assessment')[0];
    e.store.put('assessment', assessment.id, { ...assessment, reason: '补充合成任务证据，排序不变' });
    const next = e.run('daily', { operation: 'report', run_id: first.run.id }).report;
    assert.notEqual(next.independent_snapshot_hash, first.report.report.independent_snapshot_hash);
    assert.equal(next.diff.underestimated.length, 0);
    assert.equal(next.diff.overestimated.length, 0);
    assert.equal(next.diff.same.length, 6);
});

test('new official rules can explicitly clear an expired deadline and finite quota', t => {
    clock(t); const e = environment(t); dailySetup(e); const f = addCompany(e);
    rule(e, f, { limit: 0, deadline: '2026-09-07T01:00:00Z' });
    assert.equal(opportunity(e.store, f.company, f.scope).state, 'closed');
    t.mock.timers.tick(1000);
    const saved = rule(e, f, { limit: null, deadline: null });
    assert.equal(saved.limit, null); assert.equal(saved.deadline, null);
    const cleared = opportunity(e.store, f.company, f.scope);
    assert.equal(cleared.state, 'needs_verification'); assert.equal(cleared.remaining, null);
    assert.equal(cleared.deadline, null);
    rule(e, f, { limit: 2 });
    assert.equal(opportunity(e.store, f.company, f.scope).state, 'available');
});

test('omitting a rule field preserves it while null deliberately clears it', t => {
    clock(t); const e = environment(t); dailySetup(e); const f = addCompany(e);
    const deadline = '2027-01-01T00:00:00Z';
    rule(e, f, { limit: 2, deadline });
    const saved = rule(e, f, { can_change: true });
    assert.equal(saved.limit, 2); assert.equal(saved.deadline, new Date(deadline).toISOString());
    assert.equal(rule(e, f, { deadline: null }).limit, 2);
});

test('older rule observations cannot clear newer official restrictions', t => {
    clock(t); const e = environment(t); dailySetup(e); const f = addCompany(e);
    rule(e, f, { limit: 1 });
    const result = call(e.store, 'jobos1_daily', { operation: 'opportunity', company_id: f.company.id,
        track: f.scope.track, campaign: f.scope.campaign, source: 'official',
        source_ref: 'https://example.com/synthetic-rules', observed_at: '2026-09-07T01:00:00Z', limit: null, deadline: null });
    assert.equal(result.error?.code, 'stale_observation');
    assert.equal(opportunity(e.store, f.company, f.scope).remaining, 1);
});

for (const tracks of [['校招'], '校园招聘', ['秋招', '实习']]) {
    test(`daily retains supported recruitment track aliases: ${JSON.stringify(tracks)}`, t => {
        const e = environment(t); dailySetup(e);
        e.run('remember', { mode: 'user_statement', confirmed: true, user_ref: '合成招聘范围确认', facts: [{ key: 'intent.tracks', value: tracks }] });
        const f = addCompany(e);
        assert.equal(drive(e, [f]).report.report.cards.length, 1);
    });
}

test('historical runs persist recovery reports without sending a new notification', t => {
    clock(t); const e = environment(t); dailySetup(e); addCompany(e);
    const { run } = e.run('daily', { operation: 'start' });
    t.mock.timers.tick(86400000);
    const saved = e.run('daily', { operation: 'report', run_id: run.id });
    assert.equal(saved.historical, true); assert.equal(saved.notify, false);
    assert.equal(saved.report.date, '2026-09-08');
    assert.notEqual(e.run('daily', { operation: 'start' }).run.id, run.id);
});

test('recovered complete report keeps its run date and does not rewind the scheduler', t => {
    clock(t); const e = environment(t); dailySetup(e); const f = addCompany(e);
    e.run('daily', { operation: 'bind', host_success: true, provider_task_id: 'synthetic-task', target_thread_id: 'synthetic-thread', result_ref: 'synthetic-binding' });
    const first = drive(e, [f]);
    t.mock.timers.tick(86400000);
    const next = e.run('daily', { operation: 'start' }).run;
    const cursor = e.store.get('settings', 'daily_scheduler').last_run;
    const saved = e.run('daily', { operation: 'report', run_id: first.run.id });
    assert.equal(saved.historical, true); assert.equal(saved.notify, false);
    assert.equal(saved.report.cards.length, 1);
    assert.equal(saved.report.date, first.run.date);
    assert.deepEqual(e.store.get('settings', 'daily_scheduler').last_run, cursor);
    assert.equal(cursor.id, next.id);
    assert.equal(call(e.store, 'jobos1_daily', { operation: 'choose', report_id: saved.report.id,
        label: 'A', role_number: 1, confirmed: true, user_ref: '合成过期选择' }).error?.code, 'daily_report_stale');
});

test('missing daily run returns the stable recovery diagnostic', t => {
    const e = environment(t); dailySetup(e);
    const result = call(e.store, 'jobos1_daily', { operation: 'report', run_id: 'missing-synthetic-run' });
    assert.equal(result.error?.code, 'daily_run_not_found');
});
