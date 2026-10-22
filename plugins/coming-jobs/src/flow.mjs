import {batchGuidance} from './apply-batch.mjs';
import { authorizationState } from './authorization.mjs';
import { coverage, nextQuestion, facts } from './profile.mjs';
import { now, hash } from './core.mjs';
import { authenticationContext } from './authentication.mjs';
const next = (owner, action, prompt, reply = null) => ({ owner, action, prompt, reply });
export function guidance(store, applicationId, { background = false } = {}) {
    const batchFlow=batchGuidance(store,background);if(batchFlow)return batchFlow;
    const focus = store.get('settings', 'focus', false);
    if (!applicationId && focus?.kind === 'shortlist') {
        const batch = store.all('batch').at(-1);
        if (batch?.discovery?.needs_more)
            return { stage: '继续发现岗位', next: next('agent', 'discover', `继续在${batch.companies?.join('、') || '已授权'}范围读取完整JD；已找到${batch.items.length}个，目标至少${batch.discovery.target_count}个，逐岗给出推荐度、理由和风险。`), can_auto_continue: true };
        if (batch?.items.length)
            return { stage: '选择岗位', next: next('user', 'choose', '从这批推荐中选择要投的编号，例如“投第1、3个”。编号已固定。', '投第 1 个'), can_auto_continue: false };
    }
    if (!applicationId && focus?.kind === 'discover' && (coverage(store).ready || store.all('fact').some(f => f.key === 'intent.current_company' && f.state === 'confirmed')))
        return { stage: '发现岗位', next: next('agent', 'discover', '继续读取当前目标的完整JD，按个人证据发现至少十个相关岗位，逐岗提供推荐度、理由与潜在风险；不足时继续查找或明确限制；无需用户提供每个岗位链接。'), can_auto_continue: true };
    if (!applicationId && focus?.kind === 'interview') {
        const review = store.all('interview_review').at(-1);
        const pending = (review?.proposals ?? []).map(key => store.get('proposal', key, false)).find(p => p?.state === 'proposed');
        if (pending)
            return { stage: '核对面试新信息', next: next('user', 'confirm_fact', `本次复盘已保存。下一步只核对一个新信息主题：${pending.key}；未确认前不会写进简历。`), can_auto_continue: false };
        return { stage: '面试准备与复盘', next: next('user', 'practice', '先用本次问题清单练习一个回答，或上传授权的面试转写继续复盘。', '开始练习第一题'), can_auto_continue: false };
    }
    if (!applicationId && focus?.kind === 'tracking') {
        const notice = store.all('notification').at(-1);
        const options = [next('user', 'discover', '继续投递其他公司', '继续找岗位'), next('user', 'track', '查看全部申请与截止时间', '查看全部进度'),
            next('user', 'assessment', '自行安排测评，完成后更新记录', '更新测评进度')];
        return { stage: '投递跟进', options,
            next: next('user', 'choose_direction', '可继续投递其他公司、查看全部进度，或自行安排测评。测评只提醒截止时间，不阻塞其他投递。', '继续找岗位／查看全部进度／更新测评进度'),
            reminders: notice?.normalized_stage === 'assessment' ? [{ kind: 'assessment', deadline: notice.deadline ?? null, owner: 'user' }] : [], can_auto_continue: false };
    }
    const apps = store.all('application').filter(a=>a.stage!=='voided');
    let activeId = applicationId ?? store.get('settings', 'active', false)?.application_id;
    if(activeId&&store.get('application',activeId,false)?.stage==='voided')activeId=null;
    const app = activeId ? store.get('application', activeId, false) : apps.find(a => !['submitted', 'assessment', 'screening', 'interview', 'offer', 'rejected', 'withdrawn','voided'].includes(a.stage));
    if (app) {
        if (app.handoff?.state === 'open' && app.handoff.kind === 'login' && !background && authenticationContext(store).preferred_channels.length)
            return { stage: '继续招聘登录', application_id: app.id,
                next: next('agent', 'authenticate', '先读取当前登录页并核对已有授权及只读连接器状态；优先邮箱，邮箱不可用时用获准短信。验证码仅在内存临时匹配并填写，实际登录成功后才解除交接。缺读取能力、未收到本次验证码或有协议/图形验证时保存具体缺口，使用对应人工交接，不重复请求验证码。'), can_auto_continue: true };
        if (app.handoff?.state === 'open')
            return { stage: '等待你的操作', application_id: app.id,
                next: next('user', app.handoff.kind, app.handoff.prompt, app.handoff.reply ?? '已完成，继续'), can_auto_continue: false };
        if (['submitted', 'assessment', 'screening', 'interview', 'offer', 'rejected', 'withdrawn','voided'].includes(app.stage)) {
            const waiting = apps.find(a => a.id !== app.id && a.stage === 'preparing');
            if (waiting)
                return guidance(store, waiting.id, { background });
            return { stage: '投递跟进', application_id: app.id,
                next: next('user', app.stage === 'interview' ? 'interview' : 'track', app.stage === 'interview' ? '准备本次面试，使用当时实际投递的简历和岗位信息。' : '本次投递记录已保存。下一步查看全部申请的进展与待办。', app.stage === 'interview' ? '准备这场面试' : '查看全部进度'), can_auto_continue: false };
        }
        if (app.stage === 'unknown')
            return { stage: '结果待核验', application_id: app.id,
                next: next('agent', 'verify_outcome', '只读检查官方应聘记录；不要再次点击提交。'), can_auto_continue: true };
        const material = app.resume_id ? store.get('material', app.resume_id, false) : null;
        if (!material)
            return { stage: '准备材料', application_id: app.id, next: next('agent', 'prepare_materials', '按本次 JD 准备简历和全部投递内容；不要重新询问已确认资料。'), can_auto_continue: true };
        if (!material.approved)
            return { stage: '审核简历', application_id: app.id, next: next('user', 'approve_resume', '请查看这份岗位简历。确认内容后回复“简历确认”；也可以直接指出要改的地方。', '简历确认'), can_auto_continue: false };
        const plan = app.plan_id ? store.get('plan', app.plan_id, false) : null;
        if (!plan)
            return { stage: '观察表单', application_id: app.id, next: next('agent', 'observe_form', '复用当前浏览器页面，观察全部区域后一次准备填写计划。需要登录时先按已有只读授权尝试邮箱或短信；缺权限、连接器不可读或必要人工动作时才交接。'), can_auto_continue: true };
        if (!plan.groups.some(g => g.fields.some(f => f.material?.id === material.id && f.material.sha256 === material.asset?.sha256)))
            return { stage: '同步材料', application_id: app.id, next: next('agent', 'update_plan', '本地简历已更新，先同步填写计划、门户附件与相关文案。'), can_auto_continue: true };
        const currentFacts = new Map(facts(store, 'form', `company:${app.company}`).map(f => [f.id, hash(f.value)]));
        if (plan.groups.some(g => g.fields.some(f => (f.evidence_versions ?? []).some(([id,digest]) => currentFacts.get(id) !== digest))))
            return { stage: '同步资料', application_id: app.id, next: next('agent', 'update_plan', '已确认资料变化，只更新受影响文案和计划后回读。'), can_auto_continue: true };
        const auth = authorizationState(app, plan);
        const drafts = store.all('draft').filter(d => d.application_id === app.id && d.plan_id === plan.id);
        if (!auth.content_authorized && !plan.groups.some(g => g.fields.some(f => !f.manual) && g.fields.every(f => f.manual || auth.covered_fields.includes(f.key)) && !drafts.some(d => d.group_key === g.key && d.passed)))
            return { stage: '授权预填', application_id: app.id, next: next('user', 'authorize_prefill', '审核本次接收方、普通资料与附件；确认后将按区域连续填写，最终提交仍由你完成。', '授权填写这些资料'), can_auto_continue: false };
        if (auth.content_authorized && !auth.lease_active)
            return { stage: '恢复填写', application_id: app.id, next: next('agent', 'renew_lease', '重新观察页面，使用 authorize(reuse=true) 续上执行占用；已有内容授权不重复询问。'), can_auto_continue: true };
        if (app.review?.ready && Date.now() - Date.parse(app.review.reviewed_at) < 15 * 60000)
            return { stage: '最终审核', application_id: app.id, next: next('user', 'human_submit', '请在保持打开的官方页面检查资料，亲自处理声明并提交。完成后回复“已提交”，我再只读核验结果。', '已提交'), can_auto_continue: false };
        return { stage: '填写与检查', application_id: app.id, next: next('agent', 'fill_groups', auth.missing_fields.length ? '先完成已授权且未完成的区域；只对变化内容核对授权，不重问整份资料。' : '按待处理区域执行差异填写、保存草稿并回读真实值；仅修复有问题的区域。'), can_auto_continue: true };
    }
    if (!store.all('fact').length && !store.all('source').length)
        return { stage: '开始了解你', next: next('user', 'provide_source', '先上传一份现有简历；没有简历也没关系，直接告诉我这次想找哪类工作即可。'), can_auto_continue: false };
    const c = coverage(store), settings = store.get('settings', 'interview', false) ?? {};
    const pending = store.all('proposal').filter(p => p.state === 'proposed');
    if (pending.length)
        return { stage: '核对资料', next: next('user', 'confirm_fact', `先核对一个主题：${pending[0].key}。其余内容已保存，不需要一次处理全部。`), can_auto_continue: false };
    if (c.paused)
        return { stage: '已暂停', next: next('user', 'resume', '进度已经保存。回复“继续建档”可从上次问题恢复。', '继续建档'), can_auto_continue: false };
    if (!c.ready)
        return { stage: '建立画像', coverage: c, next: next('user', 'answer', nextQuestion(store).prompt), can_auto_continue: false };
    if (!settings.finished)
        return { stage: '画像已可用', coverage: c, next: next('user', 'depth_choice', '基础资料足够开始推荐。继续深入项目，还是先看适合的岗位？', '先看推荐'), can_auto_continue: false };
    const daily = store.all('batch').at(-1);
    if (daily?.items.length)
        return { stage: '选择岗位', next: next('user', 'choose', '请从这批推荐中选择要投的编号，例如“投第 1、3 个”。也可以收藏或暂缓。', '投第 1 个'), can_auto_continue: false };
    return { stage: '发现岗位', next: next('agent', 'discover', '用当前宿主检索官方与授权招聘平台，核验完整 JD，再按证据发现至少十个相关岗位，逐岗提供推荐度、理由与潜在风险；不足时明确说明；不要求全站同步。'), can_auto_continue: true };
}
export function finishTurn(store, a) {
    const batches = store.all('execution_batch').filter(b => b.application_id === a.application_id);
    if (a.application_id && batches.length) store.put('execution_summary', a.application_id, {
        application_id: a.application_id, batch_count: batches.length,
        complete: batches.filter(b => b.state === 'complete').length,
        unresolved: batches.filter(b => b.state !== 'complete').map(b => b.number),
        metrics: Object.fromEntries(['agent_ms','tool_ms','human_wait_ms','cua_calls','full_snapshots'].map(k => [k, batches.every(b => b.metrics?.[k] !== undefined) ? batches.reduce((sum,b) => sum + b.metrics[k],0) : null])),
        evidence: 'host_reported', real_improvement_claim: false
    });
    const focus = store.get('settings', 'focus', false);
    const g = guidance(store, focus && focus.kind !== 'application' ? undefined : a.application_id);
    const custom = a.blocker ? { ...g, next: next('user', 'resolve_blocker', a.blocker, a.reply ?? '已处理，继续'), can_auto_continue: false } : g;
    const effective = !a.blocker && a.reply ? { ...custom, next: { ...custom.next, reply: a.reply } } : custom;
    const text = a.reason === 'paused' ? '已保存当前进度。\n下一步：回来后回复“继续”，从这里恢复。' :
        `${a.completed}\n下一步：${effective.next.prompt}${effective.next.reply ? `\n你可以直接回复：“${effective.next.reply}”。` : ''}`;
    const record = { session_id: a.session_id, turn_id: a.turn_id, completed: a.completed, reason: a.reason,
        guidance: effective, text, browser_preserved: a.browser_preserved ?? false, created_at: now() };
    store.put('turn', a.session_id, record);
    return { ...record, should_continue: !['paused', 'blocked', 'budget'].includes(a.reason) && custom.can_auto_continue,
        warning: custom.can_auto_continue && a.reason === 'need_user' ? '这一阶段无需用户决定，请继续执行，而不是问“是否继续”。' : null };
}
