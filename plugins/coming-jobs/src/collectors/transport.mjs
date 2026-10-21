import { isIP } from 'node:net';

export class CollectionError extends Error {
    constructor(code, blocked = false, http_status = null) {
        super(code);
        Object.assign(this, { code, blocked, http_status });
    }
}
export const fail = (code, blocked = false) => { throw new CollectionError(code, blocked); };
const privateKey = /token|cookie|csrf|authorization|password|passwd|secret|session|api[_-]?key|verification|(?:^|_)headers?(?:$|_)/i;
const privateQuery = /token|cookie|csrf|auth|password|secret|session|api[_-]?key|email|phone|(?:^|_)code(?:$|_)/i;

export function publicUrl(value, base) {
    if (typeof value !== 'string' || !value.trim()) fail('invalid_public_url', true);
    let url;
    try { url = new URL(value, base); } catch { fail('invalid_public_url', true); }
    if (url.protocol !== 'https:' || url.username || url.password) fail('invalid_public_url', true);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const ipv4 = isIP(host) === 4;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') ||
        isIP(host) === 6 || ipv4 && (/^(?:0|10|127|169\.254|192\.168|192\.0|198\.(?:18|19)|22[4-9]|2[3-5]\d)\./.test(host) ||
        /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host))) fail('private_network_url', true);
    if ([...url.searchParams.keys()].some(k => privateQuery.test(k))) fail('private_url', true);
    url.hash = '';
    return url.href;
}

export function publicConfig(value, key = '', depth = 0) {
    if (depth > 12 || privateKey.test(key)) fail('private_configuration', true);
    if (Array.isArray(value)) value.forEach(v => publicConfig(v, key, depth + 1));
    else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) publicConfig(v, k, depth + 1);
    } else if (typeof value === 'string' && (/\bBearer\s+\S+|-----BEGIN.*PRIVATE KEY-----/i.test(value) || value.length > 10000)) fail('private_configuration', true);
}

export function safeUrl(value, base) {
    try { return publicUrl(value, base); } catch { return null; }
}

export function errorRecord(error, phase, external_id = null) {
    return { phase, code: error instanceof CollectionError ? error.code : 'collection_error',
        blocked: error instanceof CollectionError && error.blocked, http_status: error.http_status ?? null,
        ...(external_id === null ? {} : { external_id }) };
}

async function readLimited(response, maxBytes) {
    if (Number(response.headers?.get('content-length')) > maxBytes) fail('response_budget_exhausted');
    if (!response.body?.getReader) {
        const body = await response.text();
        if (Buffer.byteLength(body) > maxBytes) fail('response_budget_exhausted');
        return body;
    }
    const reader = response.body.getReader(), parts = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) { await reader.cancel(); fail('response_budget_exhausted'); }
            parts.push(Buffer.from(value));
        }
        return Buffer.concat(parts).toString('utf8');
    } finally { reader.releaseLock(); }
}

export function transport(limits, dependencies) {
    const fetch = dependencies.fetch ?? globalThis.fetch;
    const started = Date.now();
    const state = { requests: 0 };
    async function request(spec, allowedOrigins) {
        const url = publicUrl(spec.url);
        if (!allowedOrigins.has(new URL(url).origin)) fail('origin_not_allowed', true);
        if (state.requests >= limits.max_requests) fail('request_budget_exhausted');
        if (Date.now() - started >= limits.max_elapsed_ms) fail('time_budget_exhausted');
        const controller = new AbortController();
        const timeout = Math.min(limits.timeout_ms, limits.max_elapsed_ms - (Date.now() - started));
        let timer;
        state.requests++;
        try {
            const task = (async () => {
                const headers = { accept: 'application/json' };
                if (spec.headers) {
                    for (const [key, value] of Object.entries(spec.headers)) {
                        if (!['website-path', 'portal-channel', 'portal-platform', 'tenant-id'].includes(key.toLowerCase())) fail('private_configuration', true);
                        headers[key] = String(value);
                    }
                }
                let body;
                if (spec.form) {
                    body = new URLSearchParams(spec.form).toString();
                    headers['content-type'] = 'application/x-www-form-urlencoded';
                } else if (spec.body !== undefined) {
                    body = JSON.stringify(spec.body);
                    headers['content-type'] = 'application/json';
                }
                const response = await fetch(url, { method: spec.method ?? 'GET', headers, ...(body === undefined ? {} : { body }),
                    credentials: 'omit', redirect: 'manual', signal: controller.signal });
                if (response.redirected || response.status >= 300 && response.status < 400) throw new CollectionError('redirect_blocked', true, response.status);
                if (response.url && publicUrl(response.url) !== url) fail('unexpected_response_url', true);
                if (!response.ok) throw new CollectionError([401, 403, 407, 429].includes(response.status) ? 'access_blocked' : 'http_error', [401, 403, 407, 429].includes(response.status), response.status);
                const text = await readLimited(response, limits.max_response_bytes);
                try { return JSON.parse(text); } catch { fail('invalid_json'); }
            })();
            return await Promise.race([task, new Promise((_, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(new CollectionError('request_timeout')); }, timeout);
            })]);
        } catch (error) {
            if (error instanceof CollectionError) throw error;
            throw new CollectionError(controller.signal.aborted ? 'request_timeout' : 'network_error');
        } finally { clearTimeout(timer); }
    }
    return { request, state };
}
