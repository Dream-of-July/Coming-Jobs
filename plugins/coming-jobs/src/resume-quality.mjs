import { assert, hash, noSecrets } from './core.mjs';

export const normalizeResumeText = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, '');
export function resumeText(content) {
    return [content.name, content.headline, content.contact ?? '', ...(content.links ?? []).flatMap(l => [l.label, l.url]),
        ...content.sections.flatMap(s => [s.title, ...s.items.map(i => i.text)])].join('\n');
}
function factText(value) {
    if (Array.isArray(value)) return value.map(factText).join(' ');
    if (value && typeof value === 'object') return Object.values(value).map(factText).join(' ');
    return value == null ? '' : String(value);
}
function numericTokens(text) {
    // Compare complete tokens: 2 is not supported by 12, nor 15 by 15%.
    // Grouping commas and whitespace before a percent sign are formatting only.
    return (String(text).normalize('NFKC').match(/(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*%)?/gu) ?? []).map(n => n.replace(/[,\s]/gu, ''));
}
export function assertNumbersSupported(text, evidence) {
    const supported = new Set(evidence.flatMap(f => numericTokens(factText(f.value))));
    assert(numericTokens(text).every(n => supported.has(n)), 'unbacked_number', '简历中的完整数字或百分比没有出现在引用事实中。', '核对数字、单位、对象与来源；此检查只比较数字，不验证成果含义。');
}
export function baselineMappings(base, mappings, text, available) {
    assert(!mappings.length || base, 'resume_baseline_required', '文字改写需要关联当前已确认基线。');
    assert(new Set(mappings.map(m => m.content_key)).size === mappings.length, 'duplicate_item', '同一基线条目只能有一份改写映射。');
    return mappings.map(mapping => {
        const original = base.items.find(i => i.key === mapping.content_key);
        assert(original, 'unknown_content', '改写映射必须指向当前基线条目。');
        noSecrets(mapping);
        assert(mapping.text.trim() && normalizeResumeText(text).includes(normalizeResumeText(mapping.text)), 'resume_mapping_text_missing', '映射中的新文字没有出现在实际内容中。');
        assert(mapping.reason.trim(), 'resume_mapping_reason_required', '说明这处改写与岗位的关系及保留的事实。');
        assert(mapping.evidence_ids.length && mapping.evidence_ids.every(id => available.has(id)), 'resume_evidence', '改写需要适用于本公司且允许用于简历的已确认事实。');
        const cited = mapping.evidence_ids.map(id => available.get(id));
        assertNumbersSupported(mapping.text, cited);
        return { ...mapping, original: original.text, evidence: cited.map(f => ({ id: f.id, digest: hash(f.value) })) };
    });
}
export function baselineCoverage(base, text, mappings = []) {
    const normalized = normalizeResumeText(text);
    const items = (base?.items ?? []).map(item => {
        const mapping = mappings.find(m => m.content_key === item.key);
        const rewritten = mapping && normalizeResumeText(mapping.text) !== normalizeResumeText(item.text) && normalized.includes(normalizeResumeText(mapping.text));
        const unchanged = !rewritten && normalized.includes(normalizeResumeText(item.text));
        return { key: item.key, category: item.category, original: item.text,
            state: unchanged ? 'verbatim' : rewritten ? 'mapped_rewrite' : 'missing',
            text: unchanged ? item.text : mapping?.text ?? null, evidence_ids: mapping?.evidence_ids ?? [], reason: mapping?.reason ?? null,
            removed_numbers: !unchanged && rewritten ? [...new Set(numericTokens(item.text))].filter(n => !numericTokens(mapping.text).includes(n)) : [] };
    });
    return { state: base ? 'recorded_inventory' : 'baseline_missing', items, missing_items: items.filter(i => i.state === 'missing').map(i => i.key) };
}
export function assertBaselineCovered(coverage) {
    assert(!coverage.missing_items.length, 'resume_incomplete', '岗位版缺少基线条目；改写必须保留逐条对照，不能静默删除。', `补齐以下基线条目或提供有事实依据的新文字映射，再审核差异：${coverage.missing_items.join('、')}。`);
}

const scopeWording = /\b(?:led|owned|managed|directed|spearheaded|architected|team lead|project lead|product owner)\b|主导|牵头|领导|全权负责|负责人/giu;
export function resumeQuality(content, available, base, mappings = [], extractedText = '') {
    const text = extractedText || (content ? resumeText(content) : '');
    const coverage = baselineCoverage(base, text, mappings);
    const used = new Set([...(content?.sections.flatMap(s => s.items.flatMap(i => i.evidence_ids)) ?? []), ...mappings.flatMap(m => m.evidence_ids)]);
    const warnings = [];
    const reviewItems = [];
    for (const [section_index, section] of (content?.sections ?? []).entries()) {
        for (const [item_index, item] of section.items.entries()) {
            const sources = item.evidence_ids.map(id => available.get(id)).filter(Boolean);
            const originals = mappings.filter(m => normalizeResumeText(item.text).includes(normalizeResumeText(m.text))).map(m => m.original);
            const sourceText = [...sources.map(f => factText(f.value)), ...originals].join('\n');
            const unchanged = normalizeResumeText(sourceText).includes(normalizeResumeText(item.text));
            reviewItems.push({ section_index, item_index, text: item.text, evidence_ids: item.evidence_ids, wording: unchanged ? 'source_wording' : 'edited',
                sources: sources.map(f => ({ id: f.id, key: f.key, value: f.value, source_id: f.source_id ?? null, source_ref: f.source_ref ?? null, evidence_level: f.evidence_level ?? 'unknown' })) });
            // Advisory, source-aware signals. These words can be accurate and
            // are never a ban list or evidence of falsity on their own.
            const introduced = [...new Set([...item.text.matchAll(scopeWording)].map(m => m[0].toLowerCase()))].filter(word => !sourceText.toLowerCase().includes(word));
            if (!unchanged && introduced.length) warnings.push({ code: 'introduced_scope_wording', section_index, item_index, terms: introduced, message: '改写新增职责范围措辞；对照原始来源确认个人贡献，没有依据就恢复准确表述。' });
            if (!unchanged && item.text.split(/[.!?。！？\n]+/u).some(sentence => (sentence.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []).length > 45))
                warnings.push({ code: 'long_sentence', section_index, item_index, message: '改写包含较长句子；人工检查是否可用更自然清楚的句子表达，保留具体动作和事实。' });
        }
    }
    for (const item of coverage.items.filter(i => i.removed_numbers.length))
        warnings.push({ code: 'baseline_numeric_detail_changed', content_key: item.key, removed_numbers: item.removed_numbers, message: '改写未保留这些基线数字；审核日期、人数或成果是否被遗漏。' });
    return { baseline: coverage, review_items: reviewItems, used_fact_ids: [...used], unused_fact_ids: [...available.keys()].filter(id => !used.has(id)),
        unused_facts_note: '未引用不等于遗漏；结合完整材料与岗位逐项检查，不能为了用完事实而堆砌简历。', warnings,
        editorial_review_required: true, semantic_verification: 'not_performed',
        review_note: '机械检查只核对已登记清单、文字映射、引用与数字；自然表达、职责范围、事实是否完整仍需逐项对照原文审核。' };
}
