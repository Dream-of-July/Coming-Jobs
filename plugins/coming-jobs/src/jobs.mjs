import { assert, consent, noSecrets, hash, id, now, iso, publicUrl } from './core.mjs';
import { facts, profileDigest } from './profile.mjs';
export function requirements(text) {
    const rows = text.split(/\r?\n|[；;]/).map(t => t.replace(/^\s*(?:[-•]|\d+[、.)])\s*/, '').trim()).filter(t => t.length > 5);
    return rows.slice(0, 60).map((text, i) => ({ id: `r${i + 1}`, text, kind: /优先|加分|preferred|plus/i.test(text) ? 'preferred' : 'requirement' }));
}
export function collectionStatus(store, collection) {
    if (!collection) return { state: 'unknown', complete: false, note: '没有官网采集范围证据，不代表全量。' };
    const jobs = store.all('job').filter(j => j.company === collection.company && j.track === collection.track && (j.campaign ?? '') === (collection.campaign ?? '') && j.mode === collection.mode);
    const missing = collection.external_ids.filter(id => !jobs.some(j => j.external_id === id));
    const complete = collection.complete && !collection.has_more && collection.external_ids.length === collection.total && !missing.length && Date.now() - Date.parse(collection.observed_at) <= 7 * 86400000;
    return { id: collection.id, company: collection.company, state: complete ? 'complete' : 'incomplete', complete,
        listed: collection.external_ids.length, total: collection.total, missing_count: missing.length, missing_external_ids: missing.slice(0,100), pages_read: collection.pages_read, has_more: collection.has_more };
}
export function saveJobs(store, a) {
    const saved = [];
    for (const j of a.jobs) {
        noSecrets(j.jd);
        const url = publicUrl(j.url);
        assert(j.jd.trim().length >= 40, 'jd_incomplete', '需要完整 JD，不接受只有职位标题的卡片。');
        const rs = j.requirements?.length ? j.requirements : requirements(j.jd);
        assert(rs.length, 'jd_parse_required', '正文存在，但没有可用职责条目。', '由宿主读正文后补上结构化要求，保留原文。');
        assert(new Set(rs.map(x => x.id)).size === rs.length, 'duplicate_requirements', 'JD要求编号重复。');
        const key = hash([j.company, j.external_id ?? url, j.track, j.campaign ?? '', j.mode]).slice(0, 24);
        const prior = store.get('job', key, false);
        const snapshot = { ...j, url, requirements: rs, content_hash: hash([j.jd, rs]), observed_at: iso(j.observed_at), state: j.state ?? 'open' };
        if (prior?.content_hash !== snapshot.content_hash)
            store.put('job_snapshot', hash([key, snapshot.content_hash]), { ...snapshot, job_id: key });
        saved.push(store.put('job', key, snapshot));
    }
    let collection = null;
    if (a.collection) {
        const c = a.collection;
        noSecrets(c);
        publicUrl(c.source_url);
        assert(new Set(c.external_ids).size === c.external_ids.length && c.external_ids.length <= c.total, 'collection_count_invalid', '官网数量与独立岗位编号不一致。');
        assert(!c.complete || (!c.has_more && c.external_ids.length === c.total && c.pages_read > 0), 'collection_incomplete', '仍有分页或岗位未列出，不能标记采集完成。');
        assert(saved.every(j => j.company === c.company && j.track === c.track && (j.campaign ?? '') === (c.campaign ?? '') && c.external_ids.includes(j.external_id)), 'collection_scope_mismatch', '岗位不属于本次采集范围。');
        const mode = saved[0]?.mode ?? a.mode ?? 'live';
        assert(saved.every(j => j.mode === mode), 'collection_scope_mismatch', '演练与真实采集分开记录。');
        assert(Date.parse(iso(c.observed_at)) <= Date.now() + 300000, 'future_observation', '采集时间不能在未来。');
        collection = store.put('collection', hash([c.company, c.track, c.campaign ?? '', mode]), { ...c, mode, observed_at: iso(c.observed_at) });
    }
    return { jobs: a.compact ? saved.map(({id,external_id,content_hash,title,company,requirements}) => ({id,external_id,content_hash,title,company,requirement_count:requirements.length})) : saved, collection: collection ? collectionStatus(store, collection) : null, coverage: a.coverage, warning: a.coverage === 'partial' ? '仅覆盖本次已读取的岗位；没有据此关闭其他岗位。' : null };
}
export function assessJobs(store, a) {
    const available = new Map(facts(store, 'matching').filter(f => !f.sensitive).map(f => [f.id, f]));
    const result = [];
    for (const assessment of a.assessments) {
        const job = store.get('job', assessment.job_id);
        assert(assessment.job_hash === job.content_hash, 'jd_changed', 'JD已更新，只重评这份岗位。');
        const mappings = assessment.mappings;
        assert(mappings.length === job.requirements.length && new Set(mappings.map(m => m.requirement_id)).size === mappings.length &&
            mappings.every(m => job.requirements.some(r => r.id === m.requirement_id)), 'incomplete_mapping', '必须覆盖每项 JD 要求，短板也要保留。');
        for (const m of mappings) {
            assert(m.evidence_ids.every(e => available.has(e)), 'evidence_not_confirmed', '引用证据必须已确认且允许用于匹配。');
            assert(['gap', 'unknown'].includes(m.relation) || m.evidence_ids.length > 0, 'evidence_missing', '直接或迁移匹配必须有个人证据。');
        }
        const score = Math.round(100 * mappings.reduce((n, m) => n + ({ direct: 1, transferable: 0.65, gap: 0, unknown: 0 }[m.relation]), 0) / mappings.length);
        const record = { ...assessment, score, profile_hash: profileDigest(store), evaluated_at: now(), semantics: '相对匹配排序，不是录用概率；语义映射由宿主判断' };
        result.push(store.put('assessment', job.id, record));
    }
    return { assessments: result };
}
export function shortlist(store, a) {
    if (a.operation === 'feedback') {
        consent(a.confirmed, a.user_ref);
        store.get('job', a.job_id);
        return store.put('feedback', a.job_id, { decision: a.decision, reason: a.reason ?? '', until: a.until ? iso(a.until) : null });
    }
    if (a.operation === 'choose') {
        consent(a.confirmed, a.user_ref);
        const batch = store.get('batch', a.batch_id);
        assert(!batch.discovery?.collection_pending, 'collection_incomplete', '官网范围仍有未读岗位，先补齐比较。');
        assert(!batch.discovery?.review_pending, 'scope_review_incomplete', '当前范围仍有已采集岗位未完成有效评估，先补齐比较，不消耗投递机会。');
        const selected = a.numbers.map(n => { const item = batch.items.find(j => j.number === n); assert(item, 'invalid_selection', '这份批次没有该编号。'); return item; });
        const applications = selected.map(item => createApplication(store, item.job_id, a.user_ref, item.job_hash));
        if (applications[0])
            store.put('settings', 'active', { application_id: applications[0].id });
        return { applications };
    }
    const pref = store.get('settings', 'preferences', false) ?? {};
    const timezone = pref.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const currentCompany = facts(store, 'matching').find(f => f.key === 'intent.current_company')?.value;
    const companiesScope = [...new Set(a.companies?.length ? a.companies : typeof currentCompany === 'string' ? [currentCompany] : [])].sort();
    const targetCount = a.target_count ?? 10;
    assert(!a.search_complete || a.search_note?.trim(), 'search_evidence_required', '声明搜索已完成时，需说明已查范围、过滤原因或具体限制。');
    const candidateRevision = hash([store.all('collection'), store.all('job'), store.all('assessment'), store.all('feedback'), store.all('application').map(x => x.job_id)]);
    const key = hash(['discovery-v3', date, timezone, a.mode ?? 'live', profileDigest(store), companiesScope, a.campaign ?? null, targetCount, candidateRevision, a.search_complete ?? false, a.search_note ?? null]).slice(0, 24);
    const existing = store.get('batch', key, false);
    if (existing && !a.refresh)
        return existing;
    const applied = new Set(store.all('application').map(x => x.job_id));
    const intentTracks = facts(store, 'matching').find(f => f.key === 'intent.tracks')?.value;
    const scopeJobs = store.all('job').filter(j => (!a.campaign || j.campaign === a.campaign) && j.state === 'open' && j.mode === (a.mode ?? 'live') &&
        (!companiesScope.length || companiesScope.some(c => c.toLowerCase() === j.company.toLowerCase())) &&
        (!intentTracks || JSON.stringify(intentTracks).includes(j.track)) &&
        (!j.deadline || Date.parse(j.deadline) > Date.now()) && Date.now() - Date.parse(j.observed_at) <= 7 * 86400000);
    const collections = store.all('collection').filter(c => (!a.campaign || c.campaign === a.campaign) && c.mode === (a.mode ?? 'live') && (!companiesScope.length || companiesScope.includes(c.company)) && (!intentTracks || JSON.stringify(intentTracks).includes(c.track)));
    const collectionChecks = collections.map(c => collectionStatus(store, c));
    const collectionPending = collectionChecks.some(c => !c.complete);
    const pendingReview = scopeJobs.filter(j => {
        const review = store.get('assessment', j.id, false);
        return !review || review.job_hash !== j.content_hash || review.profile_hash !== profileDigest(store);
    });
    const entries = store.all('assessment').filter(x => x.profile_hash === profileDigest(store)).map(x => ({ assessment: x, job: store.get('job', x.id) }))
        .filter(({ job: j, assessment: s }) => (!a.campaign || j.campaign === a.campaign) && j.state === 'open' && s.job_hash === j.content_hash && s.eligibility !== 'fail' && j.mode === (a.mode ?? 'live') && !applied.has(j.id) &&
        (!companiesScope.length || companiesScope.some(company => company.toLowerCase() === j.company.toLowerCase())) &&
        (!intentTracks || JSON.stringify(intentTracks).includes(j.track)) &&
        (!j.deadline || Date.parse(j.deadline) > Date.now()) && Date.now() - Date.parse(j.observed_at) <= 7 * 86400000)
        .filter(({ job }) => { const f = store.get('feedback', job.id, false); return !f || !['reject', 'defer'].includes(f.decision) || (f.decision === 'defer' && f.until && Date.parse(f.until) < Date.now()); })
        .sort((a, b) => b.assessment.score - a.assessment.score || Number(a.assessment.eligibility !== 'pass') - Number(b.assessment.eligibility !== 'pass') || a.assessment.mappings.filter(m => m.relation === 'unknown').length - b.assessment.mappings.filter(m => m.relation === 'unknown').length || a.job.id.localeCompare(b.job.id));
    const items = [];
    for (const e of entries) {
        const uncertain = e.assessment.mappings.filter(m => ['gap', 'unknown'].includes(m.relation));
        const risks = [...new Set([...e.assessment.gaps,
            ...uncertain.map(m => `${m.relation === 'unknown' ? '待核验' : '能力缺口'}：${m.reason}`),
            ...(e.assessment.eligibility === 'unknown' ? ['学历、毕业时间或其他硬性资格尚未完全核验'] : []),
            ...(e.job.source !== 'official' ? ['非官网来源，投递前需复核官方岗位'] : [])])];
        if (!risks.length) risks.push('当前证据未发现明确缺口，不代表没有竞争风险或保证录用');
        items.push({ number: items.length + 1, job_id: e.job.id, job_hash: e.job.content_hash, company: e.job.company, title: e.job.title, url: e.job.url,
            score: e.assessment.score, advantages: e.assessment.advantages, gaps: e.assessment.gaps, reason: e.assessment.reason,
            source: e.job.source, eligibility: e.assessment.eligibility, locations: e.job.locations ?? [], track: e.job.track,
            recommendation: { score: e.assessment.score, label: e.assessment.score >= 75 ? '优先考虑' : e.assessment.score >= 50 ? '值得考虑' : '谨慎考虑', semantics: '基于已确认资料的相对证据匹配度，不是录用概率' },
            risks, evidence_coverage: Math.round(100 * (e.assessment.mappings.length - uncertain.length) / e.assessment.mappings.length),
            mappings: e.assessment.mappings, observed_at: e.job.observed_at });
        if (items.length === targetCount)
            break;
    }
    // New editions get new IDs; never change the user's numbered batch in place.
    const shortage = Math.max(0, targetCount - items.length);
    const discovery = { target_count: targetCount, eligible_count: entries.length, returned_count: items.length, shortage,
        collections: collectionChecks, collection_pending: collectionPending, coverage_verified: !collectionPending && collectionChecks.length > 0 && companiesScope.every(c => collections.some(x => x.company === c)),
        target_met: shortage === 0 && pendingReview.length === 0 && !collectionPending, needs_more: collectionPending || pendingReview.length > 0 || (shortage > 0 && !a.search_complete),
        review_pending: pendingReview.length > 0, known_scope_count: scopeJobs.length, assessed_scope_count: scopeJobs.length - pendingReview.length,
        unassessed_job_ids: pendingReview.map(j => j.id),
        scope_note: '仅核对已入库范围；未入库或未读完整正文的岗位仍须由宿主报告缺口。',
        search_complete: a.search_complete ?? false, search_note: a.search_note ?? null,
        status: collectionPending ? 'collection_incomplete' : pendingReview.length ? 'review_incomplete' : shortage === 0 ? 'target_met' : a.search_complete ? 'insufficient' : 'continue_search',
        warning: pendingReview.length ? `当前范围还有${pendingReview.length}个已采集岗位未完成有效评估，不能把已选候选说成全量比较结果。` : shortage ? `当前仅有${items.length}个可比较岗位，距目标还差${shortage}个；${a.search_complete ? '已说明搜索限制，不以过期、重复或不相关岗位凑数' : '继续同一公司范围检索，暂不要求用户选岗'}` : null };
    return store.put('batch', existing ? id('batch') : key, { date, timezone, companies: companiesScope, items, discovery,
        coverage: '本次已核验且已完成证据映射的候选池', mode: a.mode ?? 'live' });
}
export function createApplication(store, jobId, userRef, expectedHash) {
    const job = store.get('job', jobId);
    if (expectedHash)
        assert(job.content_hash === expectedHash, 'jd_changed', '选中后 JD 已变化，先展示差异。');
    const existing = store.all('application').find(a => a.job_id === jobId);
    if (existing)
        return existing;
    assert(job.state === 'open' && (!job.deadline || Date.parse(job.deadline) > Date.now()), 'job_not_open', '这个岗位已经关闭或超过截止日。', '只读核验当前职位，不创建新的投递。');
    const app = store.put('application', id('app'), { job_id: job.id, job_snapshot: { ...job }, company: job.company, title: job.title,
        mode: job.mode, stage: 'preparing', user_ref: userRef, created_at: now(), resume_id: null, submitted_material: null, observations: [] });
    store.put('settings', 'active', { application_id: app.id });
    return app;
}
