import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const VERSION = '1.0.0-beta.16';
export const CONTRACT = 'jobos/1';
export function buildId() {
    try {
        return JSON.parse(readFileSync(path.join(ROOT, 'release.json'), 'utf8')).build;
    }
    catch {
        return 'development';
    }
}
export class Fault extends Error {
    constructor(code, message, next = '请保留当前页面，修正本次参数后再继续。', details = {}) {
        super(message);
        Object.assign(this, { code, next, details });
    }
}
export function assert(condition, code, message, next, details) {
    if (!condition)
        throw new Fault(code, message, next, details);
}
export const now = () => new Date().toISOString();
export const id = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;
export function canonical(value) {
    if (value === undefined)
        return 'null';
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object')
        return `{${Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',')}}`;
    return JSON.stringify(value);
}
export const hash = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const equal = (a, b) => canonical(a) === canonical(b);
export function iso(value, label = '时间') {
    assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'invalid_time', `${label}必须包含可解析日期。`);
    return new Date(value).toISOString();
}
export function publicUrl(value) {
    let u;
    try {
        u = new URL(value);
    }
    catch {
        throw new Fault('invalid_url', '需要完整的 HTTPS 地址。');
    }
    assert(u.protocol === 'https:' && !u.username && !u.password, 'invalid_url', '仅接受无账号口令的 HTTPS 地址。');
    assert(!['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname), 'invalid_url', '外部岗位不能指向本地地址。');
    assert(![...u.searchParams.keys()].some(k => /token|auth|password|secret|session|code|email|phone/i.test(k)), 'private_url', '不要保存带个人标识、邀请码或认证参数的地址。');
    u.hash = '';
    return u.href;
}
export function originOf(value) { return new URL(publicUrl(value)).origin; }
export function portalLocation(value, allowLocal = false) {
    const u = new URL(value);
    assert((u.protocol === 'https:' || allowLocal && u.protocol === 'http:' && u.hostname === '127.0.0.1') && !u.username && !u.password, 'invalid_origin', '门户必须为 HTTPS。');
    // Never persist private query strings or fragments in progress records.
    return { origin: u.origin, pathname: u.pathname };
}
export const SECRET_KEY = /password|passwd|(?:^|[_.])otp(?:$|[_.])|cookie|token|api[_-]?key|id[_-]?card|passport[_-]?number|ssn|verification[_-]?code/i;
export const SENSITIVE_KEY = /gender|birth|ethnic|religion|disability|health|marital|politic|(?:^|[_.])age(?:$|[_.])/i;
export function noSecrets(value, key = '') {
    assert(!SECRET_KEY.test(key), 'secret_not_supported', '密码、验证码、证件号码和会话秘密不进入 Coming Jobs 数据库。', '验证码仅在获准的当前登录流程中临时使用；不要传入普通事实、表单计划或检查点。其他敏感字段由用户直接处理。');
    if (typeof value === 'string') {
        assert(!/-----BEGIN.*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|(?:password|验证码|口令)\s*[:：=]\s*\S+/i.test(value), 'secret_not_supported', '文本可能包含认证秘密，请先移除。');
        assert(!/https?:\/\/\S*[?&#](?:access_token|token|secret|session|auth|code)=/i.test(value), 'private_url', '专属链接不能保存在普通记录中。');
    }
    else if (Array.isArray(value))
        value.forEach(v => noSecrets(v, key));
    else if (value && typeof value === 'object')
        for (const [k, v] of Object.entries(value))
            noSecrets(v, k);
}
export function consent(value, ref) {
    assert(value === true && typeof ref === 'string' && ref.trim().length > 0, 'approval_required', '需要本次实际用户确认的依据。', '说明具体资料、接收方和用途；已有适用授权不要重复询问。');
}
export function validate(schema, value, at = '参数') {
    if (schema.anyOf) {
        assert(schema.anyOf.some(s => { try { validate(s, value, at); return true; } catch { return false; } }), 'invalid_arguments', `${at}不符合允许的字段结构。`);
        return;
    }
    if (schema.oneOf) {
        if (value && typeof value.operation === 'string') {
            const branch = schema.oneOf.find(s => s.properties?.operation?.const === value.operation);
            assert(branch, 'invalid_arguments', `${at}.operation 不支持 ${String(value.operation).slice(0,80)}。`);
            return validate(branch, value, `${at}.${value.operation}`);
        }
        const valid = schema.oneOf.filter(s => { try {
            validate(s, value, at);
            return true;
        }
        catch {
            return false;
        } });
        assert(valid.length === 1, 'invalid_arguments', `${at}不符合任一明确操作结构。`, '根据 tools/list 中该操作的字段重试一次，不读取源码猜参数。');
        return;
    }
    if (schema.const !== undefined)
        assert(equal(value, schema.const), 'invalid_arguments', `${at}必须为 ${schema.const}。`);
    if (schema.enum)
        assert(schema.enum.includes(value), 'invalid_arguments', `${at}必须为 ${schema.enum.join(' / ')}。`);
    if (schema.type) {
        const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
        assert(schema.type === 'integer' ? Number.isSafeInteger(value) : type === schema.type, 'invalid_arguments', `${at}类型应为 ${schema.type}。`);
    }
    if (typeof value === 'string') {
        assert(value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? 1000000), 'invalid_arguments', `${at}长度不在允许范围内。`);
        if (schema.pattern)
            assert(new RegExp(schema.pattern).test(value), 'invalid_arguments', `${at}格式不正确。`);
    }
    if (typeof value === 'number')
        assert(value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity), 'invalid_arguments', `${at}超出允许范围。`);
    if (Array.isArray(value)) {
        assert(value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? 10000), 'invalid_arguments', `${at}条目数量不正确。`);
        value.forEach((v, i) => validate(schema.items ?? {}, v, `${at}[${i}]`));
    }
    if (schema.type === 'object') {
        for (const k of schema.required ?? [])
            assert(Object.hasOwn(value, k), 'invalid_arguments', `${at}.${k}缺失。`);
        for (const [k, v] of Object.entries(value)) {
            assert(!['__proto__', 'constructor', 'prototype'].includes(k), 'invalid_arguments', '禁止特殊对象键。');
            assert(schema.additionalProperties !== false || Object.hasOwn(schema.properties ?? {}, k), 'invalid_arguments', `${at}.${k}不是该操作支持的字段。`);
            if (schema.properties?.[k])
                validate(schema.properties[k], v, `${at}.${k}`);
        }
    }
}
export const S = (maxLength = 2000) => ({ type: 'string', minLength: 1, maxLength });
export const B = { type: 'boolean' };
export const I = (minimum = 0, maximum = 1000) => ({ type: 'integer', minimum, maximum });
export const E = (...values) => ({ type: 'string', enum: values });
export const A = (items, maxItems = 100) => ({ type: 'array', items, maxItems });
export const O = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const V = { oneOf: [S(40000), B, { type: 'number' }, A(S(4000), 100)] };
export const OP = (name, properties = {}, required = Object.keys(properties)) => O({ operation: { const: name }, ...properties }, ['operation', ...required]);

/** Public transport compatibility; strict validation still uses the original registry. */
export function publicSchema(schema) {
    if (!schema.oneOf) return schema;
    const properties = {}, operations = [];
    for (const branch of schema.oneOf) {
        operations.push(branch.properties.operation.const);
        for (const [key, value] of Object.entries(branch.properties)) {
            if (key === 'operation') continue;
            if (!properties[key]) properties[key] = value;
            else if (!equal(properties[key], value)) {
                const choices = properties[key].anyOf ?? [properties[key]];
                if (!choices.some(s => equal(s, value))) properties[key] = { anyOf: [...choices, value] };
            }
        }
    }
    return O({ operation: E(...operations), ...properties }, ['operation']);
}

export function assertExternalFilename(file) {
 const name=String(file??'').split(/[\\/]/).pop().normalize('NFKC');
 assert(name&&!/(审核稿|草稿|待确认|draft|review[ _-]*copy)/i.test(name),'external_filename_required','请使用不含审核稿、草稿等内部标记的正式文件名，保留已审核文件字节。');
 assert(!/[<>:"/\\|?*\x00-\x1f]/.test(name)&&!['.','..'].includes(name),'external_filename_required','附件名称无效。');
 return name;
}
