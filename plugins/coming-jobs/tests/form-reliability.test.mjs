import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { executeOrdinaryBatch } from '../src/host-batch.mjs';
import { fillGroup } from '../src/browser.mjs';
import { Fault } from '../src/core.mjs';

const origin = 'https://jobs.example.com';
const lease = () => ({ origin, expires_at: new Date(Date.now() + 60000).toISOString() });

// The fixture executes the production DOM reader against controls, including
// ARIA-only names. Only the remote host transport and actual input events are faked.
function portal(fields, onWrite = () => {}, nativeRead = false) {
    const writes = [], controls = fields.map(field => ({
        id: field.key, tagName: 'INPUT', type: field.type === 'checkbox' ? 'checkbox' : 'text',
        value: '', checked: false, maxLength: 100, disabled: false, readOnly: false,
        labels: field.aria ? [] : [{ textContent: field.label }], attrs: field.aria ? { 'aria-label': field.label } : {},
        getAttribute(name) { return this.attrs[name] ?? null; }
    }));
    let reads = 0, url = origin + '/form';
    const byName = name => controls.filter(el => el.attrs['aria-label'] === name || el.labels.some(label => label.textContent === name));
    const locator = name => ({
        count: async () => byName(name).length,
        ...(nativeRead ? { evaluate: async fn => { const found = byName(name); assert.equal(found.length, 1); return fn(found[0]); } } : {}),
        fill: async value => { const el = byName(name)[0]; el.value = value; writes.push(el.id); await onWrite(el, controls); },
        setChecked: async value => { const el = byName(name)[0]; el.checked = value; writes.push(el.id); await onWrite(el, controls); }
    });
    const document = { querySelectorAll: () => controls, getElementById: id => controls.find(el => el.id === id) };
    const tab = { url: async () => url, playwright: {
        getByLabel: locator, getByPlaceholder: locator, getByTestId: locator,
        getByRole: (_, options) => locator(options.name), locator,
        evaluate: async (fn, argument) => { reads++; return vm.runInNewContext(`(${fn.toString()})(argument)`, { document, argument }); }
    } };
    const batch = { id: 'batch', state: 'pending', scope: { origin }, grant: lease(),
        before: fields.map(field => ({ key: field.key, value: field.type === 'checkbox' ? false : '' })),
        targets: fields.map(field => ({ key: field.key, label: field.label, type: field.type ?? 'free_text', value: field.value ?? field.key,
            locator: field.locator ?? { kind: 'label', value: field.label } })) };
    return { tab, batch, controls, writes, reads: () => reads, setUrl: value => { url = value; } };
}

test('ordinary batch reads an ARIA-only labelled control using the same semantic identity', async () => {
    const p = portal([{ key: 'name', label: 'Full name', aria: true }]);
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.state, 'complete');
    assert.equal(p.controls[0].value, 'name');
    assert.equal(result.observations[0].value, 'name');
});

test('ordinary batch supports observed host locators beyond native label elements', async () => {
    for (const kind of ['role', 'placeholder', 'testid', 'css']) {
        const p = portal([{ key: 'name', label: 'Full name', locator: { kind, value: kind === 'role' ? 'textbox' : 'Full name', name: 'Full name' } }], undefined, true);
        const result = await executeOrdinaryBatch(p.tab, p.batch);
        assert.equal(result.state, 'complete', kind);
        assert.equal(p.controls[0].value, 'name', kind);
    }
});

test('final bulk read falls back to the observed locator when a control is outside the main document', async () => {
    const p = portal([{ key: 'name', label: 'Full name' }], undefined, true);
    // A native host locator can reach a shadow tree that document.querySelectorAll cannot.
    p.tab.playwright.evaluate = async (fn, argument) => vm.runInNewContext(`(${fn.toString()})(argument)`, {
        document: { querySelectorAll: () => [], getElementById: () => null }, argument
    });
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.state, 'complete');
    assert.deepEqual(p.writes, ['name']);
});

test('batch completion detects a later field clearing an earlier value', async () => {
    const p = portal([{ key: 'first', label: 'First' }, { key: 'second', label: 'Second' }], (el, controls) => {
        if (el.id === 'second') controls[0].value = '';
    });
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.state, 'unknown');
    assert.equal(result.observations.find(field => field.key === 'first').value, '');
    assert.deepEqual(p.writes, ['first', 'second']);
});

test('eight ordinary fields share one final DOM read instead of a read after every write', async () => {
    const p = portal(Array.from({ length: 8 }, (_, n) => ({ key: String(n), label: 'Field ' + n })));
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.state, 'complete');
    assert.equal(result.observations.length, 8);
    assert.equal(p.writes.length, 8);
    assert(p.reads() <= 9, `expected at most nine DOM reads, received ${p.reads()}`);
});

test('a navigation caused by the last write is never reported as completed', async () => {
    let p;
    p = portal([{ key: 'name', label: 'Name' }], () => p.setUrl('https://elsewhere.example/form'));
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.state, 'unknown');
    assert.deepEqual(p.writes, ['name']);
});

test('an unparsable execution expiry cannot authorize a write', async () => {
    const p = portal([{ key: 'name', label: 'Name' }]);
    p.batch.grant.expires_at = 'not a date';
    const result = await executeOrdinaryBatch(p.tab, p.batch);
    assert.equal(result.state, 'unknown');
    assert.equal(p.writes.length, 0);
});

function groupFixture() {
    const values = { first: '', second: '' }, writes = [], saves = [], refreshes = [];
    const group = { key: 'identity', fields: ['first', 'second'].map(key => ({ key, type: 'free_text', value: key, locator: { kind: 'label', value: 'old-' + key } })) };
    const tab = { url: async () => origin + '/form', markHandoff: async () => {} };
    const options = { origin, authorization: lease(),
        saveBefore: async value => saves.push(structuredClone(value)), saveAfter: async value => saves.push(structuredClone(value)),
        readField: async field => ({ key: field.key, value: values[field.key], read_state: 'known' }),
        writeField: async field => { values[field.key] = field.value; writes.push(field.key); },
        refreshField: async field => { refreshes.push(field.key); return { locator: { kind: 'label', value: 'new-' + field.key } }; } };
    return { group, tab, options, values, writes, saves, refreshes };
}

test('each stale field gets one targeted locator recovery within the group', async () => {
    const f = groupFixture();
    f.options.readField = async field => {
        if (field.locator.value.startsWith('old-')) throw new Fault('ambiguous_locator', 'stale');
        return { key: field.key, value: f.values[field.key], read_state: 'known' };
    };
    const result = await fillGroup(f.tab, f.group, f.options);
    assert.deepEqual(f.refreshes, ['first', 'second']);
    assert.deepEqual(f.writes, ['first', 'second']);
    assert.equal(result.fields.length, 2);
});

test('a locator refresh callback cannot mutate approved content', async () => {
    const f = groupFixture();
    f.group.fields = f.group.fields.slice(0, 1);
    f.options.readField = async field => {
        if (field.locator.value.startsWith('old-')) throw new Fault('ambiguous_locator', 'stale');
        return { key: field.key, value: f.values[field.key], read_state: 'known' };
    };
    f.options.refreshField = async field => { field.value = 'unapproved'; return { ...field, locator: { kind: 'label', value: 'new-' + field.key } }; };
    await fillGroup(f.tab, f.group, f.options);
    assert.equal(f.values.first, 'first');
    assert.equal(f.group.fields[0].value, 'first');
});

test('a locator replaced by a write is reread without repeating the write', async () => {
    const f = groupFixture();
    f.options.readField = async field => {
        if (f.values[field.key] && field.locator.value.startsWith('old-')) throw new Fault('ambiguous_locator', 'replaced');
        return { key: field.key, value: f.values[field.key], read_state: 'known' };
    };
    await fillGroup(f.tab, f.group, f.options);
    assert.deepEqual(f.writes, ['first', 'second']);
    assert.deepEqual(f.refreshes, ['first', 'second']);
});

test('a user edit after the initial snapshot is protected before the next write', async () => {
    const f = groupFixture();
    f.options.writeField = async field => { f.values[field.key] = field.value; f.writes.push(field.key); if (field.key === 'first') f.values.second = 'user edit'; };
    await assert.rejects(fillGroup(f.tab, f.group, f.options), { code: 'user_edit_conflict' });
    assert.deepEqual(f.writes, ['first']);
    assert.equal(f.values.second, 'user edit');
});

test('compatibility group completion rereads earlier values after dependent writes', async () => {
    const f = groupFixture();
    f.options.writeField = async field => { f.values[field.key] = field.value; f.writes.push(field.key); if (field.key === 'second') f.values.first = ''; };
    await assert.rejects(fillGroup(f.tab, f.group, f.options), { code: 'value_not_retained' });
    assert.equal(f.saves.at(-1).fields.find(field => field.key === 'first').value, '');
    assert.deepEqual(f.writes, ['first', 'second']);
});
