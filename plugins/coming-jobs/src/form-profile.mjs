import { assert, equal, hash, noSecrets, publicUrl, SECRET_KEY, S, B, I, E, A, O } from './core.mjs';
import { facts } from './profile.mjs';
import { sourceValue } from './field-source.mjs';
import { normalizeResumeText } from './resume-quality.mjs';

// These are semantic aliases, not candidate answers. Unrecognised company questions
// require an exact fact key or an explicit profile_key supplied after observing the field.
const normal = value => String(value).normalize('NFKC').toLowerCase()
    .replace(/\((?:optional|required|选填|必填)\)/g, '').replace(/[\s\p{P}\p{S}]/gu, '');
const aliases = {
    name: ['name', 'full_name', 'contact.name', 'personal.name', 'fullname', '姓名', '全名'],
    email: ['email', 'email_address', 'contact.email', '邮箱', '电子邮箱', '电子邮件', '邮箱地址'],
    phone: ['phone', 'phone_number', 'mobile', 'mobile_number', 'contact.phone', 'telephone', 'tel', '手机号', '手机号码', '联系电话'],
    github: ['github', 'github_url', 'github_profile', 'github_profile_url', 'github_link', 'links.github', 'social.github', 'GitHub主页', 'GitHub地址', 'GitHub链接'],
    linkedin: ['linkedin', 'linkedin_url', 'linkedin_profile', 'links.linkedin', 'social.linkedin', '领英', '领英主页'],
    portfolio: ['portfolio', 'portfolio_url', 'portfolio_link', 'links.portfolio', '作品集', '作品集链接', '作品集网址'],
    website: ['website', 'website_url', 'personal_website', 'personal_site', 'links.website', '个人网站', '个人主页']
};
const canonicalKeys = new Map(Object.entries(aliases).flatMap(([key, names]) => names.map(name => [normal(name), key])));
const canonical = value => canonicalKeys.get(normal(value));

export const FORM_FIELD_SCHEMA = O({ key: S(150), label: S(200), type: E('free_text', 'portal_select', 'date_picker', 'file_upload', 'url', 'checkbox', 'agreement', 'sensitive_user_owned'),
    required: B, applicable: B, observation_ref: S(1000), profile_key: S(150), max_length: I(1, 40000), options: A(O({ id: S(200), label: S(500) }), 500) }, ['key', 'label', 'type', 'required']);

export function fieldBoundary(field) {
    const label = `${field.key} ${field.label}`;
    if (/captcha|人机验证|滑块验证|图形验证/i.test(label)) return 'manual';
    if (/验证码|verification[\s_-]*code|one[\s_-]*time[\s_-]*(?:code|password)|(?:^|[\s_.-])otp(?:$|[\s_.-])|password|口令|密码/i.test(label)) return 'host_auth';
    if (field.type === 'sensitive_user_owned' || SECRET_KEY.test(field.key) || /身份证|护照|背调|法律声明|承诺书|诚信|passport|declaration/i.test(label) || field.type !== 'agreement' && /隐私|privacy/i.test(label)) return 'manual';
    return null;
}

function fieldProfile(field, available) {
    const explicit = field.profile_key;
    const labelKey = canonical(field.label), keyHint = canonical(explicit ?? field.key);
    const semantic = keyHint ?? labelKey;
    let candidates = available.filter(f => semantic ? canonical(f.key) === semantic : f.key === (explicit ?? field.key));
    // An exact custom key is useful for scoped company questions, but never uses a
    // similar-looking label as evidence for an answer with a different meaning.
    if (explicit && !canonical(explicit)) candidates = available.filter(f => f.key === explicit);
    const scoped = candidates.filter(f => f.scope !== 'global');
    if (scoped.length) candidates = scoped;
    return { candidates, semantic, conflict: !!(labelKey && keyHint && labelKey !== keyHint) };
}

export function scalarFieldValue(type, value) {
    return ['checkbox', 'agreement'].includes(type) ? typeof value === 'boolean' : typeof value === 'string';
}

function resolveField(field, available) {
    const base = { key: field.key, label: field.label, type: field.type, required: field.required };
    if (field.applicable === false) {
        assert(typeof field.observation_ref === 'string' && field.observation_ref.trim(), 'observation_required', '标记字段不再适用需要当前页面实际观察引用，不能直接删除已观察的缺口。');
        noSecrets(field.observation_ref);
        return { ...base, state: 'not_applicable', observation_ref: field.observation_ref, reason: '当前页面观察确认此字段不再适用，保留记录且不执行写入。' };
    }
    const boundary = fieldBoundary(field);
    if (boundary) return { ...base, state: boundary, reason: boundary === 'host_auth' ? '使用当前宿主已授权的即时认证流程，不保存认证值。' : '由用户处理此字段。' };
    if (field.type === 'agreement') return { ...base, state: 'agreement', reason: '使用当前完整协议文本、哈希和逐批批准。' };
    if (field.type === 'file_upload') return { ...base, state: 'material', reason: '使用已审核材料及实际附件限制。' };
    const { candidates, semantic, conflict } = fieldProfile(field, available);
    if (conflict) return { ...base, state: 'ambiguous', reason: '页面标签与资料字段含义不同，先核对字段。' };
    if (!candidates.length) return { ...base, state: 'unknown', reason: field.required ? '缺少适用的已确认资料；先查已授权来源，再只问真实缺口。' : '未知选填项保持空白。' };
    if (candidates.some(f => !equal(f.value, candidates[0].value)))
        return { ...base, state: 'ambiguous', evidence_ids: candidates.map(f => f.id), reason: '适用资料存在不同答案，不能自动猜测。' };
    const value = candidates[0].value;
    const evidence = { evidence_ids: candidates.map(f => f.id), profile_key: field.profile_key ?? semantic ?? candidates[0].key, scope: candidates[0].scope };
    if (typeof value === 'string' && !value.trim() || Array.isArray(value) && !value.length)
        return { ...base, ...evidence, state: 'unknown', reason: '已登记值为空，不能当作已填写资料。' };
    if (!scalarFieldValue(field.type, value))
        return { ...base, ...evidence, state: 'needs_format', reason: '当前控件需要单个明确值；不能把数组或其他类型自动转换成答案。' };
    if (field.max_length && typeof value === 'string' && [...value].length > field.max_length)
        return { ...base, ...evidence, state: 'needs_variation', max_length: field.max_length, reason: '原文超出实际字段长度，先审核公司专属压缩版本，不能截断。' };
    if (field.type === 'url') {
        try { publicUrl(value); }
        catch { return { ...base, ...evidence, state: 'needs_format', reason: '已确认内容不是可直接填写的公开 HTTPS 链接。' }; }
    }
    if (field.type === 'portal_select') {
        const options = (field.options ?? []).filter(option => normal(option.label) === normal(value) || option.id === value);
        if (options.length !== 1) return { ...base, ...evidence, state: 'needs_options', reason: '需要读取并唯一匹配当前真实选项，不把输入文字当作选中。' };
        return { ...base, ...evidence, state: 'matched', value: options[0].label, option_id: options[0].id };
    }
    return { ...base, ...evidence, state: 'matched', value };
}

// Bind all applicable aliases, not just the one fact originally cited. A new
// company override or same-value alias must be reconciled before reusing a grant.
export function formProfileBindings(store, app, plan) {
    const available = facts(store, 'form', `company:${app.company}`);
    const descriptors = new Map(plan.groups.flatMap(g => g.fields).map(f => [f.key, f]));
    for (const field of plan.observed_fields ?? []) descriptors.set(field.key, field);
    return [...descriptors.values()].filter(f => f.applicable !== false && !fieldBoundary(f) && f.type !== 'file_upload').map(field => {
        const { candidates } = fieldProfile(field, available);
        const versions = candidates.map(f => [f.id, f.key, f.value, f.scope, [...f.purposes].sort(), f.expires_at ?? null]).sort((a, b) => a[0].localeCompare(b[0]));
        return { key: field.key, digest: hash(versions) };
    }).sort((a, b) => a.key.localeCompare(b.key));
}

/** Baseline wording is usable only when it remains in the current approved PDF.
 * Reviewed replacements supersede the original even if it appears elsewhere. */
export function approvedMaterialTexts(store, material) {
    const base = store.get('settings', 'resume_baseline', false);
    const mappings = (material.baseline_mappings ?? []).filter(m => material.qa?.reviewed_content_keys?.includes(m.content_key));
    const superseded = new Set((base?.items ?? []).filter(item => mappings.some(m => m.content_key === item.key && m.text !== item.text)).map(item => item.text));
    const extracted = material.text_evidence?.sha256 === material.asset?.sha256 && typeof material.text_evidence?.text === 'string' ? normalizeResumeText(material.text_evidence.text) : null;
    const currentBaseline = base && material.asset?.sha256 === base.sha256 && (material.id === base.material_id || material.base_id === base.material_id && material.base_sha256 === base.sha256);
    const unchanged = (base?.items ?? []).filter(item => !superseded.has(item.text) && (currentBaseline || extracted?.includes(normalizeResumeText(item.text)))).map(item => item.text);
    return [...new Set([...(material.content?.sections.flatMap(section => section.items.map(item => item.text)) ?? []), ...mappings.map(m => m.text), ...unchanged])]
        .filter(text => typeof text === 'string' && text.trim() && !superseded.has(text) && (!extracted || extracted.includes(normalizeResumeText(text))));
}

function sameMeaning(left, right) {
    return normal(left) === normal(right) || !!canonical(left) && canonical(left) === canonical(right);
}

function sameControl(observed, target) {
    if (observed.type !== target.type || !sameMeaning(observed.label, target.label)) return false;
    // Semantic locators expose an additional checkable identity. CSS/test IDs do
    // not expose meaning and still need the host's normal unique-match checks.
    const label = target.locator?.kind === 'label' ? target.locator.value : target.locator?.kind === 'role' ? target.locator.name : null;
    return !label || sameMeaning(observed.label, label);
}

function approvedNarrative(store, app, observed, resolved, target) {
    if (target.type !== 'free_text' || fieldProfile(observed, []).semantic || !['matched', 'unknown', 'needs_variation'].includes(resolved.state)) return false;
    const material = store.get('material', app.resume_id, false);
    if (!material?.approved) return false;
    let evidence = [];
    if (target.variation_id && target.content_key) {
        const variation = store.get('material_variation', target.variation_id, false), base = store.get('settings', 'resume_baseline', false);
        if (!variation || variation.material_id !== material.id || variation.sha256 !== material.asset.sha256 || variation.base_sha256 !== base?.sha256 || variation.company !== app.company || variation.content_key !== target.content_key || variation.text !== target.value) return false;
        const current = new Map(facts(store, 'form', `company:${app.company}`).map(f => [f.id, f]));
        if (!variation.evidence.every(e => current.has(e.id) && hash(current.get(e.id).value) === e.digest)) return false;
        evidence = variation.evidence.map(e => e.id);
    } else if (target.material_id === material.id && approvedMaterialTexts(store, material).includes(target.value)) {
        evidence = [...(material.content?.sections.flatMap(section => section.items.filter(item => item.text === target.value).flatMap(item => item.evidence_ids)) ?? []),
            ...(material.baseline_mappings ?? []).filter(m => m.text === target.value && material.qa?.reviewed_content_keys?.includes(m.content_key)).flatMap(m => m.evidence_ids)];
    } else return false;
    // A reviewed rewrite can resolve a narrative answer only when its source is
    // the observed field's fact, or the observation explicitly names that item.
    return resolved.evidence_ids?.length ? evidence.some(id => resolved.evidence_ids.includes(id)) : !!target.content_key && (observed.profile_key ?? observed.key) === target.content_key;
}

export function resolveFormProfile(store, a) {
    const app = store.get('application', a.application_id);
    assert(new Set(a.fields.map(f => f.key)).size === a.fields.length, 'duplicate_field', '表单观察中的字段编号重复。');
    const available = facts(store, 'form', `company:${app.company}`);
    const fields = a.fields.map(field => resolveField(field, available));
    return { application_id: app.id, company: app.company, fields,
        known_optional_fields: fields.filter(f => !f.required && f.state === 'matched').map(f => f.key),
        missing_required_fields: fields.filter(f => f.required && !['matched', 'manual', 'host_auth', 'material', 'agreement', 'not_applicable'].includes(f.state)).map(f => f.key),
        next: '将所有已匹配的必填和有资料的选填项放入同一计划；使用 observed_fields 保留本次实际观察清单。仅处理真实缺口，不重复询问已确认资料。',
        writes_performed: false };
}

/** Coverage is checked again at review, so newly available or changed facts cannot
 * silently leave a known optional field out of the saved plan. Browser evidence
 * is supplied by the host; this is not a claim that unseen portal pages were read. */
export function formInventoryCoverage(store, app, plan) {
    if (!plan.observed_fields?.length) return { state: 'not_recorded', fields: [], blockers: [], write_blockers: [] };
    const resolved = resolveFormProfile(store, { application_id: app.id, fields: plan.observed_fields }).fields;
    const planned = plan.groups.flatMap(group => group.fields);
    const fields = resolved.map(field => {
        const target = planned.find(f => f.key === field.key);
        const observed = plan.observed_fields.find(f => f.key === field.key);
        if (field.state === 'not_applicable') return { ...field, covered: !target || !!target.manual, manual: !!target?.manual, reason: target && !target.manual ? 'not_applicable_field_planned' : 'not_applicable_observed' };
        if (['manual', 'host_auth'].includes(field.state)) return target && !target.manual ? { ...field, covered: false, reason: 'manual_field_required' } : { ...field, covered: true, manual: true };
        if (target) {
            if (!sameControl(observed, target)) return { ...field, covered: false, reason: 'field_identity_mismatch' };
            if (field.state === 'ambiguous') return { ...field, covered: false, reason: 'ambiguous_profile' };
            if (field.state === 'agreement') return { ...field, covered: target.type === 'agreement' && target.value === true && /^[a-f0-9]{64}$/.test(target.text_hash ?? ''), reason: 'agreement_approval_required' };
            if (field.state === 'material') return { ...field, covered: !!target.material, reason: target.material ? 'planned' : 'unreviewed_material' };
            if (!scalarFieldValue(field.type, target.value)) return { ...field, covered: false, reason: 'invalid_field_value' };
            if (observed.max_length && typeof target.value === 'string' && [...target.value].length > observed.max_length) return { ...field, covered: false, reason: 'field_length_exceeded' };
            const approvedVariation = approvedNarrative(store, app, observed, field, target);
            const source = target.source && facts(store, 'form', `company:${app.company}`).find(fact => fact.id === target.source.fact_id && field.evidence_ids?.includes(fact.id));
            let sourceMatches = false;
            try { sourceMatches = !!source && equal(sourceValue(source, target.source), target.value) && (field.type !== 'portal_select' || observed.options?.some(option => option.id === target.option_id && option.label === target.value)); }
            catch (error) { if (error.code !== 'field_transform') throw error; } // Changed source shapes invalidate coverage without failing an already saved fact correction.
            if (field.state !== 'matched' && !approvedVariation && !sourceMatches) return { ...field, covered: false, reason: `unresolved_${field.state}` };
            const matches = sourceMatches || (approvedVariation || equal(field.value, target.value)) && (field.type !== 'portal_select' || field.option_id === target.option_id);
            return { ...field, covered: matches, reason: matches ? 'planned' : 'confirmed_value_mismatch' };
        }
        const known = !!field.evidence_ids?.length;
        const missing = field.required || known;
        return { ...field, covered: !missing, reason: missing ? known ? 'known_field_omitted' : 'required_field_omitted' : 'optional_unknown' };
    });
    const blockers = fields.filter(f => !f.covered);
    return { state: blockers.length ? 'incomplete' : 'covered', fields, blockers,
        write_blockers: blockers.filter(field => planned.some(target => target.key === field.key)) };
}
