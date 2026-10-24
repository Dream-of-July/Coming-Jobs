import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { executeOrdinaryBatch, executeVerificationCode } from '../src/host-batch.mjs';

const origin = 'https://jobs.example.com';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

// Production DOM callbacks run against synthetic controls. The fake transport
// counts actual invocations; this fixture makes no wall-clock speed claims.
function portal(count = 2, { domOrigin = true, aria = false, onWrite = () => {} } = {}) {
    const calls = { url: 0, count: 0, read: 0, write: 0 }, location = { origin }, writes = [];
    const controls = Array.from({ length: count }, (_, index) => ({
        key: 'field-' + index, type: 'text', value: '', maxLength: 100, disabled: false, readOnly: false,
        labels: aria ? [] : [{ textContent: 'Field ' + index }], attrs: aria ? { 'aria-label': 'Field ' + index } : {},
        getAttribute(name) { return this.attrs[name] ?? null; }
    }));
    const byName = name => controls.filter(control => control.attrs['aria-label'] === name || control.labels.some(label => label.textContent === name));
    const tab = { url: async () => { calls.url++; return location.origin + '/form'; }, playwright: {
        getByLabel: name => ({
            count: async () => { calls.count++; return byName(name).length; },
            fill: async value => {
                calls.write++;
                const control = byName(name)[0];
                control.value = value;
                writes.push(control.key);
                await onWrite(control, controls);
            }
        }),
        evaluate: async (fn, argument) => {
            calls.read++;
            return vm.runInNewContext(`(${fn.toString()})(argument)`, {
                document: { querySelectorAll: () => controls, getElementById: () => null }, argument,
                ...(domOrigin ? { location } : {})
            });
        }
    } };
    const batch = { id: 'synthetic-batch', state: 'pending', scope: { origin },
        grant: { origin, expires_at: new Date(Date.now() + 60000).toISOString() },
        targets: controls.map((control, index) => ({ key: control.key, type: 'free_text', value: control.key,
            locator: { kind: 'label', value: 'Field ' + index } })),
        before: controls.map(control => ({ key: control.key, value: '', read_state: 'known' })) };
    return { tab, batch, controls, writes, calls, location };
}

test('eight fields use 25 measured browser calls with origin readback and retain every uniqueness check', async () => {
    const p = portal(8);
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.state, 'complete');
    assert.deepEqual(p.calls, { url: 0, count: 8, read: 9, write: 8 });
    assert.equal(result.metrics.browser_calls, Object.values(p.calls).reduce((sum, value) => sum + value, 0));
    assert.equal(result.metrics.browser_reads, 17);
    assert.equal(result.metrics.browser_writes, 8);
    assert.deepEqual(result.counts, { written: 8, skipped: 0, recovered: 0 });
    assert.equal(result.limits.native_write_timeout, 'host_owned');
});

test('older read facades retain explicit URL checks and report their additional calls', async () => {
    const p = portal(8, { domOrigin: false });
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.state, 'complete');
    assert.equal(p.calls.url, 9);
    assert.equal(result.metrics.browser_calls, 34);
});

test('ARIA-only controls still use observed semantic identity', async () => {
    const p = portal(2, { aria: true });
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.state, 'complete');
    assert.deepEqual(p.writes, ['field-0', 'field-1']);
});

test('an existing target is skipped without weakening final group readback', async () => {
    const p = portal();
    p.controls[0].value = p.batch.targets[0].value;
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.state, 'complete');
    assert.deepEqual(result.counts, { written: 1, skipped: 1, recovered: 0 });
    assert.deepEqual(p.writes, ['field-1']);
});

test('a later reset is reported as a conflict using final values', async () => {
    const p = portal(2, { onWrite: (control, controls) => { if (control.key === 'field-1') controls[0].value = ''; } });
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.state, 'unknown');
    assert.equal(result.code, 'readback_mismatch');
    assert.equal(result.failure.category, 'conflict');
    assert.equal(result.failure.field_key, 'field-0');
    assert.equal(result.observations[0].value, '');
    assert.equal(result.counts.written, 1);
    assert.equal(result.metrics.browser_writes, 2);
});

test('a user change to the next control is preserved rather than overwritten', async () => {
    const p = portal(2, { onWrite: (control, controls) => { if (control.key === 'field-0') controls[1].value = 'user change'; } });
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.code, 'user_edit');
    assert.equal(result.next, 'preserve_user_edit');
    assert.deepEqual(p.writes, ['field-0']);
    assert.equal(p.controls[1].value, 'user change');
});

test('an applied write followed by a transport error is read back without replay or raw error text', async () => {
    const p = portal(1, { onWrite: () => { throw new Error('private echoed content must not appear'); } });
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.code, 'host_operation_failed');
    assert.equal(result.failure.category, 'external');
    assert.equal(result.failure.phase, 'write');
    assert.deepEqual(result.counts, { written: 1, skipped: 0, recovered: 1 });
    assert.equal(result.metrics.browser_writes, 1);
    assert.equal(result.observations[0].value, 'field-0');
    assert(!JSON.stringify(result).includes('private echoed content'));
});

test('a stalled recovery preserves the original failure and reports the read timeout separately', async () => {
    const p = portal(1, { onWrite: () => { throw new Error('transport'); } });
    const evaluate = p.tab.playwright.evaluate;
    p.tab.playwright.evaluate = (fn, argument) => Array.isArray(argument) ? new Promise(() => {}) : evaluate(fn, argument);
    const result = await executeOrdinaryBatch(p.tab, p.batch, { readTimeoutMs: 5 });
    assert.equal(result.code, 'host_operation_failed');
    assert.equal(result.failure.recovery_code, 'read_timeout');
    assert.equal(result.next, 'continue_other_work_then_readonly_recovery');
    assert.equal(result.metrics.browser_writes, 1);
});

test('a mixed agreement batch stops before any ordinary field is written', async () => {
    const p = portal();
    p.batch.targets[1] = { key: 'agreement', type: 'agreement', value: true };
    p.batch.before[1] = { key: 'agreement', value: false, read_state: 'known' };
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.code, 'agreement_requires_observation');
    assert.equal(result.next, 'observe_agreement');
    assert.equal(result.failure.write_attempted, false);
    assert.equal(result.metrics.browser_calls, 0);
    assert.equal(p.writes.length, 0);
});

test('distinct guard failures keep distinct safe codes', async () => {
    const length = portal(1);
    length.controls[0].maxLength = 1;
    const tooLong = await executeOrdinaryBatch(length.tab, length.batch);
    assert.equal(tooLong.code, 'length_limit');
    assert.equal(tooLong.failure.category, 'blocked');
    assert.equal(length.writes.length, 0);
    const duplicate = portal(1);
    duplicate.controls.push({ ...duplicate.controls[0] });
    const ambiguous = await executeOrdinaryBatch(duplicate.tab, duplicate.batch);
    assert.equal(ambiguous.code, 'unique_match_required');
    assert.equal(duplicate.writes.length, 0);
});

test('origin readback rejects an unexpected recipient before a write', async () => {
    const p = portal(1);
    p.location.origin = 'https://elsewhere.example.com';
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.code, 'origin_changed');
    assert.equal(p.writes.length, 0);
});

test('the final read rejects navigation caused by the last write', async () => {
    let p;
    p = portal(1, { onWrite: () => { p.location.origin = 'https://elsewhere.example.com'; } });
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.code, 'origin_changed');
    assert.equal(result.state, 'unknown');
    assert.equal(p.writes.length, 1);
});

test('a timed-out read may finish later but cannot cause a later write', async () => {
    const p = portal(1), pending = deferred();
    p.tab.playwright.getByLabel = () => ({ count: () => pending.promise, fill: async () => { p.writes.push('unexpected'); } });
    const result = await executeOrdinaryBatch(p.tab, p.batch, { readTimeoutMs: 5 });
    assert.equal(result.code, 'read_timeout');
    assert.equal(result.failure.category, 'timeout');
    assert.equal(result.metrics.read_timeouts, 1);
    pending.resolve(1);
    await delay(5);
    assert.equal(p.writes.length, 0);
});

test('callback latency consumes the cooperative deadline before the next write', async () => {
    const p = portal(1);
    let time = Date.now();
    const evaluate = p.tab.playwright.evaluate;
    p.tab.playwright.evaluate = async (...args) => { const result = await evaluate(...args); time += 500; return result; };
    const result = await executeOrdinaryBatch(p.tab, p.batch, { now: () => time, maxDurationMs: 100 });
    assert.equal(result.code, 'deadline_exceeded');
    assert.equal(p.writes.length, 0);
});

test('a native write is awaited, then a spent budget prevents the next write', async () => {
    const p = portal(2), pending = deferred(), entered = deferred();
    const original = p.tab.playwright.getByLabel;
    p.tab.playwright.getByLabel = name => ({ ...original(name), fill: async value => {
        entered.resolve();
        await pending.promise;
        await original(name).fill(value);
    } });
    let time = Date.now(), settled = false;
    const execution = executeOrdinaryBatch(p.tab, p.batch, { now: () => time, maxDurationMs: 100 }).then(result => { settled = true; return result; });
    await entered.promise;
    time += 500;
    await delay(5);
    assert.equal(settled, false, 'the helper must not return while a native mutation can still take effect');
    pending.resolve();
    const result = await execution;
    assert.equal(result.code, 'deadline_exceeded');
    assert.deepEqual(p.writes, ['field-0']);
    assert.equal(result.metrics.browser_writes, 1);
});

test('settle cannot mutate the prepared target or a later original baseline', async () => {
    const p = portal();
    const result = await executeOrdinaryBatch(p.tab, p.batch, { settle: async field => {
        field.value = 'not approved';
        field.locator.value = 'different locator';
        p.batch.targets[1].value = 'not approved';
        p.batch.before[1].value = 'changed baseline';
    } });
    assert.equal(result.state, 'complete');
    assert.deepEqual(p.controls.map(control => control.value), ['field-0', 'field-1']);
});

test('zero execution budget does not start browser work', async () => {
    const p = portal(1);
    const result = await executeOrdinaryBatch(p.tab, p.batch, { maxDurationMs: 0 });
    assert.equal(result.code, 'deadline_exceeded');
    assert.equal(result.metrics.browser_calls, 0);
});

function authentication() {
    let time = Date.now();
    const writes = [], request = { kind: 'one_time_code', purpose: 'login', request_id: 'synthetic-request', origin,
        account: 'synthetic@example.com', channel: 'email', requested_at: new Date(time - 1).toISOString(),
        expires_at: new Date(time + 60000).toISOString(), locator: { kind: 'label', value: 'Code' } };
    const authorization = { purpose: 'login', origin, account: request.account, channel: 'email', user_ref: 'Synthetic permission',
        expires_at: new Date(time + 60000).toISOString() };
    const message = () => ({ request_id: request.request_id, origin, account: request.account, channel: 'email', received_at: new Date(time).toISOString(), code: 'SYNTH123' });
    const tab = { url: async () => origin + '/login', playwright: { getByLabel: () => ({ count: async () => 1, fill: async value => { writes.push(value); } }) } };
    const options = { authorization, now: () => time, maxWaitMs: 1000, receiveCode: async () => message(), readStatus: async () => writes.length ? 'accepted' : 'pending' };
    return { tab, request, options, writes, message, advance: ms => { time += ms; } };
}

test('verification retrieval cannot write after consuming the entire wait budget', async () => {
    const f = authentication();
    f.options.receiveCode = async () => { f.advance(5000); return f.message(); };
    const result = await executeVerificationCode(f.tab, f.request, f.options);
    assert.equal(result.state, 'unavailable');
    assert.equal(result.code, 'deadline_exceeded');
    assert.equal(f.writes.length, 0);
});

test('a hung code read times out and a late code result cannot be entered', async () => {
    const f = authentication(), pending = deferred();
    f.options.receiveCode = () => pending.promise;
    const result = await executeVerificationCode(f.tab, f.request, { ...f.options, readTimeoutMs: 5 });
    assert.equal(result.state, 'unavailable');
    assert.equal(result.code, 'read_timeout');
    pending.resolve(f.message());
    await delay(5);
    assert.equal(f.writes.length, 0);
    assert(!JSON.stringify(result).includes('SYNTH123'));
    assert(!JSON.stringify(result).includes(f.request.account));
});

test('a hung initial authentication status read is also bounded', async () => {
    const f = authentication();
    f.options.readStatus = () => new Promise(() => {});
    const result = await executeVerificationCode(f.tab, f.request, { ...f.options, readTimeoutMs: 5 });
    assert.equal(result.code, 'read_timeout');
    assert.equal(f.writes.length, 0);
});

test('an OTP write is awaited once even if its host exceeds the budget', async () => {
    const f = authentication(), pending = deferred(), entered = deferred();
    let attempts = 0, settled = false;
    f.tab.playwright.getByLabel = () => ({ count: async () => 1, fill: async () => { attempts++; entered.resolve(); await pending.promise; } });
    const execution = executeVerificationCode(f.tab, f.request, f.options).then(result => { settled = true; return result; });
    await entered.promise;
    f.advance(5000);
    await delay(5);
    assert.equal(settled, false);
    pending.resolve();
    const result = await execution;
    assert.equal(result.state, 'unknown');
    assert.equal(result.code, 'deadline_exceeded');
    assert.equal(result.next, 'readonly_auth_status');
    assert.equal(attempts, 1);
});
