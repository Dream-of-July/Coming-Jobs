import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, seedApplication, seedPlan } from './helpers.mjs';
import { dailySetup, addCompany, drive, mapped } from './daily-helpers.mjs';
import { call } from '../src/service.mjs';
import { opportunity } from '../src/opportunities.mjs';
import { now } from '../src/core.mjs';

function rule(e, fixture, limit, extra = {}) {
    return e.run('daily', { operation: 'opportunity', company_id: fixture.company.id,
        track: fixture.scope.track, campaign: fixture.scope.campaign, limit,
        source: 'official', source_ref: 'https://jobs.example.com/synthetic-choice-rules', observed_at: now(), ...extra });
}
function ready(t, { count = 6, limit = 4, volunteer_order = 'parallel', parent = false } = {}) {
    const e = environment(t); dailySetup(e);
    const fixture = addCompany(e, '合成多志愿公司', count);
    if (parent) fixture.jobs = fixture.jobs.map((job, i) => i < 2 ? { ...job, parent_application_id: 'synthetic-shared-parent' } : job);
    rule(e, fixture, limit, { volunteer_order });
    const done = drive(e, [fixture]);
    return { e, fixture, done, card: done.report.report.cards[0] };
}
const chooseDaily = (e, done, choice) => call(e.store, 'jobos1_daily', { operation: 'choose', report_id: done.report.report.id,
    label: 'A', confirmed: true, user_ref: '合成用户明确选择这些岗位及准备顺序', ...choice });
const batchFor = (e, fixture) => e.run('shortlist', { operation: 'daily', mode: 'live', companies: [fixture.company.name] });
const chooseBatch = (e, batch, numbers) => call(e.store, 'jobos1_shortlist', { operation: 'choose', batch_id: batch.id,
    numbers, confirmed: true, user_ref: '合成用户选择同一公司多个合适岗位' });
function removeFromCatalogue(e, jobId) {
    const removed = e.store.get('job', jobId), collection = e.store.all('collection')[0];
    const external_ids = collection.external_ids.filter(id => id !== removed.external_id);
    const revise = entry => ({ ...entry, external_ids: [...external_ids], total: external_ids.length, observed_at: now() });
    e.store.put('collection', collection.id, { ...collection, external_ids, total: external_ids.length,
        entries: collection.entries.map(revise), live_entries: collection.live_entries.map(revise), observed_at: now(), live_checked_at: now() });
}

test('daily exposes four suitable choices when verified allowance is four instead of stopping at three', t => {
    const { e, card } = ready(t);
    assert.equal(card.items.length, 4);
    assert.equal(card.application_strategy.choices.length, 4);
    assert.equal(card.application_strategy.scopes[0].eligible_count, 6);
    assert.equal(card.application_strategy.scopes[0].remaining, 4);
    assert.equal(card.application_strategy.scopes[0].unused_slots, 0);
    assert.equal(e.store.all('application').length, 0, 'a recommendation must not create or submit applications');
});

test('explicit daily multi-choice prepares every requested role and retry resumes the same drafts', t => {
    const { e, done, card } = ready(t);
    const first = chooseDaily(e, done, { role_numbers: [2, 1, 4, 3] });
    assert.equal(first.ok, true, JSON.stringify(first.error));
    const apps = first.data.applications;
    assert.equal(apps.length, 4);
    assert.deepEqual(apps.map(app => app.job_id), [2, 1, 4, 3].map(n => card.items[n - 1].job_id));
    assert.equal(first.data.application.id, apps[0].id, 'the legacy singular result remains available');
    assert(apps.every(app => app.stage === 'preparing' && !app.submission_evidence));
    assert(apps.every(app => app.application_choices.join() === apps.map(a => a.id).join()));
    const again = chooseDaily(e, done, { role_numbers: [2, 1, 4, 3] });
    assert.equal(again.ok, true, JSON.stringify(again.error));
    assert.deepEqual(again.data.applications.map(app => app.id), apps.map(app => app.id));
    assert.equal(e.store.all('application').length, 4);
});

test('shortlist rejects a whole selection that exceeds remaining quota without creating partial drafts', t => {
    const { e, fixture } = ready(t, { limit: 2 });
    const batch = batchFor(e, fixture);
    const tooMany = chooseBatch(e, batch, [1, 2, 3]);
    assert.equal(tooMany.ok, false);
    assert.equal(tooMany.error.code, 'opportunity_reserved');
    assert.equal(e.store.all('application').length, 0);
    const fitting = chooseBatch(e, batch, [2, 1]);
    assert.equal(fitting.ok, true, JSON.stringify(fitting.error));
    assert.equal(fitting.data.applications.length, 2);
});

test('existing preparation reserves its slot across later selections while the same draft remains resumable', t => {
    const { e, fixture } = ready(t, { limit: 1 });
    const batch = batchFor(e, fixture), first = chooseBatch(e, batch, [1]);
    assert.equal(first.ok, true, JSON.stringify(first.error));
    const quota = opportunity(e.store, fixture.company, fixture.scope);
    assert.equal(quota.remaining, 1, 'a local draft has not consumed an official submission');
    assert.equal(quota.reserved, 1);
    assert.equal(quota.new_capacity, 0);
    const second = chooseBatch(e, batch, [2]);
    assert.equal(second.ok, false);
    assert.equal(second.error.code, 'opportunity_reserved');
    const again = chooseBatch(e, batch, [1]);
    assert.equal(again.ok, true, JSON.stringify(again.error));
    assert.equal(again.data.applications[0].id, first.data.applications[0].id);
    assert.equal(e.store.all('application').length, 1);
});

test('multiple directions under one parent occupy one proposed choice instead of padding spare slots', t => {
    const { e, fixture, done } = ready(t, { count: 3, limit: 3, parent: true });
    const report = e.run('daily', { operation: 'report', run_id: done.run.id }).report;
    const strategy = report.cards[0].application_strategy;
    assert.ok(strategy, 'the daily card must expose the company application strategy');
    assert.equal(strategy.choices.length, 2);
    assert.equal(strategy.scopes[0].unused_slots, 1);
    assert.equal(strategy.scopes[0].shortage_reason, 'no_more_suitable_distinct_jobs');
    const batch = batchFor(e, fixture);
    const duplicateParents = batch.items.filter(item => e.store.get('job', item.job_id).parent_application_id);
    assert.equal(duplicateParents.length, 2, 'directions remain available for comparison before choosing one');
    const result = chooseBatch(e, batch, duplicateParents.map(item => item.number));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'duplicate_application_choice');
});

test('unknown allowance stays unknown in the exposed company strategy', t => {
    const { e, fixture } = ready(t, { limit: 2 });
    rule(e, fixture, null);
    const batch = batchFor(e, fixture);
    assert.ok(batch.application_strategies?.length, 'an unknown rule still needs a visible company strategy');
    const strategy = batch.application_strategies[0], scope = strategy.scopes[0];
    assert.equal(scope.remaining, null);
    assert.equal(scope.new_capacity, null);
    assert.equal(scope.status, 'needs_verification');
    assert.equal(strategy.choices.length, 0);
    assert(scope.blockers.includes('opportunity_unverified'));
    assert.equal(e.store.all('application').length, 0);
});

test('ordered company choices preserve the user preparation order without inventing portal preference ranks', t => {
    const { e, done } = ready(t, { count: 2, limit: 2, volunteer_order: 'ordered' });
    const result = chooseDaily(e, done, { role_numbers: [2, 1] });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.deepEqual(result.data.applications.map(app => app.application_choice_order.preparation_position), [1, 2]);
    assert(result.data.applications.every(app => app.application_choice_order.volunteer_order === 'ordered'));
    assert(result.data.applications.every(app => app.application_choice_order.portal_preference_rank === null));
    assert.equal(result.data.application_strategy.scopes[0].order_confirmation_required, true);
});

test('ambiguous or duplicate daily choices fail before any application is created', t => {
    const { e, done } = ready(t);
    for (const choice of [{ role_number: 1, role_numbers: [2] }, { role_numbers: [1, 1] }, {}]) {
        const result = chooseDaily(e, done, choice);
        assert.equal(result.ok, false);
        assert.equal(result.error.code, 'invalid_selection');
        assert.equal(e.store.all('application').length, 0);
    }
});

test('withdrawn applications still consume their verified company allowance', t => {
    const { e, fixture, done } = ready(t, { count: 3, limit: 2 });
    const job = e.store.all('job')[0];
    e.store.put('application', 'synthetic-withdrawn-choice', { company: fixture.company.name, mode: 'live', stage: 'withdrawn',
        submission_evidence: 'official_portal', job_id: job.id, job_snapshot: job });
    const card = e.run('daily', { operation: 'report', run_id: done.run.id }).report.cards[0];
    assert.ok(card.application_strategy, 'remaining choices need a strategy after withdrawal');
    assert.equal(card.application_strategy.scopes[0].used, 1);
    assert.equal(card.application_strategy.scopes[0].remaining, 1);
    assert.equal(card.application_strategy.choices.length, 1);
    assert(card.application_strategy.choices.every(choice => choice.job_id !== job.id));
});

test('a role removed from the current official catalogue cannot reappear in the application strategy', t => {
    const { e, fixture, card } = ready(t);
    const removed = e.store.get('job', card.application_strategy.choices[0].job_id);
    removeFromCatalogue(e, removed.id);
    const batch = batchFor(e, fixture);
    assert(batch.items.every(item => item.job_id !== removed.id));
    assert(batch.application_strategies[0].choices.every(choice => choice.job_id !== removed.id));
});

test('reopening the report preserves the user chosen preparation order for ordered companies', t => {
    const { e, done, card } = ready(t, { count: 2, limit: 2, volunteer_order: 'ordered' });
    const chosen = chooseDaily(e, done, { role_numbers: [2, 1] });
    assert.equal(chosen.ok, true, JSON.stringify(chosen.error));
    const strategy = e.run('daily', { operation: 'report', run_id: done.run.id }).report.cards[0].application_strategy;
    assert.deepEqual(strategy.choices.map(choice => choice.job_id), [card.items[1].job_id, card.items[0].job_id]);
});

test('an older numbered batch cannot prepare a role removed from the verified current catalogue', t => {
    const { e, fixture } = ready(t);
    const batch = batchFor(e, fixture);
    removeFromCatalogue(e, batch.items[0].job_id);
    const result = chooseBatch(e, batch, [1]);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'job_not_listed');
    assert.equal(e.store.all('application').length, 0);
});

test('additive choices append to the saved company scope order and retries cannot reorder it', t => {
    const { e, done, card } = ready(t, { volunteer_order: 'ordered' });
    const first = chooseDaily(e, done, { role_numbers: [2, 1] });
    assert.equal(first.ok, true, JSON.stringify(first.error));
    const expected = [2, 1, 3].map(n => card.items[n - 1].job_id);
    for (const role_numbers of [[3], [3], [1, 2]]) {
        const added = chooseDaily(e, done, { role_numbers });
        assert.equal(added.ok, true, JSON.stringify(added.error));
        assert.deepEqual(added.data.application_strategy.choices.slice(0, 3).map(choice => choice.job_id), expected);
    }
    const applications = e.store.all('application').sort((a, b) => a.application_choice_order.preparation_position - b.application_choice_order.preparation_position);
    assert.deepEqual(applications.map(app => app.job_id), expected);
    assert(applications.every(app => app.application_choices.join() === applications.map(item => item.id).join()));
    const reopened = e.run('daily', { operation: 'report', run_id: done.run.id }).report;
    assert.deepEqual(reopened.cards[0].application_strategy.choices.slice(0, 3).map(choice => choice.job_id), expected);
    assert.equal(e.store.all('application').length, 3);
});

test('confirmed rejection cancels an untouched preparation and frees only its local reservation', t => {
    const { e, fixture } = ready(t, { limit: 1 });
    const batch = batchFor(e, fixture), chosen = chooseBatch(e, batch, [1]);
    assert.equal(chosen.ok, true, JSON.stringify(chosen.error));
    const app = chosen.data.applications[0];
    const feedback = e.run('shortlist', { operation: 'feedback', job_id: app.job_id, decision: 'reject',
        confirmed: true, user_ref: '合成用户不再准备这个未提交岗位' });
    assert.deepEqual(feedback.preparation_cancellation?.cancelled_application_ids, [app.id]);
    assert.equal(e.store.get('application', app.id).stage, 'cancelled_preparation');
    const quota = opportunity(e.store, fixture.company, fixture.scope);
    assert.equal(quota.used, 0);
    assert.equal(quota.reserved, 0);
    assert.equal(quota.new_capacity, 1);
    const replacement = chooseBatch(e, batch, [2]);
    assert.equal(replacement.ok, true, JSON.stringify(replacement.error));
    assert.equal(e.store.all('application').length, 2, 'cancelled preparation remains in history');
    const retry = e.run('shortlist', { operation: 'feedback', job_id: app.job_id, decision: 'reject',
        confirmed: true, user_ref: '合成用户不再准备这个未提交岗位' });
    assert.deepEqual(retry.preparation_cancellation?.cancelled_application_ids, [app.id]);
    assert.equal(opportunity(e.store, fixture.company, fixture.scope).reserved, 1);
});

test('cancelling an unexecuted authorized plan revokes grants and later explicit selection starts without them', t => {
    const e = environment(t), seeded = seedApplication(e, 'live'), plan = seedPlan(e, seeded);
    e.run('jobs', { operation: 'assess', assessments: mapped(e, { jobs: [seeded.job] }) });
    assert(e.store.get('application', seeded.app.id).authorization);
    e.run('shortlist', { operation: 'feedback', job_id: seeded.job.id, decision: 'reject', confirmed: true, user_ref: '取消本地准备' });
    const cancelled = e.store.get('application', seeded.app.id);
    assert.equal(cancelled.stage, 'cancelled_preparation');
    assert.equal(cancelled.authorization, null);
    assert.equal(cancelled.review, null);
    const write = call(e.store, 'jobos1_authorize', { application_id: seeded.app.id, plan_hash: plan.content_hash,
        portal_url: 'https://jobs.example.com/application', session_id: 'session', confirmed: true, user_ref: '旧的准备授权' });
    assert.equal(write.ok, false);
    assert.equal(write.error.code, 'application_locked');
    e.run('shortlist', { operation: 'feedback', job_id: seeded.job.id, decision: 'save', confirmed: true, user_ref: '重新考虑岗位' });
    const batch = e.run('shortlist', { operation: 'daily', mode: 'live', companies: [seeded.job.company] });
    assert(batch.items.some(item => item.job_id === seeded.job.id), 'a saved local cancellation must be available for an explicit new choice');
    const selected = chooseBatch(e, batch, [batch.items.find(item => item.job_id === seeded.job.id).number]);
    assert.equal(selected.ok, true, JSON.stringify(selected.error));
    const resumed = selected.data.applications[0];
    assert.equal(resumed.id, seeded.app.id);
    assert.equal(resumed.stage, 'preparing');
    assert.equal(resumed.authorization, null);
    assert.equal(resumed.plan_id, null);
    assert.equal(e.store.all('application').length, 1);
});

test('confirmed company rejection cancels only untouched preparations in that company and mode', t => {
    const { e, fixture, done } = ready(t, { limit: 2 });
    const selected = chooseDaily(e, done, { role_numbers: [2, 1] });
    assert.equal(selected.ok, true, JSON.stringify(selected.error));
    const outcome = e.run('daily', { operation: 'feedback', company_id: fixture.company.id, decision: 'reject',
        confirmed: true, user_ref: '不再准备该公司尚未提交的岗位' });
    assert.deepEqual(new Set(outcome.preparation_cancellation?.cancelled_application_ids), new Set(selected.data.applications.map(app => app.id)));
    assert.equal(opportunity(e.store, fixture.company, fixture.scope).reserved, 0);
});

test('stale job observations cannot remain selectable through daily cards or an older shortlist', t => {
    const { e, fixture, done } = ready(t);
    const batch = batchFor(e, fixture);
    for (const job of e.store.all('job')) e.store.put('job', job.id, { ...job, observed_at: new Date(Date.now() - 8 * 86400000).toISOString() });
    const report = e.run('daily', { operation: 'report', run_id: done.run.id }).report;
    assert.equal(report.cards.length, 0);
    assert.equal(report.application_strategies[0].status, 'needs_verification');
    const dailyChoice = chooseDaily(e, done, { role_number: 1 });
    assert.equal(dailyChoice.ok, false);
    assert.equal(dailyChoice.error.code, 'daily_report_stale');
    const batchChoice = chooseBatch(e, batch, [1]);
    assert.equal(batchChoice.ok, false);
    assert.equal(batchChoice.error.code, 'job_observation_stale');
    assert.equal(e.store.all('application').length, 0);
});

test('unchanged full manifest revalidation refreshes job observations without reassessing identical content', t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-08T01:00:00Z') });
    const { e, fixture } = ready(t);
    const previous = new Map(e.store.all('job').map(job => [job.id, job.content_hash]));
    t.mock.timers.tick(8 * 86400000);
    rule(e, fixture, 4, { volunteer_order: 'parallel' });
    const checked = drive(e, [fixture], { unchanged: true });
    assert.equal(checked.fetched, 0);
    assert.equal(checked.assessed, 0);
    assert.equal(checked.report.report.cards[0].application_strategy.choices.length, 4);
    assert(e.store.all('job').every(job => job.observed_at === now() && job.content_hash === previous.get(job.id)));
    const selected = chooseDaily(e, checked, { role_numbers: [2, 1, 3, 4] });
    assert.equal(selected.ok, true, JSON.stringify(selected.error));
});

test('rejection never releases submitted, withdrawn, rejected, or unknown-outcome applications', t => {
    for (const stage of ['submitted', 'withdrawn', 'rejected', 'unknown']) {
        const { e, fixture } = ready(t, { count: 1, limit: 1 });
        const selected = chooseBatch(e, batchFor(e, fixture), [1]);
        assert.equal(selected.ok, true, JSON.stringify(selected.error));
        const app = selected.data.applications[0];
        e.store.put('application', app.id, { ...app, stage, submission_evidence: stage === 'unknown' ? 'unverified' : 'portal_observed' });
        const before = opportunity(e.store, fixture.company, fixture.scope);
        const feedback = e.run('shortlist', { operation: 'feedback', job_id: app.job_id, decision: 'reject',
            confirmed: true, user_ref: '合成用户不再考虑这个岗位' });
        assert.deepEqual(feedback.preparation_cancellation.cancelled_application_ids, []);
        const after = opportunity(e.store, fixture.company, fixture.scope);
        assert.equal(e.store.get('application', app.id).stage, stage);
        assert.equal(after.used, before.used);
        assert.equal(after.new_capacity, before.new_capacity);
        assert.equal(after.state, stage === 'unknown' ? 'needs_verification' : 'exhausted');
    }
});

test('portal execution or a final review blocks local cancellation and keeps its reservation', t => {
    for (const state of ['pending', 'unknown', 'complete', 'final_review']) {
        const { e, fixture } = ready(t, { count: 1, limit: 1 });
        const selected = chooseBatch(e, batchFor(e, fixture), [1]);
        assert.equal(selected.ok, true, JSON.stringify(selected.error));
        const app = selected.data.applications[0];
        if (state === 'final_review') e.store.put('application', app.id, { ...app, review: { ready: true, reviewed_at: now() } });
        else e.store.put('execution_batch', 'synthetic-existing-portal-batch', { application_id: app.id, state });
        const feedback = e.run('shortlist', { operation: 'feedback', job_id: app.job_id, decision: 'reject',
            confirmed: true, user_ref: '合成用户请求停止准备' });
        assert.deepEqual(feedback.preparation_cancellation.cancelled_application_ids, []);
        assert.deepEqual(feedback.preparation_cancellation.blocked.map(item => item.application_id), [app.id]);
        assert.equal(e.store.get('application', app.id).stage, 'preparing');
        assert.equal(opportunity(e.store, fixture.company, fixture.scope).new_capacity, 0);
    }
});
