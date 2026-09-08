import { HOST_POLICY } from './policy.mjs';
import { createInterface } from 'node:readline';
import { Store } from './store.mjs';
import { TOOLS } from './catalog.mjs';
import { call } from './service.mjs';
import { VERSION, validate } from './core.mjs';
import { startDashboard } from './web.mjs';
const store = new Store();
let dashboard = null;
const respond = (id, result, error) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }) + '\n');
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
// Serial handling prevents concurrent writers from racing the same application.
let pending = Promise.resolve();
async function receive(line) {
    let req;
    try {
        if (Buffer.byteLength(line) > 4 * 1024 * 1024)
            throw Error();
        req = JSON.parse(line);
    }
    catch {
        respond(null, null, { code: -32700, message: 'Invalid JSON-RPC input' });
        return;
    }
    if (!req || Array.isArray(req) || typeof req !== 'object') {
        respond(null, null, { code: -32600, message: 'JSON-RPC object required' });
        return;
    }
    if (req.id === undefined)
        return;
    if (req.jsonrpc !== '2.0') {
        respond(req.id, null, { code: -32600, message: 'JSON-RPC 2.0 required' });
        return;
    }
    if (req.method === 'initialize') {
        const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
        respond(req.id, { protocolVersion: versions.includes(req.params?.protocolVersion) ? req.params.protocolVersion : '2025-06-18',
            capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'jobos_next', version: VERSION },
            instructions: HOST_POLICY });
        return;
    }
    if (req.method === 'ping') {
        respond(req.id, {});
        return;
    }
    if (req.method === 'tools/list') {
        respond(req.id, { tools: TOOLS });
        return;
    }
    if (req.method === 'tools/call') {
        let result;
        if (req.params?.name === 'jobos1_workspace' && req.params.arguments?.operation === 'dashboard') {
            try {
                validate(TOOLS.find(t => t.name === 'jobos1_workspace').inputSchema, req.params.arguments);
                dashboard ??= await startDashboard(store);
                const current = call(store, 'jobos1_workspace', {operation:'dashboard'});
                result = { ...current, data: { ...current.data, url: dashboard.url, note: '仅本机；服务随这个 MCP 进程保持，退出后可从启动器重新打开。' } };
            }
            catch (e) {
                result = { ok: false, error: { code: e.code ?? 'dashboard_unavailable', message: e.code ? e.message : '工作台未启动。请从安装包启动器重试。', next: '保留当前投递页面；不要重新填写已确认资料。' } };
            }
        }
        else
            result = call(store, req.params?.name, req.params?.arguments ?? {});
        respond(req.id, { isError: !result.ok, structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] });
        return;
    }
    respond(req.id, null, { code: -32601, message: 'Method not found' });
}
lines.on('line', line => { pending = pending.then(() => receive(line)).catch(() => respond(null, null, { code: -32603, message: 'Local processing error' })); });
lines.on('close', async () => { await pending; dashboard?.server.close(); store.close(); });
