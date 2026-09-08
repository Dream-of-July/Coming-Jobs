import { assert, consent, noSecrets, SENSITIVE_KEY, id, hash, now, iso, publicUrl } from './core.mjs';
export const FOUNDATION = [
    ['intent.tracks', '招聘类型', 15, '这次主要找校招、实习还是社招？'],
    ['intent.direction', '职业方向', 20, '下一份工作，你最希望负责什么产品或问题？'],
    ['intent.locations', '地点范围', 10, '工作地点有哪些限制？也可以回答“不限”。'],
    ['education.summary', '教育与毕业时间', 15, '你的学校、专业和预计毕业时间是什么？'],
    ['experience.summary', '主要经历', 15, '最近一段经历中，你实际负责了什么？'],
    ['project.anchor', '代表项目', 15, '选一个最能代表你的项目，你亲自解决了什么问题？'],
    ['availability', '到岗安排', 5, '你预计什么时候可以到岗？暂时不确定也可以。'],
    ['languages', '工作语言', 5, '哪些语言可以用于日常工作和面试？']
];
export const PURPOSES = ['matching', 'resume', 'form', 'interview', 'tracking'];
export function facts(store, purpose, scope = 'global') {
    const available = store.all('fact').filter(f => f.state === 'confirmed' && (!purpose || f.purposes.includes(purpose)) &&
        (f.scope === 'global' || f.scope === scope) && (!f.expires_at || Date.parse(f.expires_at) > Date.now()));
    return available.filter(f => f.scope === scope || !available.some(other => other.key === f.key && other.scope === scope));
}
export function profileDigest(store, purpose = 'matching') {
    return hash(facts(store, purpose).map(f => [f.id, f.value, f.purposes, f.scope]).sort((a, b) => a[0].localeCompare(b[0])));
}
export function coverage(store) {
    const fs = facts(store, 'matching'), keys = new Set(fs.map(f => f.key));
    const controls = store.get('settings', 'interview', false) ?? {};
    const items = FOUNDATION.map(([key, label, weight]) => ({ key, label, weight, complete: keys.has(key) }));
    const campus = JSON.stringify(fs.find(f => f.key === 'intent.tracks')?.value ?? '').match(/campus|校招/);
    return { label: '基础求职信息覆盖率', percent: items.reduce((n, x) => n + (x.complete ? x.weight : 0), 0), items,
        answered: controls.answered ?? 0, skipped: controls.skipped ?? [], paused: controls.paused ?? false,
        ready: ['intent.tracks', 'intent.direction', 'intent.locations'].every(k => keys.has(k)) &&
            (keys.has('experience.summary') || keys.has('project.anchor')) && (!campus || keys.has('education.summary')),
        meaning: '只计算已确认基础项目，不代表对一个人的了解程度。' };
}
export function nextQuestion(store) {
    const c = coverage(store), controls = store.get('settings', 'interview', false) ?? {};
    if (c.paused)
        return { code: 'paused', prompt: '已保留访谈进度。回复“继续建档”可从这里恢复。' };
    const existing = store.all('question').find(q => q.state === 'open');
    if (existing)
        return existing;
    const item = FOUNDATION.find(([key]) => !c.items.find(x => x.key === key)?.complete && !c.skipped.includes(key));
    if (item)
        return { id: `foundation:${item[0]}`, key: item[0], prompt: item[3], state: 'open', kind: 'foundation' };
    return { code: 'depth_choice', prompt: '基础资料已经足够。现在继续深挖一个代表项目，还是先看推荐岗位？' };
}
export function remember(store, a) {
    if (a.mode === 'user_statement')
        consent(a.confirmed, a.user_ref);
    const source = a.source_id ? store.get('source', a.source_id) : null;
    assert(a.mode === 'user_statement' || source, 'source_required', '资料提取必须引用已授权来源。');
    const out = [];
    for (const entry of a.facts) {
        noSecrets(entry.value, entry.key);
        const purposes = entry.purposes ?? ['matching', 'resume', 'form', 'interview'];
        assert(purposes.every(p => PURPOSES.includes(p)), 'invalid_purpose', '用途不受支持。');
        if (source)
            assert(purposes.every(p => source.purposes.includes(p)), 'scope_violation', '不能扩大资料导入时的授权用途。');
        const sensitive = SENSITIVE_KEY.test(entry.key);
        assert(!sensitive || entry.sensitive_opt_in === true, 'sensitive_opt_in', '此类个人资料默认不收集。');
        assert(!sensitive || !purposes.includes('matching'), 'sensitive_matching', '敏感人口统计资料不参与岗位评分。');
        const scope = entry.scope ?? 'global';
        if (entry.expires_at)
            iso(entry.expires_at);
        const key = hash([entry.key, scope]).slice(0, 24);
        const current = store.get('fact', key, false);
        const state = a.mode === 'user_statement' ? 'confirmed' : 'proposed';
        const record = { key: entry.key, value: entry.value, scope, purposes, sensitive, state,
            source_id: source?.id ?? null, source_ref: a.user_ref ?? source?.label, expires_at: entry.expires_at ?? null };
        if (state === 'proposed') {
            const proposalId = 'proposed_' + hash(record).slice(0, 24);
            out.push(store.put('proposal', proposalId, { ...record, conflicts_with: current?.id ?? null }));
        }
        else {
            if (current && hash(current.value) !== hash(entry.value))
                store.put('fact_history', id('history'), { ...current, superseded_at: now() });
            out.push(store.put('fact', key, record));
        }
    }
    if (a.question_id) {
        const q = store.get('question', a.question_id, false);
        if (q)
            store.put('question', q.id, { ...q, state: 'answered' });
        const controls = store.get('settings', 'interview', false) ?? {};
        const answeredIds = controls.answered_ids ?? [];
        if (!answeredIds.includes(a.question_id))
            store.put('settings', 'interview', { ...controls,
                answered: (controls.answered ?? 0) + 1, answered_ids: [...answeredIds, a.question_id] });
    }
    return { saved: out, coverage: coverage(store), next_question: nextQuestion(store) };
}
export function controlProfile(store, a) {
    const controls = store.get('settings', 'interview', false) ?? {};
    if (a.operation === 'confirm') {
        consent(a.confirmed, a.user_ref);
        const ps = a.proposal_ids.map(key => store.get('proposal', key));
        assert(new Set(ps.map(p => p.key + '|' + p.scope)).size === ps.length, 'conflicting_selection', '同一字段有两个候选值，请只选择一个。');
        const result = remember(store, { mode: 'user_statement', confirmed: true, user_ref: a.user_ref, facts: ps });
        for (const p of ps)
            store.put('proposal', p.id, { ...p, state: 'accepted' });
        return result;
    }
    if (a.operation === 'question') {
        const open = store.all('question').find(q => q.state === 'open');
        if (open)
            return open;
        return store.put('question', id('question'), { key: a.key, prompt: a.prompt, kind: 'deep', state: 'open' });
    }
    if (a.operation === 'skip') {
        const q = nextQuestion(store);
        if (q.id && !q.id.startsWith('foundation:'))
            store.put('question', q.id, { ...q, state: 'skipped' });
        store.put('settings', 'interview', { ...controls, skipped: [...new Set([...(controls.skipped ?? []), q.key].filter(Boolean))] });
    }
    if (a.operation === 'pause' || a.operation === 'resume')
        store.put('settings', 'interview', { ...controls, paused: a.operation === 'pause' });
    if (a.operation === 'recommend')
        store.put('settings', 'interview', { ...controls, paused: false, finished: true });
    if (a.operation === 'preferences') {
        consent(a.confirmed, a.user_ref);
        if (a.preferences.timezone) {
            try {
                new Intl.DateTimeFormat('en', { timeZone: a.preferences.timezone });
            }
            catch {
                assert(false, 'invalid_timezone', '请使用IANA时区，例如 Asia/Shanghai。');
            }
        }
        if (a.preferences.referral_source) publicUrl(a.preferences.referral_source);
        const old = store.get('settings', 'preferences', false) ?? {};
        store.put('settings', 'preferences', { ...old, ...a.preferences });
    }
    if (a.operation === 'revoke') {
        consent(a.confirmed, a.user_ref);
        const f = store.get('fact', a.fact_id);
        store.put('fact', f.id, { ...f, state: 'revoked' });
    }
    return { coverage: coverage(store), next_question: nextQuestion(store) };
}
