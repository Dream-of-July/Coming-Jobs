import { readFileSync, realpathSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { A, B, E, I, O, OP, S, assert, hash, noSecrets, now } from './core.mjs';

/**
 * The parser version is part of every cache key. Bumping it is deliberately
 * explicit: a parser change must never silently reuse an old extraction.
 */
export const MATERIAL_INDEX_PARSER_VERSION = 'material-index/v1';

const TEXT_FORMATS = new Set(['txt', 'md', 'srt', 'vtt', 'json']);
const PDF_FORMATS = new Set(['pdf']);
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase();

function sourceRecords(store, args) {
    const wanted = args.source_ids ? new Set(args.source_ids) : args.material_ids ? new Set() : null;
    const all = store.all('source');
    const purposes = new Set(args.purposes ?? ['resume']);
    return all.filter(source => (!wanted || wanted.has(source.id)) && (wanted || (source.kind === 'resume' || (source.purposes ?? []).some(p => purposes.has(p)))));
}

function registeredPath(store, source) {
    if (source.asset) {
        const file = store.assetPath(source.asset);
        return { file, sha256: source.asset.sha256, format: source.asset.format, bytes: source.asset.bytes };
    }
    return null;
}

function cacheKey(sha256, parserVersion) {
    return hash(['material-index-cache', sha256, parserVersion]);
}

function cacheFor(store, sha256, parserVersion = MATERIAL_INDEX_PARSER_VERSION) {
    return store.get('material_index_cache', cacheKey(sha256, parserVersion), false);
}

function extractionFor(store, source, pathInfo, parserVersion) {
    // A text field beside an asset is metadata, not proof of parsing. Native
    // text files are re-read from the verified asset below; text-only records
    // remain reviewable until a host verifies them.
    if (!pathInfo && source.text != null) {
        noSecrets(source.text);
        const textSha = hash(source.text);
        const key = cacheKey(textSha, parserVersion);
        const existing = store.get('material_index_cache', key, false);
        const record = existing ?? store.put('material_index_cache', key, {
            sha256: textSha, parser_version: parserVersion, text: source.text, text_hash: textSha, method: 'registered_text', verified: false, created_at: now()
        });
        return { state: 'ready', verified: false, text: record.text, text_hash: record.text_hash, method: record.method, parser_version: parserVersion, cache_hit: !!existing };
    }
    if (source.text_evidence?.sha256 === pathInfo.sha256 && typeof source.text_evidence.text === 'string') {
        return { state: 'ready', verified: true, text: source.text_evidence.text, text_hash: hash(source.text_evidence.text), method: 'confirmed_material_evidence', parser_version: parserVersion, cache_hit: true };
    }
    const cached = cacheFor(store, pathInfo.sha256, parserVersion);
    if (cached)
        return { state: 'ready', verified: cached.verified !== false, text: cached.text, text_hash: cached.text_hash, method: cached.method, parser_version: parserVersion, cache_hit: true };
    if (TEXT_FORMATS.has(pathInfo.format)) {
        const text = readFileSync(pathInfo.file, 'utf8');
        noSecrets(text);
        const record = store.put('material_index_cache', cacheKey(pathInfo.sha256, parserVersion), {
            sha256: pathInfo.sha256, parser_version: parserVersion, text, text_hash: hash(text), method: 'native_text', created_at: now()
        });
        return { state: 'ready', verified: true, text: record.text, text_hash: record.text_hash, method: record.method, parser_version: parserVersion, cache_hit: false };
    }
    if (PDF_FORMATS.has(pathInfo.format))
        return { state: 'needs_host_extraction', parser_version: parserVersion, required_sha256: pathInfo.sha256 };
    return { state: 'needs_host_extraction', parser_version: parserVersion, required_sha256: pathInfo.sha256, reason: 'unsupported_text_parser' };
}

function baselineStatus(store, entries) {
    const baseline = store.get('settings', 'resume_baseline', false);
    if (!baseline)
        return { state: 'review_required', reason: 'baseline_missing' };
    const material = store.get('material', baseline.material_id, false);
    if (!material?.asset || !material.approved || material.asset.sha256 !== baseline.sha256)
        return { state: 'review_required', reason: 'baseline_material_missing_or_changed', material_id: baseline.material_id, sha256: baseline.sha256 };
    try { store.assetPath(material.asset); }
    catch { return { state: 'review_required', reason: 'baseline_asset_changed', material_id: baseline.material_id, sha256: baseline.sha256 }; }
    let text = null;
    let verified = false;
    if (material.text_evidence?.sha256 === baseline.sha256 && typeof material.text_evidence.text === 'string') {
        text = material.text_evidence.text;
        verified = true;
    }
    const entry = entries.find(x => x.sha256 === baseline.sha256 && x.material_ids.includes(material.id)) ?? entries.find(x => x.sha256 === baseline.sha256);
    if (!text && entry?.extraction?.state === 'ready' && entry.extraction.verified === true) {
        text = entry.extraction.text;
        verified = true;
    }
    if (!entry && !text)
        return { state: 'review_required', reason: 'baseline_not_registered', material_id: baseline.material_id, sha256: baseline.sha256 };
    if (!verified || !text)
        return { state: 'review_required', reason: 'baseline_text_unavailable', material_id: baseline.material_id, sha256: baseline.sha256 };
    const missing = (baseline.items ?? []).filter(item => !normalize(text).includes(normalize(item.text))).map(item => item.key);
    if (missing.length)
        return { state: 'review_required', reason: 'baseline_incomplete', material_id: baseline.material_id, sha256: baseline.sha256, missing_items: missing };
    return { state: 'verified', material_id: baseline.material_id, sha256: baseline.sha256, items: (baseline.items ?? []).map(item => item.key) };
}

function indexSources(store, args) {
    const parserVersion = args.parser_version ?? MATERIAL_INDEX_PARSER_VERSION;
    const grouped = new Map();
    const rejected = [];
    const add = (record, kind) => {
        let info;
        try { info = registeredPath(store, record); }
        catch (error) {
            rejected.push({ [`${kind}_id`]: record.id, state: 'review_required', code: error.code ?? 'invalid_source' });
            return;
        }
        if (!info && record.text == null) {
            rejected.push({ [`${kind}_id`]: record.id, state: 'review_required', code: 'source_missing' });
            return;
        }
        const sha256 = info?.sha256 ?? hash(record.text);
        const existing = grouped.get(sha256) ?? { sha256, bytes: info?.bytes ?? null, format: info?.format ?? 'text', source_ids: [], material_ids: [], labels: [], purposes: [], extractions: [] };
        if (kind === 'source') existing.source_ids.push(record.id);
        else existing.material_ids.push(record.id);
        if (record.label) existing.labels.push(record.label);
        existing.purposes.push(...(record.purposes ?? []));
        existing.extractions.push({ record_id: record.id, kind, value: extractionFor(store, record, info, parserVersion) });
        grouped.set(sha256, existing);
    };
    for (const source of sourceRecords(store, args)) add(source, 'source');
    const materialWanted = args.material_ids ? new Set(args.material_ids) : args.source_ids ? new Set() : null;
    for (const material of store.all('material').filter(m => m.kind === 'resume' && (!materialWanted || materialWanted.has(m.id)))) add(material, 'material');
    const selectedIds = new Set([...(args.source_ids ?? []), ...(args.material_ids ?? [])]);
    const includeText = args.include_text === true;
    const compact = extraction => {
        const out = { state: extraction.state, verified: extraction.verified === true, method: extraction.method ?? null, parser_version: extraction.parser_version };
        for (const key of ['text_hash', 'cache_hit', 'required_sha256', 'reason']) if (extraction[key] !== undefined) out[key] = extraction[key];
        if (includeText && selectedIds.has(extraction.record_id)) out.text = extraction.text;
        return out;
    };
    const entries = [...grouped.values()].map(entry => {
        const ready = entry.extractions.find(x => selectedIds.has(x.record_id) && x.value.state === 'ready') ?? entry.extractions.find(x => x.value.state === 'ready');
        const selected = entry.extractions.find(x => selectedIds.has(x.record_id));
        const extraction = ready?.value ?? selected?.value ?? entry.extractions[0]?.value ?? { state: 'needs_host_extraction', parser_version: parserVersion, required_sha256: entry.sha256 };
        return { sha256: entry.sha256, bytes: entry.bytes, format: entry.format, source_ids: entry.source_ids, material_ids: entry.material_ids,
            versions: entry.material_ids.map(key => { const m = store.get('material', key); return { material_id: key, job_id: m.job_id ?? null, base_id: m.base_id ?? null, base_sha256: m.base_sha256 ?? null, approved: !!m.approved }; }),
            labels: entry.labels, purposes: [...new Set(entry.purposes)], extraction: compact({ ...extraction, record_id: ready?.record_id ?? selected?.record_id ?? entry.extractions[0]?.record_id }), duplicate_count: entry.source_ids.length + entry.material_ids.length,
            _extraction: extraction };
    });
    const baseline = baselineStatus(store, entries.map(entry => ({ ...entry, extraction: entry._extraction })));
    return { parser_version: parserVersion, entries: entries.map(({ _extraction, ...entry }) => entry), rejected, baseline, indexed_at: now() };
}

function inventory(store, args) {
    // Discovery is permitted only after a concrete user authorization for a
    // single directory. It never recurses and never registers or parses files.
    assert(args.authorized === true && typeof args.user_ref === 'string' && args.user_ref.trim(), 'approval_required', '查找资料目录需要本次用户授权。');
    const root = realpathSync(args.root);
    assert(statSync(root).isDirectory(), 'invalid_root', '授权根路径必须是目录。');
    const extensions = new Set((args.extensions ?? ['pdf', 'md', 'txt', 'docx']).map(x => String(x).replace(/^\./, '').toLowerCase()));
    const maxFiles = args.max_files ?? 200;
    const maxBytes = Math.min(args.max_bytes ?? 20 * 1024 * 1024, 20 * 1024 * 1024);
    const files = [];
    const errors = [];
    let bytesRead = 0;
    let subdirectoriesSkipped = 0;
    let byteLimitReached = false;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (files.length >= maxFiles) break;
        if (entry.isDirectory()) { subdirectoriesSkipped++; continue; }
        if (!entry.isFile() || entry.isSymbolicLink()) continue;
        const file = path.join(root, entry.name);
        const format = path.extname(entry.name).slice(1).toLowerCase();
        if (!extensions.has(format)) continue;
        try {
            const resolved = realpathSync(file);
            assert(resolved === root || resolved.startsWith(root + path.sep), 'scope_violation', '候选资料路径逃逸了授权目录。');
            const size = statSync(resolved).size;
            if (bytesRead + size > maxBytes) { byteLimitReached = true; break; }
            const bytes = readFileSync(resolved);
            bytesRead += bytes.length;
            files.push({ path: resolved, name: entry.name, format, bytes: bytes.length, sha256: hash(bytes) });
        }
        catch (error) { errors.push({ name: entry.name, code: error.code ?? 'unreadable' }); }
    }
    return { root, recursive: false, files, errors, bytes_read: bytesRead, subdirectories_skipped: subdirectoriesSkipped,
        truncated: { files: files.length >= maxFiles, bytes: byteLimitReached }, authorized_ref: args.user_ref, observed_at: now() };
}

function hostText(store, args) {
    assert(typeof args.sha256 === 'string' && /^[a-f0-9]{64}$/.test(args.sha256), 'invalid_hash', '需要有效的资料 SHA-256。');
    assert(typeof args.text === 'string' && args.text.length > 0, 'text_missing', '需要宿主提供非空文本提取结果。');
    assert(typeof args.extraction_ref === 'string' && args.extraction_ref.trim(), 'extraction_evidence_required', '宿主提取结果必须带可追溯的提取依据。');
    noSecrets(args.text);
    const parserVersion = args.parser_version ?? MATERIAL_INDEX_PARSER_VERSION;
    const registeredSource = sourceRecords(store, {}).some(source => {
        try { return registeredPath(store, source)?.sha256 === args.sha256; }
        catch { return false; }
    });
    const registeredMaterial = store.all('material').some(material => {
        try { return material.asset && registeredPath(store, material)?.sha256 === args.sha256; }
        catch { return false; }
    });
    assert(registeredSource || registeredMaterial, 'unregistered_material', '只能缓存已登记资料的宿主提取结果。', '先登记并授权这份资料，再提交哈希绑定的文本。');
    const key = cacheKey(args.sha256, parserVersion);
    const existing = store.get('material_index_cache', key, false);
    if (existing && existing.text_hash !== hash(args.text))
        assert(false, 'cache_conflict', '同一资料和解析器版本已有不同提取结果。', '保留当前缓存，先核对宿主提取来源。');
    const record = existing ?? store.put('material_index_cache', key, { sha256: args.sha256, parser_version: parserVersion, text: args.text, text_hash: hash(args.text), method: 'host_reported', verified: true, extraction_ref: args.extraction_ref, created_at: now() });
    return { state: 'ready', cache_hit: !!existing, cache: { sha256: record.sha256, parser_version: record.parser_version, text_hash: record.text_hash, method: record.method } };
}

/**
 * Index only material already registered in the private workspace. It never
 * scans directories and never chooses a baseline by filename or modification
 * time. Returned text is private-workspace data and must not enter experience
 * or public fixtures.
 */
export function materialIndex(store, args = {}) {
    const operation = args.operation ?? 'index';
    if (operation === 'index' || operation === 'lookup')
        return indexSources(store, args);
    if (operation === 'inventory')
        return inventory(store, args);
    if (operation === 'cache_host_text')
        return hostText(store, args);
    assert(false, 'invalid_operation', '材料索引只支持 index、lookup 和 cache_host_text。');
}

export const MATERIAL_INDEX_SCHEMA = { oneOf: [
    OP('index', { source_ids: A(S(100), 1000), material_ids: A(S(100), 1000), include_text: B, parser_version: S(100) }, []),
    OP('lookup', { source_ids: A(S(100), 1000), material_ids: A(S(100), 1000), include_text: B, parser_version: S(100) }, []),
    OP('inventory', { root: S(4000), extensions: A(S(20), 20), max_files: I(1, 200), max_bytes: I(1, 20971520), authorized: B, user_ref: S(1000) }, ['root', 'authorized', 'user_ref']),
    OP('cache_host_text', { sha256: S(64), text: S(1000000), parser_version: S(100), extraction_ref: S(1000) }, ['sha256', 'text', 'extraction_ref'])
] };
