import { materialIndex } from './material-index.mjs';
import { agentTasks } from './tasks.mjs';
import { executionCheckpoint } from './execution.mjs';
import { experience } from './experience.mjs';
import { daily, dailySummary, dailyFlow } from './daily.mjs';
import { comparison } from './comparison.mjs';
import { candidateFitContext, saveFitProfile } from './fit-profile.mjs';
import { authenticationContext } from './authentication.mjs';
import { TOOLS } from './catalog.mjs';
import { CONTRACT, VERSION, buildId, validate, Fault, assert, hash } from './core.mjs';
import { coverage, facts, remember, controlProfile, nextQuestion } from './profile.mjs';
import { guidance, finishTurn } from './flow.mjs';
import { saveJobs, assessJobs, shortlist } from './jobs.mjs';
import { materialAction, TEMPLATES } from './materials.mjs';
import { planApplication, authorize, checkpoint, recovery, review, handoff, recordOutcome, applicationContext } from './applications.mjs';
import { followup, interview, metrics, queue } from './followup.mjs';
import { writeProgress } from './progress.mjs';
import { workspace } from './workspace.mjs';
export const handlers = {
    context: (s, a) => {
        if (a.scope === 'daily') return dailySummary(s);
        if (a.scope === 'metrics')
            return { ...metrics(s), execution: s.all('execution_summary'), lightweight: agentTasks(s, { operation: 'metrics' }) };
        if (a.scope === 'application')
            return { ...applicationContext(s, a.application_id), authentication: authenticationContext(s), resume_baseline: s.get('settings','resume_baseline',false), execution_batches: s.all('execution_batch').filter(b => b.application_id === a.application_id).map(b => ({ ...b, recovery_required: ['pending','unknown'].includes(b.state) })) };
        if (a.scope === 'applications')
            return { applications: s.all('application'), queue: queue(s) };
        const active = s.get('settings', 'focus', false);
        const activeId = a.application_id ?? (active?.kind === 'application' ? active.application_id : null);
        return { task: active, current_application: activeId && s.get('application', activeId, false) ? applicationContext(s, activeId) : null, coverage: coverage(s), facts: facts(s, a.scope === 'profile' ? null : 'matching'), fit_context: candidateFitContext(s), proposals: s.all('proposal').filter(p => p.state === 'proposed'),
            question: nextQuestion(s), authentication: authenticationContext(s), applications: s.all('application').map(({ id, company, title, stage, submission_evidence }) => ({ id, company, title, stage, submission_evidence })),
            preferences: s.get('settings', 'preferences', false), schedule: s.get('settings', 'schedule', false), daily: dailySummary(s), templates: TEMPLATES,
            capabilities: { lightweight_tasks: 'host_subagents_required', preferred_worker: 'gpt-5.6-luna', worker_reasoning: 'medium', max_workers: 3, storage: 'available', form_planning: 'available', web_search: 'host_required', browser: 'host_required', figma: 'host_connection_required',
                chatgpt_memory: 'host_tool_or_authorized_export', transcription: 'host_required', email_sms: 'authorized_host_connector_or_manual_read', scheduler: 'host_required', final_submit: 'human_only' },
            recent_handoff: a.session_id ? s.get('turn', a.session_id, false) : null };
    },
    material_index: materialIndex, tasks: agentTasks, experience, daily, comparison, remember, profile: (s,a) => a.operation === 'fit_context' ? saveFitProfile(s,a) : controlProfile(s,a), jobs: (s, a) => a.operation === 'ingest' ? saveJobs(s, a) : assessJobs(s, a), shortlist, material: materialAction,
    plan: planApplication, authorize, checkpoint: (s,a) => a.phase ? executionCheckpoint(s,a) : checkpoint(s,a), recover: recovery, review, handoff, outcome: recordOutcome, followup, interview, workspace, finish: finishTurn
};
export function call(store, name, args = {}) {
    const meta = { contract: CONTRACT, version: VERSION, build: buildId(), workspace_id: store.workspace };
    try {
        const def = TOOLS.find(t => t.name === name);
        assert(def, 'unknown_tool', '不是 Coming Jobs 的工具。', '仅使用 jobos1_ 前缀及 jobos_next 服务器，不调用旧版同名工具。');
        validate(def.inputSchema, args);
        const action = handlers[name.slice('jobos1_'.length)];
        const outsideTransaction = def.annotations.readOnlyHint || (name === 'jobos1_material' && args.operation === 'render');
        const run = () => {
            const data = action(store, args);
            const short = name.slice(7);
            let focus = null;
            if (short === 'jobs')
                focus = 'discover';
            if (short === 'shortlist')
                focus = args.operation === 'choose' ? 'application' : 'shortlist';
            if (['material', 'plan', 'authorize', 'checkpoint', 'recover', 'review', 'handoff', 'outcome'].includes(short))
                focus = 'application';
            if (short === 'followup')
                focus = 'tracking';
            if (short === 'interview')
                focus = 'interview';
            if (short === 'profile' && args.operation === 'recommend')
                focus = 'discover';
            if (focus && !def.annotations.readOnlyHint && !args.background)
                store.put('settings', 'focus', { kind: focus, operation: args.operation ?? short, application_id: args.application_id ?? store.get('settings', 'active', false)?.application_id ?? null });
            return data;
        };
        let data = outsideTransaction ? run() : store.mutate(name, args, run);
        const reportRun = name === 'jobos1_daily' && args.operation === 'report' ? store.get('daily_run', args.run_id, false) : null;
        if ((reportRun?.mode === 'live') || name === 'jobos1_outcome' || (name === 'jobos1_workspace' && args.operation === 'dashboard')) {
            try { data.presentation = writeProgress(store); }
            catch { data.presentation = { status:'unavailable', next:'投递记录已保存；仅重试生成进度页，不重复提交或登记。' }; }
        }
        if (name === 'jobos1_context') {
            const revision = hash(data);
            data = args.since === revision ? { unchanged: true, context_revision: revision } : { ...data, context_revision: revision };
        }
        const independentFlow = name === 'jobos1_comparison' || name === 'jobos1_context' && args.scope === 'profile' || name === 'jobos1_profile' && args.operation === 'fit_context';
        return { ok: true, ...meta, data, flow: independentFlow ? {
            stage:name==='jobos1_comparison'?'公司比较':'候选资料',can_auto_continue:!!data.run||!!data.tasks?.length,
            next:{owner:'agent',action:'independent_assessment',prompt:data.next??'先形成并封存本次独立判断，再读取旧推荐；不创建或操作申请。'}
        } : name === 'jobos1_daily' && args.operation !== 'choose' ? dailyFlow(data) : guidance(store, name === 'jobos1_interview' || name === 'jobos1_followup' ? undefined : args.application_id,
            { background: !!args.background || name === 'jobos1_context' && ['daily', 'metrics'].includes(args.scope) }) };
    }
    catch (error) {
        return { ok: false, ...meta, error: { code: error.code ?? 'local_error', message: error.code ? error.message : '本次本地操作未完成。检查 Node 版本、文件存在性与权限；不重复执行外部动作。',
                next: error.next ?? '保留当前页面和草稿，进行一次针对性诊断。', state_changed: false },
            flow: { stage: '需要处理', can_auto_continue: false, next: { owner: 'agent', action: 'repair_once', prompt: error.next ?? '仅诊断这次错误；无法修复时说明具体缺口和用户下一步。' } } };
    }
}
