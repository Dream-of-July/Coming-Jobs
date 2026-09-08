import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { install, verify, disableLegacy } from '../../../scripts/install.mjs';
import { ROOT } from '../src/core.mjs';
function fakeHome(t) { const home = mkdtempSync(path.join(os.tmpdir(), 'jobos-install-')); t.after(() => rmSync(home, { recursive: true, force: true })); return home; }
test('release manifest covers runtime, schema, hooks script and main Skill', () => {
    const r = verify();
    assert.equal(r.contract, 'jobos/1');
    assert.match(r.build, /^[a-f0-9]{64}$/);
    for (const name of ['src/service.mjs', 'src/catalog.mjs', 'hooks/lifecycle.mjs', 'skills/jobos/SKILL.md'])
        assert(r.files[name]);
});
test('fresh install fixes Node, server path and data directory without granting hook trust', t => {
    const home = fakeHome(t), r = install({ home, skipCli: true });
    const p = r.installed_path;
    assert.equal(r.state, 'personal_marketplace_ready');
    const m = JSON.parse(readFileSync(path.join(p, '.mcp.json'), 'utf8')).jobos_next;
    assert.equal(m.command, process.execPath);
    assert.equal(m.cwd, p);
    assert.equal(m.env.JOBOS_NEXT_HOME, r.data_home);
    assert(existsSync(m.args.at(-1)));
    assert.equal(r.old_data_deleted, false);
    const h = JSON.parse(readFileSync(path.join(p, 'hooks/hooks.json'), 'utf8'));
    assert(h.hooks.Stop[0].hooks[0].command.includes(r.data_home));
    assert(!existsSync(path.join(home, '.codex/config.toml')));
});
test('install backs up and disables only recognized old configuration', t => {
    const home = fakeHome(t);
    mkdirSync(path.join(home, '.codex'));
    const file = path.join(home, '.codex/config.toml');
    const text = 'model = "existing-model"\n[plugins."jobos-recruiting@personal"]\nenabled = true\n[plugins."music@personal"]\nenabled = true\n[mcp_servers.jobos]\ncommand = "node"\n[mcp_servers.other]\ncommand = "keep"\n';
    writeFileSync(file, text);
    const r = install({ home, skipCli: true }), after = readFileSync(file, 'utf8');
    assert.equal(r.disabled_legacy_sections, 2);
    assert.match(after, /\[plugins\."music@personal"\]\nenabled = true/);
    assert.match(after, /\[mcp_servers.other\]\ncommand = "keep"/);
    assert.equal(readFileSync(path.join(r.backup_directory, 'config.toml'), 'utf8'), text);
});
test('existing personal marketplace entries and name survive installation', t => {
    const home = fakeHome(t), dir = path.join(home, '.agents/plugins');
    mkdirSync(dir, { recursive: true });
    const keep = { name: 'existing-plugin', source: { source: 'local', path: './keep' } };
    writeFileSync(path.join(dir, 'marketplace.json'), JSON.stringify({ name: 'my-plugins', plugins: [keep] }));
    install({ home, skipCli: true });
    const market = JSON.parse(readFileSync(path.join(dir, 'marketplace.json'), 'utf8'));
    assert.equal(market.name, 'my-plugins');
    assert.deepEqual(market.plugins[0], keep);
    assert.equal(market.plugins.filter(p => p.name === 'coming-jobs').length, 1);
});
test('reinstall is idempotent and keeps existing private files', t => {
    const home = fakeHome(t);
    const first = install({ home, skipCli: true });
    mkdirSync(first.data_home, { recursive: true });
    writeFileSync(path.join(first.data_home, 'private.txt'), 'KEEP');
    const second = install({ home, skipCli: true });
    assert.equal(second.build, first.build);
    assert.equal(readFileSync(path.join(first.data_home, 'private.txt'), 'utf8'), 'KEEP');
    const market = JSON.parse(readFileSync(path.join(home, '.agents/plugins/marketplace.json'), 'utf8'));
    assert.equal(market.plugins.filter(p => p.name === 'coming-jobs').length, 1);
    verify(first.installed_path);
});
test('tampering with an installed core module is detected before reinstall', t => {
    const home = fakeHome(t), r = install({ home, skipCli: true });
    writeFileSync(path.join(r.installed_path, 'src/service.mjs'), '// altered');
    assert.throws(() => verify(r.installed_path), /校验失败/);
    assert.throws(() => install({ home, skipCli: true }), /校验失败/);
});
test('fresh process runs actual installed paths and reports the correct build', t => {
    const home = fakeHome(t), r = install({ home, skipCli: true });
    const m = JSON.parse(readFileSync(path.join(r.installed_path, '.mcp.json'), 'utf8')).jobos_next;
    const messages = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'jobos1_context', arguments: {} } }];
    const child = spawnSync(m.command, m.args, { cwd: m.cwd, env: { ...process.env, ...m.env }, input: messages.map(x => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 0, child.stderr);
    const lines = child.stdout.trim().split('\n').map(x => JSON.parse(x));
    const data = lines.find(x => x.id === 2).result.structuredContent;
    assert.equal(data.build, r.build);
    assert.equal(data.contract, 'jobos/1');
    assert.equal(data.data.coverage.ready, false);
});
test('an old section at EOF can be disabled without altering other settings', () => {
    const r = disableLegacy('model = "keep"\n[plugins."jobos-recruiting@jobos-local"]');
    assert.equal(r.changed, 1);
    assert.match(r.text, /enabled = false/);
    assert.match(r.text, /model = "keep"/);
});
test('already-disabled legacy sections do not accumulate changes', () => {
    const s = '[mcp_servers.jobos]\nenabled = false\ncommand = "node"\n';
    const r = disableLegacy(s);
    assert.equal(r.changed, 0);
    assert.equal(r.text, s);
});

test('installer entrypoint works through a directory symlink', t => {
    const home = fakeHome(t), link = path.join(home, 'package link');
    symlinkSync(path.resolve(ROOT, '../..'), link, 'dir');
    const r = spawnSync(process.execPath, [path.join(link, 'scripts/install.mjs'), '--verify-only'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).version, verify().version);
});
