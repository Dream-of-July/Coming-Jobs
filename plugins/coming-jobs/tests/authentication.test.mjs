import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, seedProfile } from './helpers.mjs';
import { profileDigest } from '../src/profile.mjs';
import { call } from '../src/service.mjs';

function grant(e, channel, value, extra = {}) {
    return e.run('remember', { mode: 'user_statement', confirmed: true, user_ref: 'Synthetic explicit recruitment login permission',
        facts: [{ key: `workflow.login.${channel}_read`, value, purposes: ['form', 'tracking'], evidence_level: 'self_statement', ...extra }] });
}
function login(e, kind = 'login') {
    e.store.put('application', 'synthetic-app', { company: 'Synthetic Employer', title: 'Synthetic Product Role', stage: 'preparing',
        handoff: { state: 'open', kind, prompt: 'Complete the observed login step' } });
    return call(e.store, 'jobos1_context', { application_id: 'synthetic-app', scope: 'current' });
}

test('initialization exposes a one-time channel permission request without granting access', t => {
    const e = environment(t);
    const a = e.run('context').authentication;
    assert.equal(a.email_read, 'not_requested'); assert.equal(a.sms_read, 'not_requested');
    assert.deepEqual(a.request_channels, ['email', 'sms']);
    assert(a.permission_prompt); assert.equal(a.host_access, 'not_verified');
});

test('followup mail and SMS settings do not imply authentication permission', t => {
    const e = environment(t);
    e.store.put('settings', 'schedule', { include_email: true, include_sms: true });
    const a = e.run('context').authentication;
    assert.equal(a.email_read, 'not_requested'); assert.equal(a.sms_read, 'not_requested');
});

test('explicit channel grants are reusable and prefer email without claiming connector access', t => {
    const e = environment(t); seedProfile(e); const before = profileDigest(e.store);
    grant(e, 'email', true); grant(e, 'sms', true);
    const a = e.run('context').authentication;
    assert.deepEqual(a.preferred_channels, ['email', 'sms']);
    assert.equal(a.email_read, 'granted'); assert.equal(a.sms_read, 'granted');
    assert.equal(a.permission_prompt, null); assert.deepEqual(a.request_channels, []);
    assert.equal(a.host_access, 'not_verified'); assert.equal(profileDigest(e.store), before);
});

test('explicit denials are remembered without repeatedly asking', t => {
    const e = environment(t); grant(e, 'email', false); grant(e, 'sms', false);
    const a = e.run('context').authentication;
    assert.equal(a.email_read, 'denied'); assert.equal(a.sms_read, 'denied');
    assert.equal(a.permission_prompt, null); assert.deepEqual(a.preferred_channels, []);
    assert.equal(login(e).flow.next.owner, 'user');
});

test('SMS can be authorized independently while email remains denied', t => {
    const e = environment(t); grant(e, 'email', false); grant(e, 'sms', true);
    assert.deepEqual(e.run('context').authentication.preferred_channels, ['sms']);
    const out = login(e);
    assert.equal(out.flow.next.owner, 'agent'); assert.equal(out.flow.next.action, 'authenticate');
});

test('AI summaries and nonboolean facts cannot grant mailbox access', t => {
    const e = environment(t);
    grant(e, 'email', true, { evidence_level: 'ai_summary' });
    grant(e, 'sms', 'probably allowed');
    const a = e.run('context').authentication;
    assert.equal(a.email_read, 'not_requested'); assert.equal(a.sms_read, 'not_requested');
    assert.equal(login(e).flow.next.owner, 'user');
});

test('expired or revoked permission is no longer reusable', t => {
    const e = environment(t);
    grant(e, 'email', true, { expires_at: '2000-01-01T00:00:00Z' });
    grant(e, 'sms', true);
    const f = e.store.all('fact').find(f => f.key === 'workflow.login.sms_read');
    e.run('profile', { operation: 'revoke', fact_id: f.id, confirmed: true, user_ref: 'Synthetic permission revocation' });
    const a = e.run('context').authentication;
    assert.deepEqual(a.preferred_channels, []); assert.equal(login(e).flow.next.owner, 'user');
    assert.equal(a.sms_read, 'denied'); assert.deepEqual(a.request_channels, ['email']);
});

test('legacy ungraded consent and malformed provenance remain undecided without crashing context', t => {
    const e = environment(t); grant(e, 'email', true); grant(e, 'sms', true);
    for (const f of e.store.all('fact')) e.store.put('fact', f.id, { ...f,
        ...(f.key === 'workflow.login.email_read' ? { evidence_level: undefined } : { source_ref: { untrusted: true } }) });
    const a = e.run('context').authentication;
    assert.equal(a.email_read, 'not_requested'); assert.equal(a.sms_read, 'not_requested');
});

test('authorized login handoff continues with the agent but does not claim login succeeded', t => {
    const e = environment(t); grant(e, 'email', true);
    const out = login(e);
    assert.equal(out.flow.can_auto_continue, true); assert.equal(out.flow.next.owner, 'agent');
    assert.equal(out.flow.next.action, 'authenticate');
    assert.equal(e.store.get('application', 'synthetic-app').handoff.state, 'open');
    assert.equal(e.run('context', { scope: 'application', application_id: 'synthetic-app' }).authentication.email_read, 'granted');
});

test('authentication grants do not automate CAPTCHA or legal and sensitive handoffs', t => {
    const e = environment(t); grant(e, 'email', true); grant(e, 'sms', true);
    for (const kind of ['captcha', 'sensitive', 'conflict', 'unknown', 'host_permission']) {
        const out = login(e, kind);
        assert.equal(out.flow.next.owner, 'user'); assert.equal(out.flow.can_auto_continue, false);
    }
});

test('background followup and daily context cannot initiate authentication', t => {
    const e = environment(t); grant(e, 'email', true); login(e);
    e.store.put('settings', 'active', { application_id: 'synthetic-app' });
    const followup = call(e.store, 'jobos1_followup', { operation: 'queue', background: true });
    const daily = call(e.store, 'jobos1_context', { scope: 'daily' });
    for (const out of [followup, daily]) {
        assert.notEqual(out.flow.next.action, 'authenticate'); assert.equal(out.flow.can_auto_continue, false);
    }
});

test('login permissions do not allow storing verification secrets', t => {
    const e = environment(t); grant(e, 'email', true);
    const result = call(e.store, 'jobos1_remember', { mode: 'user_statement', confirmed: true, user_ref: 'Synthetic rejected secret',
        facts: [{ key: 'verification_code', value: 'synthetic-code-value', purposes: ['form'] }] });
    assert.equal(result.error?.code, 'secret_not_supported');
});
