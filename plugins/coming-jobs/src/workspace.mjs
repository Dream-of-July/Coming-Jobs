import { readFileSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assert, consent, noSecrets, hash, id, now, CONTRACT, SECRET_KEY, SENSITIVE_KEY } from './core.mjs';
import { remember } from './profile.mjs';
export function workspace(store, a) {
    if (a.operation === 'presentation') {
        noSecrets(a.result_ref);
        const current = store.get('settings', 'presentation');
        assert(!a.view_hash || current.view_hash === a.view_hash, 'presentation_changed', '进度页已更新，仅重新打开当前页面。');
        return store.put('settings', 'presentation', { ...current, status: a.status, result_ref: a.result_ref, observed_at: now() });
    }
    if (a.operation === 'dashboard') return { status:'ready' };
    if (a.operation === 'source') {
        consent(a.authorized, a.user_ref);
        assert(a.file || a.text, 'source_missing', '需要一份明确文件或非空文本。');
        const asset = a.file ? store.asset(a.file, a.allowed_root) : null;
        const text = a.text ?? (asset && ['txt', 'md', 'srt', 'vtt'].includes(asset.format) ? readFileSync(store.assetPath(asset), 'utf8') : null);
        if (text)
            noSecrets(text);
        const key = hash([asset?.sha256 ?? text, a.purposes]);
        return store.put('source', key, { label: a.label, kind: a.kind, purposes: a.purposes, asset, text,
            content_hash: asset?.sha256 ?? hash(text), authorized_ref: a.user_ref, trust: 'untrusted_content', created_at: now() });
    }
    if (a.operation === 'export') {
        consent(a.authorized, a.user_ref);
        const kinds = ['fact', 'proposal', 'fact_history', 'settings', 'job', 'collection', 'job_snapshot', 'assessment', 'batch', 'application', 'plan', 'draft', 'draft_history', 'feedback', 'capability', 'material', 'observation', 'notification', 'source', 'interview_pack', 'interview_review', 'company', 'opportunity', 'daily_source', 'daily_budget', 'daily_task', 'daily_run', 'daily_report', 'daily_feedback', 'daily_todo', 'application_scope', 'experience', 'execution_batch', 'baseline_history', 'execution_summary', 'material_variation', 'agent_task', 'agent_attempt', 'material_index_cache'];
        const records = Object.fromEntries(kinds.map(k => [k, store.all(k)]));
        const file = store.writeExport(`jobos-export-${Date.now()}.json`, { format: CONTRACT, workspace: store.workspace, created_at: now(), records });
        const assetsDir = file.replace(/\.json$/, '-assets');
        mkdirSync(assetsDir, { recursive: true, mode: 0o700 });
        for (const r of [...records.material, ...records.source])
            if (r.asset)
                cpSync(store.assetPath(r.asset), path.join(assetsDir, r.asset.relative_path));
        return { file, assets_directory: assetsDir, contains_private_data: true, note: 'JSON与同名-assets目录共同构成备份。不要提交公开仓库。' };
    }
    if (a.operation === 'import') {
        consent(a.authorized, a.user_ref);
        const bytes = readFileSync(a.file);
        assert(bytes.length < 50 * 1024 * 1024, 'import_too_large', '导入文件过大。');
        const data = JSON.parse(bytes.toString('utf8'));
        // Usage counters are numeric metrics, not authentication tokens. Keep
        // the general secret filter strict for every other key and value.
        const inspected = structuredClone(data);
        for (const kind of ['agent_task', 'agent_attempt']) {
            for (const record of inspected.records?.[kind] ?? []) {
                for (const key of ['input_tokens', 'output_tokens']) {
                    if (!Object.hasOwn(record.metrics ?? {}, key)) continue;
                    const value = record.metrics[key];
                    assert(Number.isInteger(value) && value >= 0 && value <= 10000000, 'invalid_usage', '用量指标必须为有界非负整数。');
                    delete record.metrics[key];
                }
            }
        }
        noSecrets(inspected);
        if (data.format === CONTRACT) {
            const kinds = ['fact', 'proposal', 'fact_history', 'settings', 'job', 'collection', 'job_snapshot', 'assessment', 'batch', 'application', 'plan', 'draft', 'draft_history', 'feedback', 'capability', 'material', 'observation', 'notification', 'source', 'interview_pack', 'interview_review', 'company', 'opportunity', 'daily_source', 'daily_budget', 'daily_task', 'daily_run', 'daily_report', 'daily_feedback', 'daily_todo', 'application_scope', 'experience', 'execution_batch', 'baseline_history', 'execution_summary', 'material_variation', 'agent_task', 'agent_attempt', 'material_index_cache'];
            assert(kinds.every(k => store.all(k).length === 0), 'restore_not_empty', '恢复备份需要空的新工作区，避免覆盖现有资料。');
            const assetRoot = a.assets_dir ?? a.file.replace(/\.json$/, '-assets');
            for (const r of [...(data.records.material ?? []), ...(data.records.source ?? [])])
                if (r.asset) {
                    assert(/^[a-f0-9]{64}\.[a-z0-9]+$/.test(r.asset.relative_path), 'invalid_asset', '备份资产名称不合法。');
                    const copied = store.asset(path.join(assetRoot, r.asset.relative_path), assetRoot);
                    assert(copied.sha256 === r.asset.sha256, 'asset_changed', '备份中的附件哈希不一致。');
                }
            let count = 0;
            for (const k of kinds)
                for (const raw of data.records[k] ?? []) {
                    const r = { ...raw };
                    if (k === 'agent_attempt' && r.state === 'running') r.state = 'interrupted';
                    if (k === 'agent_task') { r.state = 'pending'; r.attempt_id = null; r.owner = null; r.result = null; r.cache_hit = false; r.checked_ids = []; r.error_ids = []; r.review_required = []; }
                    if (k === 'experience') r.state = 'candidate';
                    if (k === 'execution_batch') { r.state = 'unknown'; r.grant = null; }
                    if (k === 'application') {
                        r.authorization = null;
                        r.dirty = false;
                        if (r.stage === 'preparing')
                            r.review = null;
                    }
                    if (k === 'settings' && ['schedule', 'daily_scheduler'].includes(r.id))
                        r.state = 'needs_rebind';
                    store.put(k, r.id, r);
                    count++;
                }
            return { restored_records: count, external_permissions_restored: false, next: '资料已恢复；浏览器状态需要重新观察，定时任务需要在当前宿主核实绑定。' };
        }
        assert(data.format === 'jobos-transfer/1', 'unsupported_import', '需要 jobos-transfer/1 格式。', '使用所附只读转换脚本读取明确选择的旧库，或让宿主从授权资料提取同格式。不要直接改旧数据库。');
        const result = remember(store, { mode: 'user_statement', confirmed: true, user_ref: a.user_ref, facts: (data.facts ?? []).filter(f => f.confirmed === true) });
        const proposed = (data.facts ?? []).filter(f => f.confirmed !== true);
        for (const f of proposed)
            store.put('proposal', id('proposed'), { ...f, state: 'proposed', scope: f.scope ?? 'global', purposes: f.purposes ?? ['matching', 'resume', 'form', 'interview'] });
        const imported = [];
        for (const old of data.applications ?? []) {
            const key = 'import_' + hash([old.company, old.external_id ?? old.title, old.submitted_at ?? '']).slice(0, 24);
            if (store.get('application', key, false))
                continue;
            // Historical reports are never upgraded to current provider verification.
            imported.push(store.put('application', key, { company: old.company, title: old.title, mode: 'live', stage: old.stage ?? 'unknown', job_id: null,
                job_snapshot: { company: old.company, title: old.title, external_id: old.external_id ?? null, content_hash: null, jd: old.jd ?? '' },
                submission_evidence: old.submitted ? 'user_reported' : 'unverified', provider_verified: false,
                submitted_material: null, observations: [], imported_at: now(), source_ref: a.user_ref, attention: 'historical_import' }));
        }
        if (data.preferences)
            store.put('settings', 'preferences', data.preferences);
        return { confirmed_facts: result.saved.length, proposals: proposed.length, applications: imported.length, old_database_modified: false };
    }
}
/** Read exactly one user-selected legacy database. No directory scanning, no writes. */
export function convertLegacy(file) {
    assert(existsSync(file), 'not_found', '旧数据库不存在。');
    const db = new DatabaseSync(file, { readOnly: true });
    try {
        const columns = db.prepare("PRAGMA table_info(records)").all().map(r => r.name);
        assert(['kind', 'id', 'value'].every(c => columns.includes(c)), 'unsupported_legacy', '这个旧库不是受支持的 records 导出结构。', '保留原库，让宿主从已授权旧资料导出 jobos-transfer/1；不要猜列名或直接迁移。');
        const rows = db.prepare("SELECT kind,value FROM records WHERE kind IN ('fact','application','settings')").all();
        const fs = [], apps = [];
        let preferences = null;
        for (const row of rows) {
            const x = JSON.parse(row.value);
            if (row.kind === 'fact' && ['confirmed'].includes(x.status ?? x.state) && !SECRET_KEY.test(x.key ?? '') && !SENSITIVE_KEY.test(x.key ?? ''))
                fs.push({ key: ({ 'constraint.locations': 'intent.locations', 'constraint.availability': 'availability', 'constraint.languages': 'languages' })[x.key] ?? x.key, value: x.value, purposes: x.purposes ?? ['matching', 'resume', 'form', 'interview'], scope: x.scope ?? 'global', confirmed: true });
            if (row.kind === 'application')
                apps.push({ company: x.company ?? '待核对公司', title: x.title ?? '待核对岗位', submitted: ['SUBMITTED', 'SUBMITTED_VERIFIED', 'submitted', 'assessment', 'interview'].includes(x.state ?? x.stage), stage: ({ SUBMITTED: 'submitted', SUBMITTED_VERIFIED: 'submitted', READY_TO_START: 'unknown' })[x.state] ?? x.stage ?? 'unknown', external_id: x.external_id ?? null, submitted_at: x.submitted_at ?? null });
            if (row.kind === 'settings' && x.template_id)
                preferences = { template: ({ 'figma-cv-v3-cn': 'classic', 'narrative': 'projects', 'clean': 'clean' })[x.template_id] ?? 'classic', figma: x.figma_url ?? null };
        }
        return { format: 'jobos-transfer/1', facts: fs, applications: apps, preferences, source: 'explicit_legacy_records_readonly' };
    }
    finally {
        db.close();
    }
}
