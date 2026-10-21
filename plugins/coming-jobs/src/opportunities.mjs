import { assert, hash, now, iso, noSecrets, publicUrl } from './core.mjs';
const normal = s => String(s).normalize('NFKC').trim().toLowerCase();
export const companyMatches = (company, label) => [company.name, ...company.aliases].some(n => normal(n) === normal(label));
export const scopeKey = s => hash([s.track, s.campaign]);
export const submitted = a => !!a.submission_evidence && !['unverified', 'none'].includes(a.submission_evidence) || !['preparing', 'unknown'].includes(a.stage);
export function registerCompany(store, a) {
    noSecrets(a);
    const old = a.company_id ? store.get('company', a.company_id) : store.all('company').find(c => companyMatches(c, a.name));
    const aliases = [...new Set([...(old?.aliases ?? []), ...(a.aliases ?? []), ...(old && old.name !== a.name ? [old.name] : [])])];
    const candidate = { name: a.name, aliases };
    assert(!store.all('company').some(c => c.id !== old?.id && [c.name, ...c.aliases].some(n => companyMatches(candidate, n))), 'company_alias_conflict', '公司别名已属于另一条记录，先核验公司身份。');
    const scopes = a.scopes ?? old?.scopes ?? [];
    assert(new Set(scopes.map(scopeKey)).size === scopes.length, 'duplicate_scope', '招聘范围不能重复。');
    for (const s of scopes) publicUrl(s.source_url);
    const intro = a.introduction ?? old?.introduction ?? null;
    if (intro) { publicUrl(intro.source_url); iso(intro.observed_at); assert(Date.parse(intro.observed_at) <= Date.now() + 300000, 'future_observation', '公司介绍核验时间不能在未来。'); }
    return store.put('company', old?.id ?? hash(['company', normal(a.name)]).slice(0, 24), { ...candidate, scopes,
        introduction: intro, priority: a.priority ?? old?.priority ?? 0, priority_reason: a.priority_reason ?? old?.priority_reason ?? '',
        origin: old?.origin ?? a.origin ?? 'directory', created_at: old?.created_at ?? now() });
}
export function setOpportunity(store, a) {
    const company = store.get('company', a.company_id);
    noSecrets(a);
    assert(company.scopes.some(s => s.track === a.track && s.campaign === a.campaign), 'scope_unknown', '先登记该公司的招聘批次。');
    if (a.source === 'official') publicUrl(a.source_ref);
    const observed = iso(a.observed_at);
    assert(Date.parse(observed) <= Date.now() + 300000, 'future_observation', '规则核验时间不能在未来。');
    const key = hash([company.id, a.track, a.campaign]);
    const old = store.get('opportunity', key, false);
    assert(!old || Date.parse(old.observed_at) <= Date.parse(observed), 'stale_observation', '较旧规则不能覆盖较新核验。');
    return store.put('opportunity', key, { company_id: company.id, track: a.track, campaign: a.campaign,
        limit: Object.hasOwn(a, 'limit') ? a.limit : old?.limit ?? null, exhausted: a.exhausted ?? old?.exhausted ?? false,
        can_change: a.can_change ?? old?.can_change ?? null, volunteer_order: a.volunteer_order ?? old?.volunteer_order ?? 'unknown',
        deadline: Object.hasOwn(a, 'deadline') ? a.deadline === null ? null : iso(a.deadline) : old?.deadline ?? null,
        source: a.source, source_ref: a.source_ref, observed_at: observed });
}
export function opportunity(store, company, scope, mode = 'live') {
    const rule = store.get('opportunity', hash([company.id, scope.track, scope.campaign]), false);
    const apps = store.all('application').filter(a => (a.mode ?? 'live') === mode && companyMatches(company, a.company));
    const used = new Set(), uncertain = [];
    for (const a of apps.filter(a => submitted(a) || a.stage === 'unknown')) {
        const j = { ...(a.job_snapshot ?? {}), ...(store.get('application_scope', a.id, false) ?? {}) };
        if (j.track && j.track !== scope.track || j.campaign && j.campaign !== scope.campaign) continue;
        if (!j.track || !j.campaign || !submitted(a)) { uncertain.push(a.id); continue; }
        used.add(j.parent_application_id ?? j.external_id ?? a.job_id ?? a.id);
    }
    const remaining = rule?.limit == null ? null : Math.max(0, rule.limit - used.size);
    const exhausted = !!rule?.exhausted || remaining === 0;
    const rulesVerified = !!rule && Date.now() - Date.parse(rule.observed_at) <= 7 * 86400000;
    const closed=!!rule?.deadline&&Date.parse(rule.deadline)<=Date.now();
    return { state: closed ? 'closed' : exhausted ? 'exhausted' : uncertain.length || remaining === null || !rulesVerified ? 'needs_verification' : 'available',
        remaining: uncertain.length ? null : remaining, used: used.size, uncertain_application_ids: uncertain,
        rule_source: rule?.source ?? 'unknown', rule_observed_at: rule?.observed_at ?? null,
        rule_source_ref: rule?.source_ref ?? null, can_change: rule?.can_change ?? null, volunteer_order: rule?.volunteer_order ?? 'unknown', deadline: rule?.deadline ?? null,
        rules_verification: rulesVerified ? 'verified' : 'unreviewed',
        applications: apps.map(a => {const observation=(a.observations??[]).map(key=>store.get('observation',key,false)).filter(Boolean).sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at))[0];return { id: a.id, job_id: a.job_id, external_id: a.job_snapshot?.external_id ?? null, stage: a.stage, raw_stage: observation?.raw_stage??a.raw_stage??null, observed_at:observation?.observed_at??a.last_observation_at??null };}),
        note: [closed ? '本招聘项目已超过官方截止日，继续跟进已有申请。' : exhausted ? '本批次机会已用完，继续跟进已有申请。' : uncertain.length ? '历史批次或提交结果不明确，先只读核验剩余机会。' : remaining === null ? '剩余名额未知，开始投递前核验官方规则。' : null,
            !rulesVerified ? '投递规则未复核（缺失或核验已超过7天）。' : null].filter(Boolean).join(' ') || null };
}

/** Shared by comparison, shortlist, daily and selection: never infer a returned quota. */
export function jobOpportunity(store, job) {
    const company = store.all('company').find(c => companyMatches(c, job.company));
    return company ? opportunity(store, company, job, job.mode ?? 'live') : { state: 'needs_verification', remaining: null, rules_verification: 'unreviewed', note: '投递规则未复核（公司未登记）。' };
}

export function previouslyApplied(store, job) {
    const company = store.all('company').find(c => companyMatches(c, job.company));
    return store.all('application').some(a => submitted(a) && (a.mode ?? 'live') === (job.mode ?? 'live') &&
        (a.job_id === job.id || (company ? companyMatches(company, a.company) : normal(a.company) === normal(job.company)) &&
            (a.job_snapshot?.parent_application_id ?? a.job_snapshot?.external_id) === (job.parent_application_id ?? job.external_id) &&
            (a.job_snapshot?.track ?? store.get('application_scope', a.id, false)?.track) === job.track &&
            (a.job_snapshot?.campaign ?? store.get('application_scope', a.id, false)?.campaign ?? '') === (job.campaign ?? '')));
}
/** Only derive exact labels and explicit campaign data; never infer a historical batch. */
export function migrateCompanies(store) {
    for (const entry of [...store.all('job'), ...store.all('application')].filter(e => e.mode !== 'demo')) {
        let company = store.all('company').find(c => companyMatches(c, entry.company));
        if (!company) company = registerCompany(store, { name: entry.company });
        const j = entry.job_snapshot ?? entry;
        if (j.track && j.campaign && j.source === 'official' && j.url && !company.scopes.some(s => s.track === j.track && s.campaign === j.campaign))
            registerCompany(store, { company_id: company.id, name: company.name, scopes: [...company.scopes, { track: j.track, campaign: j.campaign, source_url: j.url }] });
    }
}

export function linkApplication(store, a) {
    noSecrets(a);
    const company = store.get('company', a.company_id), app = store.get('application', a.application_id);
    assert(companyMatches(company, app.company), 'company_scope_mismatch', '这份申请不属于所选公司。');
    assert(company.scopes.some(s => s.track === a.track && s.campaign === a.campaign), 'scope_unknown', '先登记已核验的招聘批次。');
    const old = app.job_snapshot ?? {};
    assert((!old.track || old.track === a.track) && (!old.campaign || old.campaign === a.campaign), 'scope_conflict', '原申请已有不同批次，不自动改写实际投递快照。');
    if (a.source === 'official') publicUrl(a.source_ref);
    const observed = iso(a.observed_at);
    assert(Date.parse(observed) <= Date.now() + 300000, 'future_observation', '核验时间不能在未来。');
    return store.put('application_scope', app.id, { company_id: company.id, track: a.track, campaign: a.campaign, source: a.source, source_ref: a.source_ref, observed_at: observed });
}
