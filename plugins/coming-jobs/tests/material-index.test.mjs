import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { environment, simplePDF } from './helpers.mjs';
import { call } from '../src/service.mjs';
import { materialIndex, MATERIAL_INDEX_PARSER_VERSION } from '../src/material-index.mjs';
import { hash } from '../src/core.mjs';

function source(env, file, label = path.basename(file), extra = {}) {
    return env.run('workspace', { operation: 'source', label, kind: 'resume', purposes: ['resume', 'matching'], file, allowed_root: env.dir, authorized: true, user_ref: 'synthetic material index', ...extra });
}

test('indexes registered text, deduplicates identical bytes, and caches by content hash', t => {
    const env = environment(t);
    const first = path.join(env.dir, 'resume-a.md');
    const second = path.join(env.dir, 'resume-renamed.md');
    writeFileSync(first, '# Education\nSynthetic University\n# Awards\nDesign Award');
    writeFileSync(second, '# Education\nSynthetic University\n# Awards\nDesign Award');
    source(env, first, 'old-name.md');
    source(env, second, 'new-name.md', { purposes: ['matching'] });
    const result = materialIndex(env.store, { operation: 'index' });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].duplicate_count, 2);
    assert.equal(result.entries[0].extraction.state, 'ready');
    assert.equal(env.store.all('material_index_cache').length, 1);
    assert.equal(materialIndex(env.store, { operation: 'lookup' }).entries[0].extraction.cache_hit, true);
});

test('does not choose an old baseline by filename or modification order', t => {
    const env = environment(t);
    const oldFile = path.join(env.dir, 'resume-old.md');
    const newFile = path.join(env.dir, 'resume-new.md');
    writeFileSync(oldFile, 'Old resume only');
    writeFileSync(newFile, 'Confirmed resume Education Award Portfolio');
    const old = source(env, oldFile);
    const current = source(env, newFile);
    const material = { id: 'confirmed-material', kind: 'resume', asset: current.asset, approved: true };
    env.store.put('material', material.id, material);
    env.store.put('settings', 'resume_baseline', { material_id: material.id, sha256: current.asset.sha256, items: [{ key: 'award', text: 'Award' }, { key: 'portfolio', text: 'Portfolio' }] });
    const result = materialIndex(env.store, { operation: 'index' });
    assert.equal(result.baseline.state, 'verified');
    assert.equal(result.baseline.sha256, current.asset.sha256);
    assert.notEqual(result.baseline.sha256, old.asset.sha256);
});

test('requires host extraction for PDFs and accepts only registered hash-bound text', t => {
    const env = environment(t);
    const pdf = path.join(env.dir, 'resume.pdf');
    writeFileSync(pdf, Buffer.from('%PDF-1.4\nsynthetic'));
    const registered = source(env, pdf);
    const before = materialIndex(env.store, { operation: 'index' });
    assert.equal(before.entries[0].extraction.state, 'needs_host_extraction');
    const cached = materialIndex(env.store, { operation: 'cache_host_text', sha256: registered.asset.sha256, text: 'Education Award Portfolio', extraction_ref: 'host fixture' });
    assert.equal(cached.state, 'ready');
    assert.equal(materialIndex(env.store, { operation: 'index' }).entries[0].extraction.state, 'ready');
    assert.throws(() => materialIndex(env.store, { operation: 'cache_host_text', sha256: hash('unregistered'), text: 'unknown', extraction_ref: 'host fixture' }), error => error.code === 'unregistered_material');
});

test('reports missing baseline content for review instead of approving it', t => {
    const env = environment(t);
    const file = path.join(env.dir, 'resume.md');
    writeFileSync(file, 'Education only');
    const registered = source(env, file);
    const material = { id: 'material-1', kind: 'resume', asset: registered.asset, approved: true };
    env.store.put('material', material.id, material);
    env.store.put('settings', 'resume_baseline', { material_id: material.id, sha256: registered.asset.sha256, items: [{ key: 'education', text: 'Education' }, { key: 'award', text: 'Award' }] });
    const result = materialIndex(env.store, { operation: 'index' });
    assert.equal(result.baseline.state, 'review_required');
    assert.deepEqual(result.baseline.missing_items, ['award']);
});

test('real source registration rejects unconfined symlinks and inventory skips them', t => {
    const env = environment(t);
    const outside = path.join(path.dirname(env.dir), 'outside-material.txt');
    writeFileSync(outside, 'private outside fixture');
    const link = path.join(env.dir, 'linked.txt');
    symlinkSync(outside, link);
    const registration = call(env.store, 'jobos1_workspace', { operation: 'source', label: 'linked.txt', kind: 'resume', purposes: ['resume'], file: link, allowed_root: env.dir, authorized: true, user_ref: 'symlink fixture' });
    assert.equal(registration.error.code, 'scope_violation');
    const result = materialIndex(env.store, { operation: 'inventory', root: env.dir, authorized: true, user_ref: 'symlink fixture' });
    assert.equal(result.files.length, 0);
    assert.equal(result.errors.length, 0);
});

test('limits inventory to explicitly registered source ids', t => {
    const env = environment(t);
    const file = path.join(env.dir, 'resume.md');
    writeFileSync(file, 'Registered');
    source(env, file);
    writeFileSync(path.join(env.dir, 'unregistered.md'), 'Should never be read');
    const result = materialIndex(env.store, { operation: 'index', source_ids: [] });
    assert.equal(result.entries.length, 0);
    assert.equal(result.rejected.length, 0);
});

test('uses the stable parser version in cache records', t => {
    const env = environment(t);
    const file = path.join(env.dir, 'resume.md');
    writeFileSync(file, 'Stable parser');
    source(env, file);
    materialIndex(env.store, { operation: 'index' });
    assert.equal(env.store.all('material_index_cache')[0].parser_version, MATERIAL_INDEX_PARSER_VERSION);
});

test('inventory requires one explicit authorized root and returns candidates without registering them', t => {
    const env = environment(t);
    writeFileSync(path.join(env.dir, 'candidate.pdf'), Buffer.from('%PDF-1.4\nfixture'));
    writeFileSync(path.join(env.dir, 'notes.md'), 'candidate notes');
    const result = materialIndex(env.store, { operation: 'inventory', root: env.dir, authorized: true, user_ref: 'synthetic explicit root' });
    assert.deepEqual(result.files.map(file => file.name), ['candidate.pdf', 'notes.md']);
    assert.equal(env.store.all('source').length, 0);
    assert.throws(() => materialIndex(env.store, { operation: 'inventory', root: env.dir, authorized: false, user_ref: 'no' }), error => error.code === 'approval_required');
});

test('inventory reports byte truncation without reading beyond the bound', t => {
    const env = environment(t);
    writeFileSync(path.join(env.dir, 'large.txt'), '1234567890');
    const result = materialIndex(env.store, { operation: 'inventory', root: env.dir, max_bytes: 5, authorized: true, user_ref: 'byte bound fixture' });
    assert.equal(result.files.length, 0);
    assert.equal(result.bytes_read, 0);
    assert.equal(result.truncated.bytes, true);
});

test('text supplied without a registered file remains unverified for baseline use', t => {
    const env = environment(t);
    env.store.put('source', 'text-only', { label: 'text-only', kind: 'resume', purposes: ['resume'], text: 'Education Award' });
    const result = materialIndex(env.store, { operation: 'index' });
    assert.equal(result.entries[0].extraction.state, 'ready');
    assert.equal(result.entries[0].extraction.verified, false);
});

test('indexes registered material assets directly and omits text unless explicitly selected', t => {
    const env = environment(t);
    const file = path.join(env.dir, 'resume.pdf');
    writeFileSync(file, simplePDF());
    const material = env.run('material', { operation: 'register', file, kind: 'resume', authorized: true, user_ref: 'register fixture' });
    const compact = materialIndex(env.store, { operation: 'index' });
    assert.equal(compact.entries[0].material_ids[0], material.id);
    assert.equal(Object.hasOwn(compact.entries[0].extraction, 'text'), false);
    materialIndex(env.store, { operation: 'cache_host_text', sha256: material.asset.sha256, text: 'Education Award Portfolio', extraction_ref: 'host fixture' });
    const detailed = materialIndex(env.store, { operation: 'index', material_ids: [material.id], include_text: true });
    assert.equal(detailed.entries[0].extraction.text, 'Education Award Portfolio');
});


test('confirmed material baseline reuses evidence but changed bytes fail closed', t => {
    const env = environment(t); const file = path.join(env.dir, 'baseline.pdf'); writeFileSync(file, simplePDF());
    const m = env.run('material', { operation:'register', file, kind:'resume', authorized:true, user_ref:'Synthetic register' });
    env.run('material', { operation:'approve', material_id:m.id, sha256:m.asset.sha256, visual_ok:true, content_ok:true, text_quality:'pass', confirmed:true, user_ref:'Synthetic approval' });
    env.run('material', { operation:'baseline', material_id:m.id, sha256:m.asset.sha256, extracted_text:'SYNTHETIC TEST RESUME', extraction_ref:'Synthetic actual PDF text', items:[{key:'work',category:'work',text:'SYNTHETIC TEST RESUME'}], confirmed:true,user_ref:'Synthetic baseline' });
    const indexed = env.run('material_index', { operation:'lookup', material_ids:[m.id], include_text:true });
    assert.equal(indexed.baseline.state,'verified'); assert.equal(indexed.entries[0].extraction.text,'SYNTHETIC TEST RESUME');
    writeFileSync(env.store.assetPath(m.asset),'changed bytes');
    assert.equal(env.run('material_index',{operation:'lookup'}).baseline.state,'review_required');
});
