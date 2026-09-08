import { imageMetadata } from './image-metadata.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { assert, consent, noSecrets, hash, id, now, publicUrl } from './core.mjs';
import { facts } from './profile.mjs';
export const TEMPLATES = [
    { id: 'classic', name: '经典设计', route: '真实 Figma 导出或用户现有 PDF；不得冒充已连接' },
    { id: 'projects', name: '项目精选', route: '内置 A4 内容丰富模板' },
    { id: 'clean', name: '专业简约', route: '内置 A4 紧凑模板' }
];
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function renderHTML(content, template = 'projects') {
    const sections = content.sections.map(s => `<section><h2>${escape(s.title)}</h2>${s.items.map(i => `<p>${escape(i.text).replace(/\n/g, '<br>')}</p>`).join('')}</section>`).join('');
    const links = (content.links ?? []).map(l => `<a href="${escape(publicUrl(l.url))}">${escape(l.label)}</a>`).join(' · ');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'self'"><title>${escape(content.name)} · 简历</title><style>
  @page{size:A4;margin:17mm 18mm}*{box-sizing:border-box}body{font:10.5pt/1.6 'PingFang SC','Noto Sans CJK SC','Microsoft YaHei',sans-serif;color:#20282e;margin:0;background:white}
  main{max-width:174mm;margin:0 auto}header{border-bottom:2px solid #20282e;padding-bottom:12px;margin-bottom:16px}h1{font-size:25pt;line-height:1.15;margin:0 0 8px}header p{margin:3px 0}h2{font-size:12pt;margin:0 0 8px;letter-spacing:.05em}section{margin:18px 0}section p{margin:7px 0;white-space:normal;orphans:3;widows:3}a{color:inherit;text-decoration:none}small{color:#59646e}.clean{font-size:10pt}.clean h1{font-size:23pt}.clean section{margin:13px 0}.projects section{display:grid;grid-template-columns:22mm 1fr;gap:0 8mm}.projects section h2{grid-row:1 / span 80}.projects section p{grid-column:2}h2{break-after:avoid}header{break-inside:avoid}@media screen{body{background:#eef1f3;padding:30px}main{background:white;max-width:210mm;padding:17mm 18mm;box-shadow:0 5px 40px #0001}}
  </style></head><body class="${template}"><main><header><h1>${escape(content.name)}</h1><p>${escape(content.headline)}</p><small>${escape(content.contact ?? '')}</small>${links ? `<p>${links}</p>` : ''}</header>${sections}</main></body></html>`;
}
export function browserExecutable() {
    const candidates = [process.env.JOBOS_PDF_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
        process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe') : null,
        process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe') : null];
    return candidates.find(p => p && existsSync(p)) ?? null;
}
export function validateContent(store, content) {
    const fs = new Map(facts(store, 'resume').map(f => [f.id, f]));
    for (const section of content.sections)
        for (const item of section.items) {
            noSecrets(item.text);
            assert(item.evidence_ids.length > 0 && item.evidence_ids.every(e => fs.has(e)), 'resume_evidence', '每段简历内容需要已确认且允许用于简历的事实。');
            // This is a numeric lint, not a claim of semantic truth verification.
            const evidence = item.evidence_ids.map(e => JSON.stringify(fs.get(e).value)).join(' ');
            const numbers = item.text.match(/\d+(?:\.\d+)?%?/g) ?? [];
            assert(numbers.every(n => evidence.includes(n)), 'unbacked_number', '简历中的数字没有出现在引用事实中。', '先检查事实来源，不能编造成果。');
        }
    const used = [...new Set(content.sections.flatMap(s => s.items.flatMap(i => i.evidence_ids)))];
    return used.map(e => ({ id: e, digest: hash(fs.get(e).value) }));
}
const normalizeText = value => value.normalize('NFKC').replace(/\s+/gu, '');
export function assertCompleteness(store, material) {
    const base = store.get('settings', 'resume_baseline', false);
    if (!base || material.kind !== 'resume') return;
    assert(store.get('material', base.material_id).asset?.sha256 === base.sha256, 'stale_baseline', '基础文件发生变化，需要重新确认基线。');
    assert(material.id === base.material_id && material.asset?.sha256 === base.sha256 || material.base_id === base.material_id && material.base_sha256 === base.sha256,
        'resume_baseline_required', '简历没有关联当前已确认的完整基线，不能按文件时间猜测。');
    assert(material.text_evidence?.sha256 === material.asset?.sha256, 'resume_text_required', '需要与实际 PDF 哈希绑定的文本提取核验。');
    const text = normalizeText(material.text_evidence.text);
    assert(base.items.every(item => text.includes(normalizeText(item.text))), 'resume_incomplete', '简历缺少基线中的经历、成果、获奖或链接；先补齐并审核。');
}
export function assertMaterialCurrent(store, m) {
    assertCompleteness(store, m);
    if (!m.evidence)
        return;
    const current = new Map(facts(store, 'resume').map(f => [f.id, f]));
    assert(m.evidence.every(e => current.has(e.id) && hash(current.get(e.id).value) === e.digest), 'material_evidence_changed', '简历引用的事实已更正、撤回或过期。', '只更新受影响内容并重新审核，不能沿用旧授权。');
}
export function materialAction(store, a) {
    if (a.operation === 'variation') {
        consent(a.confirmed, a.user_ref);
        const m = store.get('material', a.material_id);
        assertMaterialCurrent(store, m);
        assert(m.approved, 'review_required', '文字例外需关联已确认简历。');
        const base = store.get('settings', 'resume_baseline');
        const item = base.items.find(i => i.key === a.content_key);
        assert(item, 'unknown_content', '文字例外必须指向基线条目。');
        const fs = new Map(facts(store, 'form', `company:${a.company}`).map(f => [f.id,f]));
        assert(a.evidence_ids.every(id => fs.has(id)), 'evidence_required', '公司例外需要适用的已确认事实。');
        noSecrets(a.text);
        assert(a.reason !== 'portal_length' || a.max_length && a.text.length <= a.max_length, 'field_length_exceeded', '压缩需记录门户限制，且不得超过限制。');
        return store.put('material_variation', hash([m.id,a.company,a.content_key,a.text]), { material_id: m.id, sha256: m.asset.sha256, base_sha256: base.sha256, content_key: a.content_key, company: a.company, text: a.text, original: item.text, reason: a.reason, max_length: a.max_length ?? null, evidence: a.evidence_ids.map(id => ({id,digest:hash(fs.get(id).value)})), user_ref: a.user_ref });
    }
    if (a.operation === 'baseline' || a.operation === 'lineage') {
        consent(a.confirmed, a.user_ref);
        const m = store.get('material', a.material_id);
        store.assetPath(m.asset);
        assert(m.kind === 'resume' && m.asset.sha256 === a.sha256, 'material_changed', '基线必须引用实际简历的精确哈希。');
        noSecrets(a.extracted_text);
        const text_evidence = { sha256: a.sha256, text: a.extracted_text, extraction_ref: a.extraction_ref, confirmed_ref: a.user_ref };
        if (a.operation === 'baseline') {
            assert(m.approved, 'review_required', '只有已确认简历可以成为基线。');
            assert(new Set(a.items.map(i => i.key)).size === a.items.length, 'duplicate_item', '完整性条目编号不能重复。');
            a.items.forEach(i => noSecrets(i));
            assert(a.items.every(i => normalizeText(a.extracted_text).includes(normalizeText(i.text))), 'resume_incomplete', '必备条目没有全部出现在提取文本中。');
            const previous = store.get('settings', 'resume_baseline', false);
            if (previous) store.put('baseline_history', id('baseline'), previous);
            store.put('settings', 'resume_baseline', { material_id: m.id, sha256: a.sha256, items: a.items, user_ref: a.user_ref });
            return store.put('material', m.id, { ...m, text_evidence });
        }
        const base = store.get('settings', 'resume_baseline');
        assert(a.base_id === base.material_id, 'stale_baseline', '指定的基础简历不是当前确认版本。');
        const updated = { ...m, base_id: base.material_id, base_sha256: base.sha256, text_evidence, approved: false };
        assertCompleteness(store, updated);
        return store.put('material', m.id, updated);
    }
    if (a.operation === 'templates')
        return { templates: TEMPLATES, preferences: store.get('settings', 'preferences', false) };
    if (a.operation === 'draft') {
        const job = store.get('job', a.job_id);
        const evidence = validateContent(store, a.content);
        const base = store.get('settings', 'resume_baseline', false);
        if (base) {
            const text = normalizeText([a.content.name, a.content.headline, ...(a.content.links ?? []).map(l => l.url), ...a.content.sections.flatMap(s => s.items.map(i => i.text))].join(' '));
            assert(base.items.every(i => text.includes(normalizeText(i.text))), 'resume_incomplete', '岗位版遗漏基线必备内容，不能静默删除或压缩。');
        }
        const template = a.template ?? store.get('settings', 'preferences', false)?.template ?? 'projects';
        const cache = hash([job.content_hash, template, a.content, evidence]);
        const prior = store.get('material', cache, false);
        if (prior)
            return prior;
        return store.put('material', cache, { kind: 'resume', base_id: base?.material_id ?? null, base_sha256: base?.sha256 ?? null, job_id: job.id, job_hash: job.content_hash, template, content: a.content, evidence,
            approved: false, asset: null, change_summary: a.change_summary, created_at: now(), cache_key: cache });
    }
    if (a.operation === 'render') {
        const m = store.get('material', a.material_id);
        assert(m.content, 'content_required', '没有结构化内容，不能调用内置渲染。');
        validateContent(store, m.content);
        if (m.asset)
            return { material: m, pdf_path: store.assetPath(m.asset), cache_hit: true };
        if (m.template === 'classic')
            return { material: m, host_action: '使用真实 Figma 文件导出 PDF，检查视觉和文本后调用 register；不必因为私有渲染器不存在而停止。', figma: store.get('settings', 'preferences', false)?.figma ?? null };
        const dir = path.join(store.home, 'drafts');
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = path.join(dir, m.id + '.html');
        writeFileSync(file, renderHTML(m.content, m.template), { mode: 0o600 });
        const executable = browserExecutable();
        if (!executable)
            return { material: m, html_path: file, pdf_available: false, next: '用宿主 PDF/文档能力导出这个 HTML，或在浏览器中打印为 PDF；再注册实际文件。' };
        const pdf = path.join(dir, m.id + '.pdf');
        const temp = mkdtempSync(path.join(os.tmpdir(), 'jobos-print-'));
        try {
            const result = spawnSync(executable, ['--headless', '--disable-gpu', '--disable-extensions', '--no-pdf-header-footer', `--user-data-dir=${temp}`, `--print-to-pdf=${pdf}`, pathToFileURL(file).href], { timeout: 45000, stdio: 'ignore' });
            assert(result.status === 0 && existsSync(pdf), 'pdf_render_failed', '本地浏览器 PDF 导出未成功。', '保留已生成 HTML，使用宿主文档能力导出；不修改简历内容。');
            const asset = store.asset(pdf);
            const job = store.get('job', m.job_id);
            asset.name = [m.content.name, job.company, job.title].join('-').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) + '.pdf';
            const updated = store.put('material', m.id, { ...m, asset, html_path: file }, m.revision);
            return { material: updated, pdf_path: store.assetPath(asset), qa: '需要实际视觉检查与文本提取检查，渲染成功不等于内容已审核。' };
        }
        finally {
            rmSync(temp, { recursive: true, force: true });
        }
    }
    if (a.operation === 'register') {
        consent(a.authorized, a.user_ref);
        const asset = store.asset(a.file, a.allowed_root);
        if (a.kind === 'photo') {
            const bytes = readFileSync(store.assetPath(asset));
            Object.assign(asset, imageMetadata(bytes, asset.format));
        } else assert(asset.format === 'pdf', 'invalid_pdf', '投递材料必须为 PDF。');
        const old = a.material_id ? store.get('material', a.material_id) : store.get('material', hash([a.kind, asset.sha256, a.job_id]), false);
        const sameBytes = old?.approved && old.kind === a.kind && old.asset?.sha256 === asset.sha256;
        if (sameBytes) assertMaterialCurrent(store, old);
        const job = a.job_id ? store.get('job', a.job_id) : old?.job_id ? store.get('job', old.job_id) : null;
        return store.put('material', old?.id ?? hash([a.kind, asset.sha256, job?.id]), { ...old, kind: a.kind, asset,
            job_id: job?.id ?? null, job_hash: job?.content_hash ?? null, template: old?.template ?? a.template ?? 'classic', approved: !!sameBytes,
            route: old?.content ? 'generated' : 'user_pdf', source_ref: a.user_ref, created_at: old?.created_at ?? now() });
    }
    if (a.operation === 'approve') {
        consent(a.confirmed, a.user_ref);
        const m = store.get('material', a.material_id);
        store.assetPath(m.asset);
        assertMaterialCurrent(store, m);
        assert(m.asset.sha256 === a.sha256, 'material_changed', '审核的 PDF 与当前文件不一致。');
        assert(a.visual_ok && a.content_ok, 'review_required', '视觉和内容必须分别检查。');
        return store.put('material', m.id, { ...m, approved: true, qa: { visual: true, content: true, text: a.text_quality }, approval_ref: a.user_ref, approved_at: now() });
    }
    if (a.operation === 'bind') {
        const app = store.get('application', a.application_id), m = store.get('material', a.material_id);
        assert(app.stage === 'preparing', 'application_locked', '投递后的材料快照不可改写。');
        assert(m.kind === 'resume', 'invalid_material', '主简历必须绑定 resume 材料。');
        assert(m.job_id === app.job_id && m.job_hash === app.job_snapshot.content_hash, 'wrong_job', '这份简历不属于当前岗位快照。');
        store.assetPath(m.asset);
        return store.put('application', app.id, { ...app, resume_id: m.id, authorization: app.authorization ?? null, review: app.resume_id === m.id ? app.review : null });
    }
}
