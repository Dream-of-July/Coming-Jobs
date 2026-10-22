import {currentHost} from './host.mjs';
import {claudeProcedure} from './hosts/claude-procedure.mjs';
import { experience } from './experience.mjs';
import { assert, hash, now, noSecrets, equal, iso } from './core.mjs';
import { coveredFields } from './authorization.mjs';
import { assertMaterialCurrent } from './materials.mjs';
import { verifyField, checkpoint } from './applications.mjs';

export function itinerary(plan) {
    const batches = [];
    for (const group of plan.groups) {
        let fields = [];
        const flush = () => { if (fields.length) batches.push({ group_key: group.key, field_keys: fields, kind: 'ordinary' }); fields = []; };
        for (const f of group.fields.filter(f => !f.manual)) {
            if (['free_text', 'url', 'checkbox', 'agreement'].includes(f.type)) { fields.push(f.key); if (fields.length === 8) flush(); }
            else { flush(); batches.push({ group_key: group.key, field_keys: [f.key], kind: f.type }); }
        }
        flush();
    }
    // Parsing must settle before editing fields it may overwrite.
    batches.sort((a,b) => Number(b.kind === 'file_upload') - Number(a.kind === 'file_upload'));
    return batches.map((b,i) => ({ ...b, number: i + 1, depends_on: i ? [i] : [] }));
}
export function executionCheckpoint(store, a) {
    const app = store.get('application', a.application_id), plan = store.get('plan', app.plan_id);
    assert(app.stage === 'preparing' && plan.content_hash === a.plan_hash, 'stale_plan', '只执行当前准备中的计划。');
    assertMaterialCurrent(store, store.get('material', app.resume_id));
    assert(new URL(a.portal_url).origin === plan.origin && a.page_fingerprint === plan.page_fingerprint, 'page_changed', '接收方或页面结构变化，重新只读观察。');
    assert(Math.abs(Date.now() - Date.parse(iso(a.observed_at))) < 300000, 'stale_observation', '批次操作需要五分钟内的实际页面回读。');
    const grant = app.authorization;
    assert(grant?.session_id === a.session_id && Date.parse(grant.expires_at) > Date.now(), 'approval_required', '缺少有效的当前会话授权。');
    const specs = itinerary(plan), spec = specs.find(b => b.number === a.batch_number);
    assert(spec, 'unknown_batch', '批次不属于当前计划。');
    const key = hash([app.id, plan.id, spec.number]);
    const prior = store.get('execution_batch', key, false);
    const persistence={single_submit:a.single_submit??prior?.persistence?.single_submit??false,persistence_ref:a.persistence_ref??prior?.persistence?.persistence_ref??null};
    if(persistence.single_submit){assert(persistence.persistence_ref&&a.portal_saved!==false,'persistence_evidence_required','单次提交门户必须有实际页面证据，不能声称暂存已完成。');noSecrets(persistence.persistence_ref);}
    const targets = plan.groups.flatMap(g => g.fields).filter(f => spec.field_keys.includes(f.key)).map(f => f.type === 'file_upload' ? { ...f, attachment_protocol: 'complete' } : f);
    const allowed = coveredFields(app, plan);
    assert(targets.every(f => allowed.includes(f.key)), 'approval_required', '批次包含未授权字段。');
    noSecrets(a.groups);
    const observations = a.groups.flatMap(g => g.fields);
    assert(new Set(observations.map(o => o.key)).size === observations.length && observations.every(o => spec.field_keys.includes(o.key)), 'wrong_batch', '回读必须属于本批次，不能重复。');
    if (a.phase === 'prepare') {
        assert(!prior || prior.state === 'recovered', 'recovery_required', '批次已经执行或结果未知；先回读，禁止盲目重放。');
        assert(spec.depends_on.every(n => store.get('execution_batch', hash([app.id,plan.id,n]), false)?.state === 'complete'), 'dependency_pending', '先完成前置批次和附件解析核验。');
        assert(observations.length === targets.length && observations.every(o => o.read_state === 'known'), 'before_required', '执行前必须逐字段读取原值。');
        let protectedFields = [];
        if (spec.kind === 'file_upload') {
            const ordinary = plan.groups.flatMap(g => g.fields).filter(f => !f.manual && f.type !== 'file_upload');
            protectedFields = a.protected_fields ?? [];
            assert(ordinary.every(f => protectedFields.some(o => o.key === f.key && o.read_state === 'known')), 'parse_snapshot_required', '上传前先读取可能被解析覆盖的全部普通字段。');
            assert(protectedFields.every(o => ordinary.some(f => f.key === o.key)||(a.controls??[]).some(c=>c.key===o.key&&!/password|captcha|otp|sensitive/i.test(c.type))), 'unknown_field', '保护快照含未知或敏感字段。');
            noSecrets(protectedFields);
            const populated = protectedFields.filter(o => o.value !== '' && o.value !== undefined && o.value !== false).map(o => o.key);
            const upload = targets[0];
            if (populated.length && upload.attachment_mode !== 'attachment_only') assert(upload.restore_confirmed === true && upload.restore_ref && populated.every(k => upload.restore_keys?.includes(k)), 'parse_restore_scope_required', '解析可能覆盖现有资料；先核对确切恢复范围或使用已核验的不解析入口。');
        }
        if (prior) assert(observations.every(o => prior.retry_keys.includes(o.key) || verifyField(targets.find(f => f.key === o.key), o).ok), 'user_conflict', '恢复时存在未知修改。');
        const record=store.put('execution_batch', key, { application_id: app.id, plan_id: plan.id, number: spec.number, state: 'pending', protected_fields: protectedFields, before: observations, targets, grant,persistence, host_version: a.host_version ?? null, started_at: now(), observations: [], control_inventory:a.controls??null, scope: { origin: plan.origin, fingerprint: plan.page_fingerprint }, host_action: '执行已持久化批次；异常也返回逐字段回读。通道丢失时先 recover。' });
        return currentHost().id==='claude'?{...record,claude_procedure:claudeProcedure(plan,spec)}:record;
    }
    assert(prior, 'prepare_required', '执行之前必须先持久化批次。');
    if(spec.kind==='file_upload'&&['recover','complete'].includes(a.phase)){
        const controls=a.controls;assert(controls?.length,'control_inventory_required','上传后提交实际控件清单。');noSecrets(controls);
        const after=a.protected_fields??[],before=prior.protected_fields??[];noSecrets(after);
        assert(before.every(b=>after.some(o=>o.key===b.key&&o.read_state==='known')),'parse_readback_required','上传解析后必须回读全部受保护字段。');
        const changes=after.filter(o=>{const b=before.find(b=>b.key===o.key);return !b||!equal(b.value,o.value)||b.selected!==o.selected;}).map(o=>({...o,kind:plan.groups.some(g=>g.fields.some(f=>f.key===o.key))?'planned_changed':'portal_parsed'}));
        for(const d of store.all('draft').filter(d=>d.application_id===app.id&&d.plan_id===plan.id))if(changes.some(c=>d.target.some(f=>f.key===c.key)))store.put('draft',d.id,{...d,passed:false,needs_reobserve:true});
        store.put('application',app.id,{...store.get('application',app.id),portal_inventory:controls,portal_inventory_observed_at:iso(a.observed_at),parse_changes:changes,parse_compared_at:now()});
    }
    if (a.phase === 'recover') {
        assert(observations.length === targets.length && observations.every(o => o.read_state === 'known'), 'readback_required', '先完整只读回读本批次。');
        const retry = [], conflicts = [];
        for (const f of targets) {
            const current = observations.find(o => o.key === f.key);
            if (verifyField(f,current,persistence).ok) continue;
            if (equal(current, prior.before.find(o => o.key === f.key))) retry.push(f.key);
            else conflicts.push(f.key);
        }
        if (!conflicts.length && !retry.length) {
            const completed=store.all('execution_batch').filter(b=>b.application_id===app.id&&b.plan_id===plan.id&&b.number!==spec.number&&b.state==='complete');
            const accumulated = [...completed.flatMap(b => b.observations), ...observations];
            const oldest=new Date(Math.min(Date.parse(a.observed_at),...completed.filter(b=>specs.find(s=>s.number===b.number)?.group_key===spec.group_key).map(b=>Date.parse(b.observed_at??b.ended_at??b.started_at)))).toISOString();
            const group = plan.groups.find(g => g.key === spec.group_key);
            checkpoint(store, { ...a,...persistence,observed_at:oldest, groups: [{ key: group.key, before: prior.before, fields: accumulated.filter(o => group.fields.some(f => f.key === o.key)) }] });
        }
        return store.put('execution_batch', key, { ...prior, state: conflicts.length ? 'conflict' : retry.length ? 'recovered' : 'complete', observations,observed_at:iso(a.observed_at), retry_keys: retry, conflicts });
    }
    assert(a.phase === 'complete', 'invalid_phase', '批次阶段无效。');
    assert(prior.state === 'pending', 'recovery_required', '该批次不在待回执状态，不能覆盖已有结果。');
    const checks = targets.map(f => ({ key: f.key, ...verifyField(f, observations.find(o => o.key === f.key),persistence) }));
    if (checks.every(c => c.ok) && prior.host_version && app.mode !== 'demo') {
        experience(store, { operation: 'register', scope: { company: app.company, origin: plan.origin, stage: spec.kind === 'file_upload' ? 'attachment' : spec.kind === 'portal_select' ? 'education' : 'experience', structure: /^[a-f0-9]{64}$/.test(plan.page_fingerprint) ? plan.page_fingerprint : hash(plan.page_fingerprint), host_version: prior.host_version }, strategy: spec.kind === 'file_upload' ? 'upload_then_parse_then_edit' : spec.kind === 'portal_select' ? 'school_exact_option' : spec.kind === 'date_picker' ? 'date_dependency_order' : 'semantic_fields' });
    }
    const completed=store.all('execution_batch').filter(b=>b.application_id===app.id&&b.plan_id===plan.id&&b.number!==spec.number&&b.state==='complete');
    const accumulated = [...completed.flatMap(b => b.observations), ...observations];
    const oldest=new Date(Math.min(Date.parse(a.observed_at),...completed.filter(b=>specs.find(s=>s.number===b.number)?.group_key===spec.group_key).map(b=>Date.parse(b.observed_at??b.ended_at??b.started_at)))).toISOString();
    const group = plan.groups.find(g => g.key === spec.group_key);
    checkpoint(store, { ...a,...persistence,observed_at:oldest, groups: [{ key: group.key, before: prior.before, fields: accumulated.filter(o => group.fields.some(f => f.key === o.key)) }] });
    return store.put('execution_batch', key, { ...prior, observations,observed_at:iso(a.observed_at), checks, state: checks.every(c => c.ok) ? 'complete' : 'unknown', ended_at: now(), metrics: a.metrics ?? null });
}
