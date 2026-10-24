import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const VERSION = '1.0.0-beta.17';
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
const operationBranches = schema => schema.oneOf?.length && schema.oneOf.every(s => s.properties?.operation?.const !== undefined) ? schema.oneOf : null;
function operationBranch(schema, value) {
    const branches = operationBranches(schema);
    return branches && value && typeof value === 'object' ? branches.find(s => s.properties.operation.const === value.operation) ?? null : null;
}
const passes = (schema, value, at) => { const errors = []; collect(schema, value, at, errors); return errors.length === 0; };
// Collect every problem in one pass so callers can fix all fields in a single retry.
function collect(schema, value, at, errors) {
    const fail = (path, problem) => { errors.push({ path, problem }); return false; };
    if (schema.anyOf) {
        if (!schema.anyOf.some(s => passes(s, value, at))) fail(at, '不符合允许的字段结构');
        return;
    }
    if (schema.oneOf) {
        const branches = operationBranches(schema);
        if (branches && value && typeof value === 'object' && !Array.isArray(value)) {
            const operations = branches.map(s => s.properties.operation.const);
            if (!Object.hasOwn(value, 'operation')) return fail(`${at}.operation`, `缺失，可选 ${operations.join(' / ')}`);
            const branch = operationBranch(schema, value);
            if (!branch) return fail(`${at}.operation`, `不支持 ${String(value.operation).slice(0, 80)}，可选 ${operations.join(' / ')}`);
            return collect(branch, value, `${at}.${value.operation}`, errors);
        }
        if (schema.oneOf.filter(s => passes(s, value, at)).length !== 1) fail(at, '不符合任一明确操作结构');
        return;
    }
    if (schema.const !== undefined && !equal(value, schema.const))
        return fail(at, `必须为 ${schema.const}`);
    if (schema.enum && !schema.enum.includes(value))
        return fail(at, `必须为 ${schema.enum.join(' / ')}`);
    if (schema.type) {
        const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
        if (!(schema.type === 'integer' ? Number.isSafeInteger(value) : type === schema.type)) return fail(at, `类型应为 ${schema.type}`);
    }
    if (typeof value === 'string') {
        if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 1000000)) fail(at, '长度不在允许范围内');
        else if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(at, `格式不正确，应匹配 ${schema.pattern}`);
    }
    if (typeof value === 'number' && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)))
        fail(at, '超出允许范围');
    if (Array.isArray(value)) {
        if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 10000)) fail(at, '条目数量不正确');
        value.forEach((v, i) => collect(schema.items ?? {}, v, `${at}[${i}]`, errors));
    }
    if (schema.type === 'object') {
        for (const k of schema.required ?? [])
            if (!Object.hasOwn(value, k)) fail(`${at}.${k}`, '缺失');
        for (const [k, v] of Object.entries(value)) {
            if (['__proto__', 'constructor', 'prototype'].includes(k)) { fail(`${at}.${k}`, '禁止特殊对象键'); continue; }
            if (schema.additionalProperties === false && !Object.hasOwn(schema.properties ?? {}, k)) { fail(`${at}.${k}`, '不是该操作支持的字段'); continue; }
            if (schema.properties?.[k])
                collect(schema.properties[k], v, `${at}.${k}`, errors);
        }
    }
}
const PLACEHOLDER_TIME = '2026-01-01T00:00:00.000Z';
/** Minimal payload that passes the schema: required fields only, placeholders marked with <>. */
export function exampleFor(schema, key = 'value') {
    if (schema.const !== undefined) return schema.const;
    if (schema.enum) return schema.enum[0];
    if (schema.oneOf || schema.anyOf) return exampleFor((schema.oneOf ?? schema.anyOf)[0], key);
    switch (schema.type) {
        case 'object': return Object.fromEntries((schema.required ?? []).map(k => [k, exampleFor(schema.properties?.[k] ?? {}, k)]));
        case 'array': return Array.from({ length: schema.minItems ?? 0 }, () => exampleFor(schema.items ?? {}, key));
        case 'boolean': return true;
        case 'integer': case 'number': return Math.max(schema.minimum ?? 0, Math.min(1, schema.maximum ?? 1));
        case 'null': return null;
        case 'string': {
            if (schema.pattern) return `<匹配 ${schema.pattern}>`;
            const text = /(_at|deadline|until)$/.test(key) ? PLACEHOLDER_TIME : /sha256|_hash|digest/.test(key) ? '0'.repeat(Math.min(64, schema.maxLength ?? 64)) : `<${key}>`;
            return text.length <= (schema.maxLength ?? Infinity) ? text : text.slice(0, schema.maxLength);
        }
        default: return `<${key}>`;
    }
}
export function validate(schema, value, at = '参数') {
    const errors = [];
    collect(schema, value, at, errors);
    if (!errors.length) return;
    const branch = operationBranch(schema, value);
    const target = branch ?? (operationBranches(schema) ? null : schema);
    const details = { errors: errors.slice(0, 50), error_count: errors.length,
        ...(branch ? { operation: value.operation } : operationBranches(schema) ? { operations: operationBranches(schema).map(s => s.properties.operation.const) } : {}),
        ...(target ? { example: exampleFor(target) } : {}) };
    const list = errors.slice(0, 20).map(e => `${e.path}${e.problem}`).join('；');
    throw new Fault('invalid_arguments', errors.length === 1 ? `${list}。` : `共 ${errors.length} 处参数问题：${list}${errors.length > 20 ? '……' : ''}。`,
        '按 details.errors 一次修正全部字段后重试，可直接参照 details.example 补齐必填项；不读取源码猜参数。', details);
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
