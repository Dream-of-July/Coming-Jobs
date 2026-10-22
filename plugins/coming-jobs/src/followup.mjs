import { assert, consent, noSecrets, hash, id, now, iso, equal } from './core.mjs';
import { recordOutcome } from './applications.mjs';
const submitted = a => a.stage !== 'voided' && (a.stage !== 'preparing' || a.submission_evidence);
const scrub = value => String(value ?? '').replace(/https?:\/\/[^\s<>]+/gi, '[专属链接已省略]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[邮箱已省略]').replace(/(?:验证码|verification code|otp)\s*[:：]?\s*\S+/gi, '[验证码已省略]');
export function queue(store) {
    return store.all('application').filter(a => a.mode !== 'demo' && submitted(a)).map(a => ({ application_id: a.id, company: a.company, title: a.title, stage: a.stage,
        evidence: a.submission_evidence ?? 'unverified', last_checked: a.last_observation_at ?? null,
        capability: store.get('capability', a.company, false)?.state ?? 'not_configured',
        available_fallback: 'supervised_browser_observation', attention: a.attention ?? null }));
}
export function metrics(store) {
    const apps = store.all('application').filter(a => a.mode !== 'demo');
    const submittedApps = apps.filter(a => a.submission_evidence === 'portal_observed');
    const reports = apps.filter(a => a.submission_evidence === 'user_reported');
    const interviewed = submittedApps.filter(a => [...(a.ever_stages ?? []), a.stage].some(stage => ['interview', 'offer'].includes(stage)));
    return { selected: apps.length, portal_observed_submitted: submittedApps.length, user_reported_submitted: reports.length,
        unknown: apps.filter(a => a.stage === 'unknown').length, interviewed: interviewed.length,
        interview_rate: submittedApps.length ? interviewed.length / submittedApps.length : null,
        denominator: '有官方门户页面观察支持的申请；排除演练与未核验自述；已记录面试里程碑统计不等于因果效果分析',
        warning: submittedApps.length < 20 ? '样本较少，不据此归因简历优劣。' : null };
}
export function followup(store, a) {
    if (a.operation === 'queue')
        return { applications: queue(store), schedule: store.get('settings', 'schedule', false), notifications: store.all('notification') };
    if (a.operation === 'configure') {
        consent(a.confirmed, a.user_ref);
        try {
            new Intl.DateTimeFormat('en', { timeZone: a.timezone });
        }
        catch {
            assert(false, 'invalid_timezone', '请使用 IANA 时区，例如 Asia/Shanghai。');
        }
        const old = store.get('settings', 'schedule', false);
        if (old && old.timezone === a.timezone && equal(old.times, a.times) && old.include_email === a.include_email && old.include_sms === a.include_sms) return old;
        return store.put('settings', 'schedule', { timezone: a.timezone, times: a.times, scope: 'all_submitted_applications',
            include_portals: true, include_email: a.include_email, include_sms: a.include_sms, read_only: true, silent_when_unchanged: true,
            state: old?.provider_task_id ? 'update_required' : 'planned', provider_task_id: old?.provider_task_id ?? null,
            next: '使用宿主实际提供的调度能力创建或更新同一任务，再绑定真实返回的任务编号；没有调度工具就明确未启用。' });
    }
    if (a.operation === 'bind') {
        assert(a.host_success === true && a.result_ref, 'scheduler_unverified', '未取得宿主成功返回，不能声称任务已启用。');
        const old = store.get('settings', 'schedule');
        return store.put('settings', 'schedule', { ...old, state: 'host_reported_active', provider: a.provider, provider_task_id: a.provider_task_id, result_ref: a.result_ref,
            next_run_at: a.next_run_at ? iso(a.next_run_at) : null, bound_at: now() });
    }
    if (a.operation === 'schedule_status') {
        noSecrets(a.result_ref);
        const old = store.get('settings', 'schedule');
        return store.put('settings', 'schedule', { ...old, state: a.state, result_ref: a.result_ref, checked_at: now() });
    }
    if (a.operation === 'capability')
        return store.put('capability', a.company, { state: a.state, checked_at: now(), note: scrub(a.note) });
    if (a.operation === 'notification') {
        const app = store.get('application', a.application_id);
        const received = a.received_at ? iso(a.received_at) : null;
        const deadline = a.deadline ? iso(a.deadline) : received && a.deadline_hours ? new Date(Date.parse(received) + a.deadline_hours * 3600000).toISOString() : null;
        const key = hash([a.source, a.reference_id, app.id]);
        const entry = { application_id: app.id, source: a.source, sender_label: scrub(a.sender_label), received_at: received,
            normalized_stage: a.stage, deadline, deadline_basis: a.deadline ? 'absolute' : a.deadline_hours ? 'after_received' : 'unspecified',
            deadline_unknown: !!a.deadline_hours && !received, action_required: scrub(a.action_required), reference_id: hash(a.reference_id),
            permission_state: a.permission_state, created_at: now() };
        const previous = store.get('notification', key, false);
        const r = store.put('notification', key, { ...entry, created_at: previous?.created_at ?? entry.created_at });
        return { notification: r, notify: !previous || previous.deadline !== r.deadline || previous.normalized_stage !== r.normalized_stage || previous.action_required !== r.action_required || previous.permission_state !== r.permission_state,
            next: r.deadline_unknown ? '缺少真实收件时间，核验后再计算72小时等相对期限。' : '只提醒，不打开或代做测评，不回复邮件。' };
    }
}
export function interview(store, a) {
    const app = store.get('application', a.application_id);
    if (a.operation === 'context')
        return { application: { id: app.id, company: app.company, title: app.title, stage: app.stage },
            submitted: app.submitted_material, material_known: !!app.submitted_material,
            jd: app.submitted_material?.job ?? app.job_snapshot,
            notice: app.submitted_material ? '依据这份实际投递快照准备；区分预测与招聘方明确通知。' : '实际投递简历未知。可以先按岗位准备，但不得以最新基础简历冒充当时提交版本。',
            previous_reviews: store.all('interview_review').filter(r => r.application_id === app.id) };
    if (a.operation === 'prepare') {
        noSecrets(a.questions);
        return store.put('interview_pack', id('interview'), { application_id: app.id, round: a.round, questions: a.questions,
            material_digest: hash(app.submitted_material ?? null), jd_hash: app.job_snapshot.content_hash, created_at: now(), prediction: true });
    }
    const source = store.get('source', a.source_id);
    assert(source.purposes.includes('interview'), 'scope_violation', '这份资料尚未授权用于面试复盘。');
    assert(source.text, 'transcript_required', '需要实际转写文本；有音频文件不等于已完成转写。');
    const findings = a.findings.map(f => {
        assert(source.text.includes(f.quote), 'quote_not_found', '复盘引用不在原始转写中。');
        noSecrets(f);
        return { ...f, grounding: 'quote_exists_semantics_host_assessed' };
    });
    const proposals = [];
    for (const c of a.memory_candidates ?? []) {
        assert(c.speaker === 'candidate', 'wrong_speaker', '面试官的说法不能变成候选人的经历。');
        assert(source.text.includes(c.quote), 'quote_not_found', '新记忆缺少转写依据。');
        noSecrets(c.value, c.key);
        proposals.push(store.put('proposal', id('proposed'), { key: c.key, value: c.value, purposes: source.purposes.filter(p => ['matching', 'resume', 'form', 'interview'].includes(p)), scope: 'global',
            state: 'proposed', source_id: source.id, source_ref: c.quote, conflicts_with: null }));
    }
    return store.put('interview_review', id('review'), { application_id: app.id, source_id: source.id, findings, proposals: proposals.map(p => p.id), created_at: now() });
}
