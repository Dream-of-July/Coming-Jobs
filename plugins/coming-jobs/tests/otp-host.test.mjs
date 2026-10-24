import test from 'node:test';
import assert from 'node:assert/strict';
import * as host from '../src/host-batch.mjs';

function fixture(overrides = {}) {
    let time = Date.parse('2026-10-22T12:00:00Z'), currentOrigin = 'https://jobs.example.com';
    const events = [], writes = [], privateCode = '731946';
    const request = { kind: 'one_time_code', purpose: 'login', request_id: 'request-1', origin: currentOrigin,
        account: 'candidate@example.com', channel: 'email', requested_at: new Date(time - 1000).toISOString(),
        expires_at: new Date(time + 15000).toISOString(), locator: { kind: 'label', value: 'Email code' }, ...overrides };
    const authorization = { purpose: 'login', origin: request.origin, account: request.account, channel: request.channel,
        user_ref: 'User authorized this sign-in and email code in the current task', expires_at: new Date(time + 60000).toISOString() };
    const message = () => ({ code: privateCode, request_id: request.request_id, origin: request.origin, account: request.account,
        channel: request.channel, received_at: new Date(time).toISOString() });
    const tab = { url: async () => currentOrigin + '/login', playwright: { getByLabel: () => ({
        count: async () => 1,
        fill: async value => { events.push('fill'); writes.push(value); }
    }) } };
    const options = { authorization, now: () => time, pollIntervalMs: 100, maxWaitMs: 1000,
        wait: async ms => { events.push('wait'); time += ms; },
        receiveCode: async () => { events.push('receive'); return message(); },
        readStatus: async () => { events.push('status'); return writes.length ? 'accepted' : 'pending'; } };
    return { tab, request, authorization, options, events, writes, privateCode, message,
        time: () => time, advance: ms => { time += ms; }, changeOrigin: origin => { currentOrigin = origin; } };
}
async function execute(f) {
    assert.equal(typeof host.executeVerificationCode, 'function', 'ephemeral verification-code helper is available');
    return host.executeVerificationCode(f.tab, f.request, f.options);
}

test('an already available authorized code is filled immediately with no polling delay or code in the result', async () => {
    const f = fixture();
    const result = await execute(f);
    assert.equal(result.state, 'verified');
    assert.deepEqual(f.writes, [f.privateCode]);
    assert.equal(f.events.includes('wait'), false);
    assert(!JSON.stringify(result).includes(f.privateCode));
    assert(!JSON.stringify(result).includes(f.request.account));
});

test('only read polling occurs while waiting and the first live matching code is written once', async () => {
    const f = fixture(); let reads = 0;
    f.options.receiveCode = async () => { f.events.push('receive'); return ++reads === 3 ? f.message() : null; };
    const result = await execute(f);
    assert.equal(result.state, 'verified');
    assert.deepEqual(f.events.filter(event => ['receive', 'wait', 'fill'].includes(event)), ['receive', 'wait', 'receive', 'wait', 'receive', 'fill']);
    assert.deepEqual(f.writes, [f.privateCode]);
});

test('stale or mismatched messages are ignored within the same bounded read window', async () => {
    for (const mismatch of ['request_id', 'origin', 'account', 'channel', 'received_at']) {
        const f = fixture(); let reads = 0;
        f.options.receiveCode = async () => ++reads === 1 ? { ...f.message(), [mismatch]: mismatch === 'received_at' ? new Date(f.time() - 60000).toISOString() : 'wrong', code: '000000' } : f.message();
        const result = await execute(f);
        assert.equal(result.state, 'verified', mismatch);
        assert.deepEqual(f.writes, [f.privateCode], mismatch);
    }
});

test('no code is written after expiry during retrieval and no resend is attempted', async () => {
    const f = fixture();
    f.options.receiveCode = async () => { const message = f.message(); f.advance(16000); return message; };
    const result = await execute(f);
    assert.equal(result.state, 'expired');
    assert.equal(f.writes.length, 0);
});

test('OTP polling stops at its bounded wait without requiring a new permission question', async () => {
    const f = fixture(); let reads = 0;
    f.options.receiveCode = async () => { reads++; return null; };
    const result = await execute(f);
    assert.equal(result.state, 'unavailable');
    assert(reads <= 11);
    assert.equal(f.writes.length, 0);
    assert.equal(result.next, 'await_current_code');
});

test('a security challenge remains manual and is never consumed as a login code', async () => {
    const f = fixture();
    f.options.readStatus = async () => 'captcha';
    const result = await execute(f);
    assert.equal(result.state, 'challenge');
    assert.equal(f.events.includes('receive'), false);
    assert.equal(f.writes.length, 0);
});

test('missing or mismatched authorization cannot fetch or write a code', async () => {
    for (const field of ['origin', 'account', 'channel', 'purpose', 'user_ref', 'expires_at']) {
        const f = fixture();
        f.authorization[field] = field === 'user_ref' ? '' : field === 'expires_at' ? 'invalid' : 'wrong';
        const result = await execute(f);
        assert.equal(result.state, 'blocked', field);
        assert.equal(f.events.includes('receive'), false, field);
        assert.equal(f.writes.length, 0, field);
    }
});

test('the code channel is not consumed when the host lacks the required write capability', async () => {
    const f = fixture();
    f.tab.playwright.getByLabel = () => ({ count: async () => 1 });
    const result = await execute(f);
    assert.equal(result.state, 'blocked');
    assert.equal(f.events.includes('receive'), false);
});

test('an origin change while retrieving a code prevents code entry', async () => {
    const f = fixture();
    f.options.receiveCode = async () => { f.changeOrigin('https://other.example.com'); return f.message(); };
    const result = await execute(f);
    assert.equal(result.state, 'blocked');
    assert.equal(f.writes.length, 0);
});

test('a thrown code write is never repeated and error text cannot leak the code', async () => {
    const f = fixture(); let attempts = 0;
    f.tab.playwright.getByLabel = () => ({ count: async () => 1, fill: async () => { attempts++; throw new Error('sensitive value: ' + f.privateCode); } });
    const result = await execute(f);
    assert.equal(result.state, 'unknown');
    assert.equal(attempts, 1);
    assert(!JSON.stringify(result).includes(f.privateCode));
    assert.equal(result.next, 'readonly_auth_status');
});

test('pending code entry reports entered instead of claiming authentication succeeded', async () => {
    const f = fixture();
    f.options.readStatus = async () => 'pending';
    const result = await execute(f);
    assert.equal(result.state, 'entered');
    assert.equal(f.writes.length, 1);
});

test('the OTP helper rejects application submission and non-code challenges before host actions', async () => {
    for (const overrides of [{ purpose: 'application_submit' }, { kind: 'captcha' }]) {
        const f = fixture(overrides);
        f.authorization.purpose = f.request.purpose;
        const result = await execute(f);
        assert.equal(result.state, 'blocked');
        assert.equal(f.events.includes('receive'), false);
        assert.equal(f.writes.length, 0);
    }
});
