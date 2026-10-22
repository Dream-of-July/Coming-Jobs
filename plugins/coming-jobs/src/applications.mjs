import {currentHost} from './host.mjs';
import {sourceValue} from './field-source.mjs';
import { itinerary } from './execution.mjs';
import { fieldDigest, consentScope, coveredFields, authorizationState } from './authorization.mjs';
import { assert, consent, noSecrets, hash, id, now, iso, originOf, portalLocation, equal } from './core.mjs';
import { facts } from './profile.mjs';
import { assertMaterialCurrent, materialApproved } from './materials.mjs';
function applicationOrigin(app, url) {
    const u = new URL(url);
    if (app.mode === 'demo' && u.protocol === 'http:' && u.hostname === '127.0.0.1' && !u.username && !u.password)
        return u.origin;
    return originOf(url);
}
function assertPlanCurrent(store, app, plan) {
    const cv = store.get('material', app.resume_id);
    assertMaterialCurrent(store, cv);
    assert(plan.groups.some(g => g.fields.some(f => f.material?.sha256 === cv.asset.sha256 && f.material?.id === cv.id)), 'stale_plan', '本地简历已变化，先同步计划与门户材料。');
    const current = new Map(facts(store, 'form', `company:${app.company}`).map(f => [f.id, f]));
    for (const f of plan.groups.flatMap(g => g.fields)) {
        if (f.material) store.assetPath(f.material);
        for (const [id, digest] of f.evidence_versions ?? []) assert(current.has(id) && hash(current.get(id).value) === digest, 'fact_changed', '已确认资料发生变化，只更新受影响的字段。');
    }
}
export const FIELD_TYPES = ['free_text', 'portal_select', 'date_picker', 'file_upload', 'url', 'checkbox', 'agreement', 'sensitive_user_owned'];
export function planApplication(store, a) {
    const app = store.get('application', a.application_id);
    assert(app.stage === 'preparing', 'application_locked', '已提交或结果不明的申请只读，不再次填写。');
    const cv = app.resume_id ? store.get('material', app.resume_id, false) : null;
    assert(cv && (materialApproved(store,cv) || cv.render_receipt?.passed), 'resume_review_required', '本次岗位简历尚未审核。', '展示本次实际 PDF，请用户审核一次。');
    store.assetPath(cv.asset);
    assertMaterialCurrent(store, cv);
    const origin = applicationOrigin(app, a.portal_url);
    const fs = new Map(facts(store, 'form', `company:${app.company}`).map(f => [f.id, f]));
    const groups = a.groups.map(g => ({ key: g.key, label: g.label, required: g.required, fields: g.fields.map(f => {
            assert(FIELD_TYPES.includes(f.type), 'invalid_field_type', '不支持的门户字段类型。');
            const humanLabel = /验证码|身份证|护照|背调|法律声明|承诺书|诚信|password|passport|declaration/i.test(f.label) || /隐私|privacy/i.test(f.label) && f.type!=='agreement';
            assert(!humanLabel || f.type === 'sensitive_user_owned', 'manual_field_required', '该字段必须由用户处理，不能当普通字段自动填写。');
            if (f.type === 'sensitive_user_owned')
                return { key: f.key, label: f.label, type: f.type, required: f.required, manual: true };
            assert(f.value !== undefined, 'missing_target', '普通字段必须有明确目标值，不能临场编造。');
            noSecrets(f.value, f.key);
            assert(!f.max_length || typeof f.value !== 'string' || [...f.value].length <= f.max_length, 'field_length_exceeded', '门户长度不足；记录限制并审核压缩差异，禁止静默截断。');
            const evidence = [...(f.evidence_ids ?? [])];
            if(f.source){const fact=fs.get(f.source.fact_id);assert(fact,'unconfirmed_field','source 必须引用当前可用事实。');assert(equal(sourceValue(fact,f.source),f.value),'field_value_mismatch','填写值不等于事实按指定规则转换后的值。');if(!evidence.includes(fact.id))evidence.push(fact.id);}
            f={...f,value_kind:f.source?(f.source.transform==='option_map'?'mapped':f.source.transform&&f.source.transform!=='identity'?'transformed':'exact'):'composed'};
            if(f.type==='agreement'){assert(/^[a-f0-9]{64}$/.test(f.text_hash??'')&&f.agreement_title&&f.excerpt&&f.value===true,'agreement_hash_required','协议必须列明标题、文本哈希、摘录与同意目标。');return {...f,value_kind:'agreement',evidence_ids:[]};}
            assert(evidence.every(e => fs.has(e)), 'unconfirmed_field', '普通字段只能引用已确认、允许填表且范围适用的事实。');
            if (f.type === 'file_upload') {
                const m = store.get('material', String(f.value));
                assert(materialApproved(store,m) || m.render_receipt?.passed, 'material_review_required', '附件没有经过用户审核。');
                store.assetPath(m.asset);
                assert(!f.max_bytes || m.asset.bytes <= f.max_bytes, 'attachment_too_large', '附件超过门户大小限制。');
                assert(!f.allowed_mime_types || f.allowed_mime_types.includes(m.asset.mime_type ?? 'application/pdf'), 'attachment_type', '附件实际类型不符合门户要求。');
                return { ...f, evidence_ids: [], material: { id: m.id, ...m.asset }, local_file: store.uploadPath(m.asset) };
            }
            if (f.content_key) {
                const base = store.get('settings', 'resume_baseline');
                const item = base.items.find(i => i.key === f.content_key);
                assert(item, 'unknown_content', '表单内容引用的简历条目不存在。');
                if (f.variation_id) {
                    const v = store.get('material_variation', f.variation_id);
                    assert(v.material_id === cv.id && v.sha256 === cv.asset.sha256 && v.base_sha256 === base.sha256 && v.company === app.company && v.content_key === f.content_key && v.text === f.value, 'wrong_variation', '文字例外不属于本公司、当前简历或条目。');
                    assert(v.evidence.every(e => fs.has(e.id) && hash(fs.get(e.id).value) === e.digest), 'fact_changed', '公司例外引用的事实已变化。');
                    evidence.push(...v.evidence.map(e => e.id).filter(id => !evidence.includes(id)));
                } else assert(f.value === item.text, 'resume_text_mismatch', '网页默认与已确认简历文字一致；扩写或压缩需要公司专属例外。');
            }
            if (f.material_id && !f.variation_id) {
                const m = store.get('material', f.material_id);
                assert(m.approved && m.id === cv.id, 'wrong_material', '改写文本只能来自本次已审核简历。');
                const texts = [...(m.content?.sections.flatMap(s => s.items.map(i => i.text)) ?? []), ...(store.get('settings', 'resume_baseline', false)?.items.map(i => i.text) ?? [])];
                assert(texts.some(t => t === f.value), 'unconfirmed_field', '改写值不在本次已审核内容中。');
            }
            else
                assert(evidence.length > 0, 'evidence_required', '填写目标缺少事实来源。');
            if (f.type === 'url')
                originOf(String(f.value));
            return { ...f, evidence_ids: evidence, evidence_versions: evidence.map(id => [id, hash(fs.get(id).value)]).sort((a,b) => a[0].localeCompare(b[0])) };
        }) }));
    assert(new Set(groups.map(g => g.key)).size === groups.length, 'duplicate_group', '区域编号重复。');
    const keys = groups.flatMap(g => g.fields.map(f => f.key));
    assert(new Set(keys).size === keys.length, 'duplicate_field', '字段编号重复。');
    assert(groups.some(g => g.fields.some(f => f.type === 'file_upload' && f.material.id === cv.id)), 'resume_missing', '计划必须包含本次实际简历附件。');
    const required = [...new Set([...(a.required_groups ?? []), ...groups.filter(g => g.required).map(g => g.key)])];
    assert(required.every(k => groups.some(g => g.key === k)), 'missing_group', '用户点名的区域没有进入计划。');
    const checklist = a.checklist ?? (app.plan_id ? store.get('plan', app.plan_id).checklist : []) ?? [];
    assert(new Set(checklist.map(x => x.key)).size === checklist.length, 'duplicate_check', '检查项重复。');
    for (const item of checklist) {
        noSecrets(item);
        assert(!item.group_key || groups.some(g => g.key === item.group_key), 'missing_group', '检查项引用的区域不在计划内。');
        assert(item.state === 'pending' || item.observation_ref, 'check_evidence_required', '完成或不适用需要实际核验引用。');
    }
    const content_hash = hash([app.id, a.page_fingerprint, checklist, app.job_snapshot.content_hash, cv.asset.sha256, origin, groups, required]);
    const plan = store.put('plan', content_hash, { application_id: app.id, origin, page_fingerprint: a.page_fingerprint, groups, checklist, required_groups: required, content_hash });
    const same = app.plan_id === plan.id;
    if (!same && app.plan_id) {
        const oldDrafts = store.all('draft').filter(d => d.application_id === app.id && d.plan_id === app.plan_id);
        for (const group of groups) {
            const prior = oldDrafts.find(d => d.group_key === group.key);
            if (!prior) continue;
            const unchanged = group.fields.filter(f => prior.target.some(p => fieldDigest(p) === fieldDigest(f))).map(f => f.key);
            store.put('draft', hash([app.id, plan.id, group.key]), { ...prior, application_id: app.id, plan_id: plan.id, target: group.fields, before: prior.before, observed: prior.observed.filter(f => unchanged.includes(f.key)), passed: false, observed_at: prior.observed_at, needs_reobserve: true });
        }
    }
    store.put('application', app.id, { ...app, plan_id: plan.id, authorization: app.authorization ?? null,
        review: same ? app.review : null, dirty: true, page: portalLocation(a.portal_url, app.mode === 'demo') });
    return { plan, batches: itinerary(plan), authorization_status: authorizationState(app, plan), disclosure: { company: app.company, origin, groups: groups.map(g => g.label), files: groups.flatMap(g => g.fields.filter(f => f.material).map(f => ({ name: f.material.name, sha256: f.material.sha256 }))) },
        execution: '只执行差异区域；新计划覆盖旧计划前已经保留全部版本。' };
}
export function authorize(store, a) {
    const app = store.get('application', a.application_id), plan = store.get('plan', app.plan_id);
    assertPlanCurrent(store, app, plan);
    if (a.reuse) assert(authorizationState(app, plan).content_authorized, 'approval_required', '新增或变化内容需要适用授权；其余区域继续复用。');
    else consent(a.confirmed, a.user_ref);
    assert(app.stage === 'preparing', 'application_locked', '申请不在可填表阶段。');
    assert(plan.content_hash === a.plan_hash && plan.origin === applicationOrigin(app, a.portal_url), 'disclosure_changed', '接收方或资料已变化。', '仅展示变更范围并取得适用授权。');
    const cv = store.get('material', app.resume_id);
    assertMaterialCurrent(store, cv);
    assert(materialApproved(store,cv), 'resume_review_required', '简历未审核。');
    for (const field of plan.groups.flatMap(g => g.fields))
        if (field.material)
            store.assetPath(field.material);
    const grant = { scope_hash: consentScope(app, plan.origin), field_grants: Object.fromEntries(plan.groups.flatMap(g => g.fields).filter(f => !f.manual).map(f => [f.key, fieldDigest(f)])), plan_hash: plan.content_hash, origin: plan.origin, session_id: a.session_id, approved_at: now(), expires_at: new Date(Date.now() + 2 * 3600000).toISOString(), user_ref: a.reuse ? app.authorization.user_ref : a.user_ref };
    if (app.authorization && Date.parse(app.authorization.expires_at) > Date.now())
        assert(app.authorization.session_id === a.session_id, 'writer_busy', '另一个会话正在填写这份申请。', '在原会话完成或明确交接，禁止两个会话同时写同一页面。');
    return store.put('application', app.id, { ...app, authorization: grant, handoff: null });
}
export function verifyField(target, observed) {
    if (target.manual)
        return { ok: true, manual: true };
    if (!observed || observed.read_state === 'unreadable')
        return { ok: false, reason: '未观察到该字段' };
    if (target.type === 'file_upload') {
        const phases = target.attachment_protocol !== 'complete' || observed.file_selected === true && observed.parse_complete === true && observed.attachment_associated === true && observed.portal_saved === true;
        const ok = phases && observed.upload_complete === true && observed.local_sha256 === target.material.sha256 &&
            observed.file_name === target.material.name && observed.file_bytes === target.material.bytes && observed.file_count >= 1 && observed.portal_saved !== false;
        return { ok, reason: ok ? '本地文件选择与上传卡片相符；未声称远端字节哈希验证' : '附件未完成或文件身份不符' };
    }
    if (target.type === 'portal_select') {
        const ok = equal(target.value, observed.value) && observed.selected === true && (!target.option_id || observed.option_id === target.option_id);
        return { ok, reason: ok ? '已选择门户选项' : '显示文本不等于选择成功' };
    }
    const normalize = v => typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : v;
    const ok = equal(normalize(target.value), normalize(observed.value));
    return { ok, reason: ok ? '实际值匹配' : '实际值与目标不一致' };
}
export function checkpoint(store, a) {
    const app = store.get('application', a.application_id), plan = store.get('plan', app.plan_id);
    assert(app.stage === 'preparing', 'application_locked', '此申请只读。');
    assertPlanCurrent(store, app, plan);
    assert(a.plan_hash === plan.content_hash, 'stale_plan', '这是旧版填写计划。');
    assert(app.authorization && app.authorization.session_id === a.session_id && Date.parse(app.authorization.expires_at) > Date.now(), 'approval_required', '缺少本次填写的适用授权。');
    assert(applicationOrigin(app, a.portal_url) === plan.origin, 'origin_changed', '页面已跳转到不同接收方，暂停写入。');
    assert(Date.parse(iso(a.observed_at)) <= Date.now() + 300000, 'future_observation', '回读时间不能在未来。');
    const updated = [];
    for (const group of a.groups) {
        noSecrets(group.before ?? []);
        const target = plan.groups.find(g => g.key === group.key);
        assert(target, 'unknown_group', '该区域不在本次计划内。');
        const allowed = coveredFields(app, plan);
        assert(target.fields.every(f => f.manual || allowed.includes(f.key)), 'approval_required', '此区域有尚未授权的变化，先继续其他已授权区域。');
        group.fields.forEach(f => { assert(target.fields.some(t => t.key === f.key), 'unknown_field', '区域包含未知字段。'); noSecrets(f.value, f.key); });
        const checks = target.fields.map(f => ({ key: f.key, ...verifyField(f, group.fields.find(o => o.key === f.key)) }));
        const key = hash([app.id, plan.id, group.key]);
        const prior = store.get('draft', key, false);
        if (prior)
            store.put('draft_history', id('draft'), prior);
        updated.push(store.put('draft', key, { application_id: app.id, plan_id: plan.id, group_key: group.key,
            before: prior?.before ?? group.before ?? [], target: target.fields, observed: group.fields, checks,
            passed: checks.every(c => c.ok), portal_saved: a.portal_saved ?? null, observed_at: iso(a.observed_at), page_fingerprint: a.page_fingerprint }));
    }
    store.put('application', app.id, { ...app, dirty: true, review: null, page: portalLocation(a.portal_url, app.mode === 'demo') });
    return { groups: updated.map(g => ({ key: g.group_key, passed: g.passed, checks: g.checks })), draft_saved: true,
        next: '继续未完成区域；只修复检查不通过的区域。每回合结束前续上页面保留标记。' };
}
export function recovery(store, a) {
    const app = store.get('application', a.application_id), plan = store.get('plan', app.plan_id);
    const operations = [], conflicts = [], unread = [];
    const seen = new Set(a.fields.map(f => f.key));
    for (const f of plan.groups.flatMap(g => g.fields)) if (!f.manual && !seen.has(f.key)) unread.push(f.key);
    for (const current of a.fields) {
        const target = plan.groups.flatMap(g => g.fields).find(f => f.key === current.key);
        if (!target || target.manual)
            continue;
        if (current.read_state === 'unreadable') { unread.push(current.key); continue; }
        if (verifyField(target, current).ok)
            continue;
        const drafts = store.all('draft').filter(d => d.application_id === app.id && d.plan_id === plan.id);
        const before = drafts.flatMap(d => d.before).find(f => f.key === current.key);
        if (before && before.read_state !== 'unreadable' && equal(before.value, current.value) && (target.type !== 'portal_select' || before.selected === current.selected) && (target.type !== 'file_upload' || equal(before, current)))
            operations.push(target);
        else
            conflicts.push({ key: current.key, reason: '页面值不是原始值，也不是目标值；可能是用户或服务端的新修改。' });
    }
    return { operations, conflicts, unread_fields: unread, overwrite_conflicts: false };
}
export function review(store, a) {
    const app = store.get('application', a.application_id), plan = store.get('plan', app.plan_id);
    assert(applicationOrigin(app, a.portal_url) === plan.origin, 'origin_changed', '接收方变化，不能给出最终审核。');
    assertPlanCurrent(store, app, plan);
    const drafts = store.all('draft').filter(d => d.application_id === app.id && d.plan_id === plan.id);
    const checks = plan.groups.map(g => {
        const d = drafts.find(d => d.group_key === g.key);
        const required = g.required || plan.required_groups.includes(g.key) || g.fields.some(f => f.required && !f.manual);
        const pass = !!d?.passed && (d.portal_saved === true || a.single_submit===true && !!a.persistence_ref && d.portal_saved !== false) && Date.now() - Date.parse(d.observed_at) < 15 * 60000;
        return { key: g.key, label: g.label, required, passed: pass, manual: g.fields.filter(f => f.manual).map(f => f.label) };
    });
    const inventory = (plan.checklist ?? []).map(item => ({ ...item, passed: item.state !== 'pending' && !!item.observation_ref && (!item.group_key || checks.some(g => g.key === item.group_key && g.passed)) }));
    const portfolios = store.all('material').filter(m => m.kind === 'portfolio');
    if (portfolios.length && !plan.groups.some(g => g.fields.some(f => f.type === 'file_upload' && portfolios.some(m => m.id === f.material.id))) && !inventory.some(i => i.key === 'portfolio' && i.passed))
        inventory.push({ key: 'portfolio', label: '作品附件或仅链接入口核验', required: true, passed: false });
    const batches = store.all('execution_batch').filter(b => b.application_id === app.id && b.plan_id === plan.id);
    if (batches.length) for (const spec of itinerary(plan)) if (!batches.some(b => b.number === spec.number && b.state === 'complete')) inventory.push({key: `batch:${spec.number}`, label: '批次回读或附件阶段未完成', required: true, passed: false});
    const controls=a.controls??app.portal_inventory??null;
    if(controls){
        noSecrets(controls);const planned=new Set(plan.groups.flatMap(g=>g.fields).map(f=>f.key));
        for(const c of controls)if(c.required&&!planned.has(c.key))inventory.push({key:c.key,label:c.label??c.key,required:true,passed:false,reason:'unplanned_required_control'});
        for(const c of controls.filter(c=>c.type==='agreement')){const field=plan.groups.flatMap(g=>g.fields).find(f=>f.key===c.key&&f.type==='agreement');if(!field||field.text_hash!==c.text_hash)inventory.push({key:c.key,label:c.label??c.key,required:true,passed:false,reason:'agreement_changed'});}
    } else if(app.apply_batch_id)inventory.push({key:'controls',required:true,passed:false,reason:'inventory_required'});
    const blockers = [...checks, ...inventory].filter(g => g.required && !g.passed);
    const cv = store.get('material', app.resume_id);
    store.assetPath(cv.asset);
    assertMaterialCurrent(store, cv);
    const snapshot = { job: app.job_snapshot, resume: { ...cv }, answers: drafts.map(d => ({ group: d.group_key, fields: d.observed })), plan_hash: plan.content_hash };
    const result = { ready: blockers.length === 0, checks, checklist: inventory, completeness: plan.checklist?.length ? 'recorded_inventory' : 'legacy_inventory_unverified', control_inventory_verified:!!controls,controls:controls??[],persistence_ref:a.persistence_ref??null,single_submit:a.single_submit??false,portal_persistence: drafts.every(d => d.portal_saved === true) && drafts.length ? 'saved_observed' : 'not_verified', blockers, snapshot_hash: hash(snapshot), snapshot, reviewed_at: now(),
        final_submit: 'batch_grant_only', manual_notice: '用户亲自处理声明；逐批审批后，仅 clear_submit 放行的项目可点击一次。Agent 不代做测评。' };
    store.put('application', app.id, { ...app, review: result });
    return { ...result, snapshot: undefined };
}
export function handoff(store, a) {
    if(a.operation==='host_access'){noSecrets(a.result_ref);return store.put('settings','host_access',{state:a.state,host:currentHost().id,result_ref:a.result_ref,checked_at:now()});}
    if(a.operation==='portal'){const u=new URL(a.origin);assert(u.protocol==='https:'&&u.origin===a.origin,'invalid_origin','仅保存纯 HTTPS 来源。');assert(Math.abs(Date.now()-Date.parse(iso(a.observed_at)))<300000,'stale_observation','会话核验需要近期实际观察。');noSecrets(a.observation_ref);return store.put('portal_session',hash([currentHost().id,u.origin]),{host:currentHost().id,origin:u.origin,login_method:a.login_method,last_success_at:iso(a.observed_at),observation_ref:a.observation_ref});}
    const app = store.get('application', a.application_id);
    if (a.operation === 'resolve') {
        consent(a.completed, a.user_ref);
        return store.put('application', app.id, { ...app, handoff: null });
    }
    noSecrets(a.prompt);
    const task = { state: 'open', kind: a.kind, prompt: a.prompt, reply: a.reply ?? '已完成，继续', created_at: now() };
    return store.put('application', app.id, { ...app, handoff: task });
}
const STAGES = ['voided','preparing', 'unknown', 'submitted', 'screening', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'];
export function recordOutcome(store, a) {
    let app;
    if (a.application_id) app = store.get('application', a.application_id);
    else {
        assert(a.company && a.title && a.job_id, 'application_identity_required', '补记投递需要公司、岗位名称和官方岗位编号。');
        assert(a.user_confirmed || (a.source === 'official_portal' && a.observation_ref), 'submission_evidence_required', '补记投递需要用户确认或官方页面观察。');
        noSecrets([a.company, a.title]);
        const matches = store.all('application').filter(x => x.company === a.company && x.job_snapshot?.external_id === a.job_id);
        assert(matches.length <= 1, 'ambiguous_application', '存在多个同岗位记录，请指定申请。');
        app = matches[0] ?? { id: 'observed_' + hash([a.company, a.job_id]).slice(0,24), company:a.company, title:a.title, mode:'live', stage:'unknown', job_id:null,
            job_snapshot:{company:a.company,title:a.title,external_id:a.job_id,content_hash:null,jd:''}, observations:[], submission_evidence:'unverified', created_at:now() };
    }
    assert(app.stage!=='voided','application_voided','已作废的申请不能补写为已投递。');
    const attempt=app.submit_attempt_id?store.get('submit_attempt',app.submit_attempt_id,false):null;
    if(!a.actual_resume_sha256&&attempt)a={...a,actual_resume_sha256:attempt.actual_resume_sha256};
    if (a.user_confirmed)
        consent(true, a.user_ref);
    assert(STAGES.includes(a.stage) && a.stage !== 'preparing', 'invalid_stage', '无效招聘阶段。');
    noSecrets(a.raw_stage ?? '');
    const at = iso(a.observed_at);
    assert(Date.parse(at) <= Date.now() + 300000, 'future_observation', '观察时间不能在未来。');
    const proof = a.source === 'official_portal' && a.observation_ref && a.job_id === app.job_snapshot.external_id;
    assert(a.source !== 'official_portal' || proof, 'job_evidence_missing', '官方页面观察必须匹配当前职位 ID 并带可追溯引用。');
    const observation = { source: a.source, stage: a.stage, raw_stage: a.raw_stage ?? a.stage, observed_at: at,
        reference: a.observation_ref ?? null, user_confirmed: !!a.user_confirmed, provider_verified: false, job_id: a.job_id ?? null };
    const eventId = hash([app.id, observation]);
    store.put('observation', eventId, { application_id: app.id, ...observation });
    const previous = app.last_observation_at ? Date.parse(app.last_observation_at) : 0;
    const terminal = ['rejected', 'withdrawn'].includes(app.stage);
    const regresses = STAGES.indexOf(a.stage) < STAGES.indexOf(app.stage) && app.stage !== 'unknown';
    const conflict = Date.parse(at) >= previous && (terminal && a.stage !== app.stage || regresses);
    const canUpdate = Date.parse(at) >= previous && !conflict;
    let submitted = app.submitted_material ?? null;
    if (!submitted && a.actual_resume_sha256) {
        const m = attempt?.resume?.asset?.sha256===a.actual_resume_sha256?attempt.resume:store.all('material').find(m => m.asset?.sha256 === a.actual_resume_sha256);
        assert(m && m.approved, 'unknown_material', '找不到已审核的实际提交文件。');
        assert(a.user_confirmed || proof, 'material_evidence', '实际提交版本需要用户确认或页面观察。');
        submitted = { resume: { ...m }, job: { ...app.job_snapshot }, actual_resume_sha256:a.actual_resume_sha256, answers: attempt?.review_snapshot?.answers??app.review?.snapshot?.answers ?? [], observed_at: at, evidence_mode: a.source };
    }
    const updated = store.put('application', app.id, { ...app,
        stage: canUpdate ? a.stage : app.stage, ever_stages: canUpdate ? [...new Set([...(app.ever_stages ?? []), a.stage])] : app.ever_stages ?? [], last_observation_at: canUpdate ? at : app.last_observation_at,
        submission_evidence: proof && a.stage !== 'unknown' ? 'portal_observed' : (app.submission_evidence === 'portal_observed' ? 'portal_observed' : a.user_confirmed ? 'user_reported' : app.submission_evidence ?? 'unverified'),
        provider_verified: false, actual_resume_sha256:submitted?.resume?.asset?.sha256??app.actual_resume_sha256??null, submitted_material: submitted, dirty: canUpdate ? false : app.dirty, handoff: null,
        observations: [...new Set([...(app.observations ?? []), eventId])], attention: conflict ? 'evidence_conflict' : app.attention ?? null });
    if(attempt)store.put('submit_attempt',attempt.id,{...attempt,state:a.stage==='unknown'?'unknown':'recorded',outcome_ref:a.observation_ref??a.user_ref??null});
    if(app.apply_batch_id){const batch=store.get('apply_batch',app.apply_batch_id,false),grant=batch?.grant_id?store.get('apply_grant',batch.grant_id,false):null;if(grant?.items.every(i=>!['preparing','unknown'].includes(store.get('application',i.application_id).stage))){store.put('apply_batch',batch.id,{...batch,state:'complete',completed_at:now()});store.put('settings','active_apply_batch',{batch_id:null});}}
    return { application: updated, conflict, verified_by_provider: false, next: '已记录外部观察，不要求内部 checkpoint；后续只读跟踪，不再次投递。' };
}
export function applicationContext(store, id) {
    const app = store.get('application', id);
    const plan = app.plan_id ? store.get('plan', app.plan_id) : null;
    const drafts = store.all('draft').filter(d => d.application_id === id && d.plan_id === app.plan_id);
    return { application: app, plan, authorization_status: plan ? authorizationState(app, plan) : null,
        resume_sync: { local: app.resume_id ? store.get('material', app.resume_id).asset?.sha256 ?? null : null, portal: drafts.flatMap(d => d.observed).filter(f => f.upload_complete).map(f => ({ key: f.key, file_name: f.file_name, local_sha256: f.local_sha256 })), form: drafts.map(d => ({ group: d.group_key, verified: d.passed, portal_saved: d.portal_saved ?? null })) },
        pending_groups: plan?.groups.filter(g => !drafts.some(d => d.group_key === g.key && d.passed)).map(g => ({ key: g.key, label: g.label })) ?? [],
        drafts,
        facts: facts(store, 'form', `company:${app.company}`), materials: store.all('material').filter(m => m.job_id === app.job_id || ['portfolio', 'photo'].includes(m.kind)).map(m => ({ ...m, upload_path: m.asset ? store.uploadPath(m.asset, { materialize: false }) : null })) };
}
