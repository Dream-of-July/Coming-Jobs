import http from 'node:http';
import { currentHost } from './host.mjs';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './core.mjs';
import { call } from './service.mjs';
import { guidance } from './flow.mjs';
import { coverage } from './profile.mjs';
import { metrics, queue } from './followup.mjs';
export function dashboardView(store) {
    return { flow: guidance(store), coverage: coverage(store), metrics: metrics(store), queue: queue(store),
        facts: store.all('fact').filter(f => f.state === 'confirmed'), proposals: store.all('proposal').filter(p => p.state === 'proposed'),
        batches: store.all('batch'), applications: store.all('application'), materials: store.all('material'), notifications: store.all('notification'),
        preferences: store.get('settings', 'preferences', false), schedule: store.get('settings', 'schedule', false) };
}
export async function startDashboard(store, { port = 0 } = {}) {
    const secret = randomBytes(32).toString('hex');
    let origin;
    const server = http.createServer(async (req, res) => {
        const send = (status, data, type = 'application/json; charset=utf-8') => {
            res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
                'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
            res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
        };
        if (!origin || req.headers.host !== new URL(origin).host)
            return send(403, { error: 'invalid_host' });
        const url = new URL(req.url, origin);
        const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/app.css': ['app.css', 'text/css; charset=utf-8'] };
        if (req.method === 'GET' && assets[url.pathname])
            return send(200, readFileSync(path.join(ROOT, 'web', assets[url.pathname][0])), assets[url.pathname][1]);
        if (req.headers.authorization !== `Bearer ${secret}`)
            return send(401, { error: 'authorization_required' });
        if (req.headers.origin && req.headers.origin !== origin)
            return send(403, { error: 'cross_origin_denied' });
        if (req.method === 'GET' && url.pathname === '/api/view') {
            return send(200, dashboardView(store));
        }
        if (req.method === 'GET' && url.pathname === '/api/asset') {
            const m = store.all('material').find(m => m.asset?.sha256 === url.searchParams.get('sha'));
            if (!m)
                return send(404, { error: 'not_found' });
            try {
                return send(200, readFileSync(store.assetPath(m.asset)), 'application/pdf');
            }
            catch {
                return send(409, { error: 'asset_changed' });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/call') {
            if (!req.headers['content-type']?.startsWith('application/json'))
                return send(415, { error: 'json_required' });
            try {
                let bytes = 0;
                const chunks = [];
                for await (const c of req) {
                    bytes += c.length;
                    if (bytes > 2 * 1024 * 1024)
                        return send(413, { error: 'too_large' });
                    chunks.push(c);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const allowed = new Set(['jobos1_remember', 'jobos1_profile', 'jobos1_shortlist', 'jobos1_followup']);
                if (!allowed.has(body.name))
                    return send(403, { error: 'use_codex_for_this_action' });
                const result = call(store, body.name, body.arguments);
                return send(result.ok ? 200 : 400, result);
            }
            catch {
                return send(400, { error: 'invalid_request' });
            }
        }
        send(404, { error: 'not_found' });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    return { server, url: origin + '/#' + secret, origin, secret };
}
