import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, hash } from '../src/core.mjs';
import { TOOLS } from '../src/catalog.mjs';
import { Store } from '../src/store.mjs';
import { startDashboard } from '../src/web.mjs';
import { hook } from '../hooks/lifecycle.mjs';
import { preserveTab, fillGroup, readControl } from '../src/browser.mjs';
import { environment, seedProfile, seedApplication, seedPlan, correctObservations, checkpointArgs } from './helpers.mjs';
function event(name, extra = {}) { return { session_id: 'session', turn_id: 'turn', hook_event_name: name, ...extra }; }
test('prompt hook does not activate unrelated conversations', t => {
    const e = environment(t);
    assert.deepEqual(hook(event('UserPromptSubmit', { prompt: '帮我算1+1' }), e.dir), {});
    assert.deepEqual(hook(event('Stop', { last_assistant_message: '2' }), e.dir), {});
});
test('Coming Jobs hook injects concrete lifecycle instructions only into relevant turns', t => {
    const e = environment(t);
    const r = hook(event('UserPromptSubmit', { prompt: '使用Coming Jobs继续投递' }), e.dir);
    assert.match(r.hookSpecificOutput.additionalContext, /每一回合/);
});
test('bare completed response triggers exactly one end-of-turn repair', t => {
    const e = environment(t);
    hook(event('UserPromptSubmit', { prompt: '使用Coming Jobs' }), e.dir);
    e.store.put('apply_batch','synthetic',{state:'active'});
    const stop = event('Stop', { last_assistant_message: '已完成。' });
    assert.equal(hook(stop, e.dir).decision, 'block');
    assert.deepEqual(hook(stop, e.dir), {});
});
test('native stop_hook_active prevents self-continuation loops', t => {
    const e = environment(t);
    hook(event('UserPromptSubmit', { prompt: 'Coming Jobs' }), e.dir);
    assert.deepEqual(hook(event('Stop', { stop_hook_active: true, last_assistant_message: '完成' }), e.dir), {});
});
test('user pause does not trigger more application actions', t => {
    const e = environment(t);
    hook(event('UserPromptSubmit', { prompt: '使用Coming Jobs' }), e.dir);
    hook(event('UserPromptSubmit', { prompt: '暂停投递' }), e.dir);
    assert.deepEqual(hook(event('Stop', { last_assistant_message: '暂停' }), e.dir), {});
});
test('correct saved handoff and next-step text pass without another model roundtrip', t => {
    const e = environment(t);
    hook(event('UserPromptSubmit', { prompt: 'Coming Jobs' }), e.dir);
    e.run('finish', { session_id: 'session', turn_id: 'turn', reason: 'need_user', completed: '已创建资料空间。' });
    assert.deepEqual(hook(event('Stop', { last_assistant_message: '已创建资料空间。下一步：这次找校招还是实习？' }), e.dir), {});
});
test('short resume reply preserves relevance; unrelated long request leaves Coming Jobs mode', t => {
    const e = environment(t);
    hook(event('UserPromptSubmit', { prompt: 'Coming Jobs' }), e.dir);
    assert(hook(event('UserPromptSubmit', { prompt: '简历确认' }), e.dir).hookSpecificOutput);
    assert.deepEqual(hook(event('UserPromptSubmit', { prompt: '给我写一个关于海边落日的短篇故事，不涉及任何工作或履历' }), e.dir), {});
});
test('hook does not open transcript_path or copy prompt to disk', t => {
    const e = environment(t);
    const secret = 'PRIVATE_SHOULD_NOT_BE_RETAINED';
    hook(event('UserPromptSubmit', { prompt: 'Coming Jobs ' + secret, transcript_path: '/nonexistent/private' }), e.dir);
    const file = path.join(e.dir, 'hooks', hash('session').slice(0, 32) + '.json');
    assert(!readFileSync(file, 'utf8').includes(secret));
});
test('page preservation is renewed on each invocation', async () => {
    let count = 0;
    const tab = { markHandoff: async () => count++ };
    await preserveTab(tab);
    await preserveTab(tab);
    assert.equal(count, 2);
});
test('unsupported page retention is honestly reported', async () => { assert.equal((await preserveTab({})).preserved, false); });
test('group helper saves before writing, reads values and preserves tab', async () => {
    const order = [];
    let value = '旧值';
    const loc = { count: async () => 1, evaluate: async () => ({ value, selected: false, options: [] }), fill: async (v) => { order.push('write'); value = v; } };
    const tab = { url: async () => 'https://jobs.example.com/form', playwright: { getByLabel: () => loc }, markHandoff: async () => order.push('preserve') };
    const g = { key: 'identity', fields: [{ key: 'name', label: '姓名', type: 'free_text', value: '新值', locator: { kind: 'label', value: '姓名' } }] };
    const r = await fillGroup(tab, g, { origin: 'https://jobs.example.com', authorization: { origin: 'https://jobs.example.com', expires_at: new Date(Date.now() + 60000).toISOString() }, saveBefore: async () => order.push('save_before'), saveAfter: async () => order.push('save_after') });
    assert.deepEqual(order, ['save_before', 'write', 'save_after', 'preserve']);
    assert.equal(r.fields[0].value, '新值');
});
test('group helper detects changed origin before any form write', async () => {
    const tab = { url: async () => 'https://evil.example.com/form' };
    await assert.rejects(() => fillGroup(tab, { fields: [] }, { origin: 'https://jobs.example.com', authorization: { origin: 'https://jobs.example.com', expires_at: new Date(Date.now() + 60000).toISOString() }, saveBefore: async () => { }, saveAfter: async () => { } }));
});
test('missing draft callback prevents all writes', async () => {
    await assert.rejects(() => fillGroup({}, { fields: [] }, { origin: 'https://jobs.example.com', authorization: { origin: 'https://jobs.example.com', expires_at: new Date(Date.now() + 60000).toISOString() } }));
});
test('local server requires authentication and rejects cross-origin writes', async (t) => {
    const e = environment(t), d = await startDashboard(e.store);
    t.after(() => new Promise(r => d.server.close(r)));
    assert.equal((await fetch(d.origin + '/api/view')).status, 401);
    assert.equal((await fetch(d.origin + '/api/view', { headers: { Authorization: 'Bearer ' + d.secret } })).status, 200);
    assert.equal((await fetch(d.origin + '/api/call', { method: 'POST', headers: { Authorization: 'Bearer ' + d.secret, Origin: 'https://evil.example.com', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});
test('dashboard local mutations persist and never enable browser submit', async (t) => {
    const e = environment(t), d = await startDashboard(e.store);
    t.after(() => new Promise(r => d.server.close(r)));
    const headers = { Authorization: 'Bearer ' + d.secret, 'Content-Type': 'application/json' };
    const r = await fetch(d.origin + '/api/call', { method: 'POST', headers, body: JSON.stringify({ name: 'jobos1_remember', arguments: { mode: 'user_statement', confirmed: true, user_ref: '本地用户编辑', facts: [{ key: 'name', value: '陈同学' }] } }) });
    assert.equal(r.status, 200);
    const denied = await fetch(d.origin + '/api/call', { method: 'POST', headers, body: JSON.stringify({ name: 'jobos1_outcome', arguments: {} }) });
    assert.equal(denied.status, 403);
});
test('unknown assets and traversal paths are never served', async (t) => {
    const e = environment(t), d = await startDashboard(e.store);
    t.after(() => new Promise(r => d.server.close(r)));
    assert.equal((await fetch(d.origin + '/api/asset?sha=../../etc/passwd', { headers: { Authorization: 'Bearer ' + d.secret } })).status, 404);
});
test('MCP initialize and strict tool call work over real stdio transport', async (t) => {
    const e = environment(t);
    const p = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'src/mcp.mjs')], { env: { ...process.env, JOBOS_NEXT_HOME: e.dir }, stdio: ['pipe', 'pipe', 'pipe'] });
    t.after(() => p.kill());
    let buffer = '';
    const replies = [];
    p.stdout.on('data', b => { buffer += b; let n; while ((n = buffer.indexOf('\n')) >= 0) {
        replies.push(JSON.parse(buffer.slice(0, n)));
        buffer = buffer.slice(n + 1);
    } });
    const request = (id, method, params = {}) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    request(1, 'initialize', { protocolVersion: '2025-06-18' });
    request(2, 'tools/list');
    request(3, 'tools/call', { name: 'jobos1_context', arguments: {} });
    const start = Date.now();
    while (replies.length < 3 && Date.now() - start < 5000)
        await new Promise(r => setTimeout(r, 20));
    assert.equal(replies.length, 3);
    assert.equal(replies[0].result.serverInfo.name, 'jobos_next');
    assert.deepEqual(replies[1].result.tools.map(tool => tool.name), TOOLS.map(tool => tool.name));
    assert.equal(replies[2].result.structuredContent.contract, 'jobos/1');
});
test('opening an unrecognized database does not mutate it', t => {
    const e = environment(t);
    const old = path.join(e.dir, 'old');
    mkdirSync(old);
    const file = path.join(old, 'workspace.sqlite');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE records(id TEXT,value TEXT);INSERT INTO records VALUES (\'one\',\'private\')');
    db.close();
    const before = hash(readFileSync(file));
    assert.throws(() => new Store(old));
    assert.equal(hash(readFileSync(file)), before);
});
for (const prompt of ['暂停', '停止', '先到这里', '不弄了'])
    test('a plain Chinese pause stops hook continuation: ' + prompt, t => {
        const e = environment(t);
        hook(event('UserPromptSubmit', { prompt: 'Coming Jobs' }), e.dir);
        hook(event('UserPromptSubmit', { prompt }), e.dir);
        assert.deepEqual(hook(event('Stop', { last_assistant_message: '已暂停' }), e.dir), {});
    });
test('upload rejects draft filenames before portal reads', async () => {
 let reads=0;const tab={url:async()=> 'https://jobs.example.com/form',markHandoff:async()=>{}};
 await assert.rejects(fillGroup(tab,{key:'resume',fields:[{key:'cv',type:'file_upload',local_file:'/tmp/候选人-审核稿.pdf'}]},{origin:'https://jobs.example.com',authorization:{origin:'https://jobs.example.com',expires_at:new Date(Date.now()+60000).toISOString()},saveBefore:async()=>{},saveAfter:async()=>{},readUpload:async()=>{reads++;}}),/正式文件名/);assert.equal(reads,0);
});
test('same bytes with draft portal name still uploads formal name',async()=>{
 let uploads=0;const tab={url:async()=> 'https://jobs.example.com/form',markHandoff:async()=>{},playwright:{getByLabel:()=>({count:async()=>1,click:async()=>{}}),waitForEvent:async()=>({setFiles:async()=>{uploads++;}})}};
 await fillGroup(tab,{key:'resume',fields:[{key:'cv',type:'file_upload',local_file:'/tmp/候选人-公司-产品经理.pdf',material:{sha256:'same'},locator:{kind:'label',value:'附件'}}]},{origin:'https://jobs.example.com',authorization:{origin:'https://jobs.example.com',expires_at:new Date(Date.now()+60000).toISOString()},saveBefore:async()=>{},saveAfter:async()=>{},readUpload:async()=>({key:'cv',local_sha256:'same',upload_complete:true,file_name:uploads?'候选人-公司-产品经理.pdf':'候选人-审核稿.pdf'})});assert.equal(uploads,1);
});
