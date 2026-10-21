import { MATERIAL_INDEX_SCHEMA } from './material-index.mjs';
import { tasksSchema } from './tasks.mjs';
import { dailySchema } from './daily-schema.mjs';
import { comparisonSchema } from './comparison-schema.mjs';
import { fitAssessmentFields, structuredJobFields } from './fit-assessment.mjs';
import { EVIDENCE_LEVEL, fitProfileFields } from './fit-profile.mjs';
import { HOST_POLICY } from './policy.mjs';
import { S, B, I, E, A, O, V, OP } from './core.mjs';
const APPROVAL = { confirmed: B, user_ref: S(1000) };
const PURPOSE = A(E('matching', 'resume', 'form', 'interview', 'tracking'), 5);
const FACT = O({ key: S(150), value: V, purposes: PURPOSE, scope: S(200), expires_at: S(80), sensitive_opt_in: B, evidence_level: EVIDENCE_LEVEL }, ['key', 'value']);
const REQUIREMENT = O({ id: S(100), text: S(3000), kind: E('requirement', 'responsibility', 'preferred') }, ['id', 'text', 'kind']);
const JOB = O({ company: S(150), title: S(200), url: S(3000), jd: S(100000), track: E('campus', 'internship', 'experienced'), campaign: S(300),
    external_id: S(200), observed_at: S(80), source: E('official', 'verified_platform', 'platform'), requirements: A(REQUIREMENT, 60),
    locations: A(S(100), 30), state: E('open', 'closed'), deadline: S(80), mode: E('live', 'demo'), parent_application_id: S(200), ...structuredJobFields }, ['company', 'title', 'url', 'jd', 'track', 'observed_at', 'source', 'mode']);
const MAPPING = O({ requirement_id: S(100), relation: E('direct', 'transferable', 'gap', 'unknown'), evidence_ids: A(S(100), 30), reason: S(2000) });
const ASSESSMENT = O({ job_id: S(100), job_hash: S(64), mappings: A(MAPPING, 60), eligibility: E('pass', 'unknown', 'fail'),
    advantages: A(S(1000), 8), gaps: A(S(1000), 8), reason: S(2000), ...fitAssessmentFields }, ['job_id', 'job_hash', 'mappings', 'eligibility', 'advantages', 'gaps', 'reason']);
const LOCATOR = O({ kind: E('label', 'role', 'placeholder', 'testid', 'css'), value: S(500), name: S(500) }, ['kind', 'value']);
const CHECK = O({ key: S(150), label: S(200), group_key: S(100), required: B, state: E('pending', 'verified', 'not_applicable'), observation_ref: S(1000) }, ['key', 'label', 'required', 'state']);
const ENTRY_LIST = O({ source_url: S(3000), track: E('campus', 'internship', 'experienced'), campaign: S(300), external_ids: A(S(200), 100000), complete: B, observed_at: S(80), total: I(0, 100000) }, ['source_url', 'external_ids', 'complete', 'observed_at']);
const COLLECTION = O({ company: S(150), track: E('campus', 'internship', 'experienced'), campaign: S(300), source_url: S(3000), observed_at: S(80), total: I(0, 100000), external_ids: A(S(200), 100000), pages_read: I(0, 10000), has_more: B, complete: B,
    entries: A(ENTRY_LIST, 100), live_entries: A(ENTRY_LIST, 100), live_checked_at: S(80) }, ['company', 'track', 'source_url', 'observed_at', 'total', 'external_ids', 'pages_read', 'has_more', 'complete']);
const FIELD = O({ key: S(150), label: S(200), type: E('free_text', 'portal_select', 'date_picker', 'file_upload', 'url', 'checkbox', 'sensitive_user_owned'),
    required: B, attachment_mode: E('parse', 'attachment_only'), restore_keys: A(S(150),1000), restore_confirmed: B, restore_ref: S(1000), content_key: S(100), variation_id: S(100), max_bytes: I(1, 100000000), allowed_mime_types: A(E('application/pdf', 'image/png', 'image/jpeg'), 3), attachment_protocol: E('complete'), max_length: I(1, 40000), value: V, evidence_ids: A(S(100), 30), material_id: S(100), option_id: S(200), locator: LOCATOR, selected_locator: LOCATOR }, ['key', 'label', 'type', 'required']);
const OBSERVED_VALUE = { oneOf: [{ type: 'string', maxLength: 40000 }, B, { type: 'number' }, A({ type: 'string', maxLength: 4000 }, 100)] };
const OBSERVED = O({ key: S(150), value: OBSERVED_VALUE, selected: B, option_id: {type:'string', maxLength:200}, upload_complete: B, local_sha256: S(64), file_name: {type:'string', maxLength:300}, file_bytes: I(0, 100000000), file_count: I(0, 100), read_state: E('known', 'unreadable'), portal_saved: B, file_selected: B, parse_complete: B, attachment_associated: B }, ['key']);
const GROUP = O({ key: S(100), label: S(200), required: B, fields: A(FIELD, 100) });
const CONTENT = O({ name: S(150), headline: S(300), contact: S(1000), links: A(O({ label: S(100), url: S(3000) }), 10),
    sections: A(O({ title: S(150), items: A(O({ text: S(10000), evidence_ids: A(S(100), 50) }), 30) }), 12) }, ['name', 'headline', 'sections']);
const PREF = O({ template: E('classic', 'projects', 'clean'), figma: S(3000), figma_node: S(100), timezone: S(100), company_order: A(S(100), 50), referral_source: S(3000) }, []);
const definitions = [];
function tool(name, title, schema, read = false) {
    // One registry is used for MCP discovery, validation, CLI, dashboard and docs.
    definitions.push({ name: 'jobos1_' + name, title, description: title + '。使用当前宿主能力执行已授权外部操作；最终提交由用户完成。', inputSchema: schema,
        annotations: { readOnlyHint: read, destructiveHint: false, openWorldHint: false, idempotentHint: read } });
}
const EXPERIENCE_SCOPE = O({ company: S(150), origin: S(500), stage: E('identity', 'education', 'experience', 'attachment', 'review'), structure: S(64), host_version: S(100) });
tool('experience', '限定页面范围的操作经验；候选经合成验证和当前只读匹配才可复用', { oneOf: [
    OP('register', { scope: EXPERIENCE_SCOPE, strategy: E('semantic_fields', 'school_exact_option', 'date_dependency_order', 'upload_then_parse_then_edit', 'attachment_only') }),
    OP('lookup', { scope: EXPERIENCE_SCOPE }), OP('validate', { experience_id: S(100), replay_passed: B, protection_passed: B, replay_digest: S(64) }),
    OP('enable', { experience_id: S(100), scope: EXPERIENCE_SCOPE, observed_at: S(80), unique_match: B, readback_match: B }),
    OP('disable', { experience_id: S(100) }), OP('metrics')
] });
tool('material_index', '已授权材料索引与精确哈希文本缓存；先复用确认基线，不按日期猜版本', MATERIAL_INDEX_SCHEMA);
tool('tasks', '轻量只读子任务：规划、领取、提案、主 Agent 复核与恢复；宿主执行 Luna medium', tasksSchema(ASSESSMENT));
tool('context', '一次读取本次任务的画像、完整申请上下文和可选下一步；不得逐字段分页', O({ scope: E('current', 'profile', 'applications', 'application', 'metrics', 'daily'), application_id: S(100), session_id: S(100), turn_id: S(100), since: S(64) }, []), true);
tool('daily', '公司机会账本与每日五家待办；按预算增量采集、评估、跨日恢复，选定后准备材料', dailySchema(JOB, COLLECTION, ASSESSMENT));
tool('comparison', '独立公司比较：最多20家公司、累计预算与游标；先封存排序再比较历史，不创建申请', comparisonSchema(JOB, COLLECTION, ASSESSMENT));
tool('remember', '保存新信息或修正；用户直接陈述可确认，资料提取先成为提案', O({ mode: E('user_statement', 'extracted'), facts: A(FACT, 100), source_id: S(100), confirmed: B, user_ref: S(1000), question_id: S(200), request_id: S(150) }, ['mode', 'facts']));
tool('profile', '逐题访谈、跳过、暂停、偏好及事实核对', { oneOf: [
        OP('fit_context', { ...fitProfileFields, ...APPROVAL }, ['confirmed', 'user_ref']),
        OP('confirm', { proposal_ids: A(S(100), 100), ...APPROVAL }), OP('question', { key: S(150), prompt: S(1000) }), OP('skip'), OP('pause'), OP('resume'), OP('recommend'),
        OP('preferences', { preferences: PREF, ...APPROVAL }), OP('revoke', { fact_id: S(100), ...APPROVAL })
    ] });
tool('jobs', '批量保存完整 JD，或提交逐项证据匹配；不要求全站同步', { oneOf: [
        OP('ingest', { jobs: A(JOB, 100), coverage: E('partial', 'explicit_scope_complete'), collection: COLLECTION, compact: B, mode: E('live','demo') }, ['jobs', 'coverage']), OP('assess', { assessments: A(ASSESSMENT, 100) })
    ] });
tool('shortlist', '按指定公司充分发现；按职责、证据和资格档位排序，展示理由与缺口，不凑数量', { oneOf: [
        OP('daily', { mode: E('live', 'demo'), refresh: B, companies: A(S(150), 50), campaign: S(300), target_count: I(10, 50), search_complete: B, search_note: S(2000) }, []), OP('choose', { batch_id: S(100), numbers: A(I(1, 50), 50), ...APPROVAL }),
        OP('feedback', { job_id: S(100), decision: E('save', 'reject', 'defer'), reason: S(1000), until: S(80), ...APPROVAL }, ['job_id', 'decision', 'confirmed', 'user_ref'])
    ] });
tool('material', '逐岗简历：生成、渲染、真实 Figma/PDF 登记、审核、绑定', { oneOf: [
        OP('variation', { material_id: S(100), content_key: S(100), company: S(150), text: S(10000), reason: E('company_expansion', 'portal_length'), max_length: I(1,40000), evidence_ids: A(S(100), 50, 1), ...APPROVAL }, ['material_id','content_key','company','text','reason','evidence_ids','confirmed','user_ref']),
        OP('baseline', { material_id: S(100), sha256: S(64), extracted_text: S(100000), extraction_ref: S(1000), items: A(O({ key: S(100), category: E('education', 'work', 'project', 'achievement', 'award', 'portfolio'), text: S(10000) }), 200, 1), ...APPROVAL }),
        OP('lineage', { material_id: S(100), base_id: S(100), sha256: S(64), extracted_text: S(100000), extraction_ref: S(1000), ...APPROVAL }),
        OP('templates'), OP('draft', { job_id: S(100), template: E('classic', 'projects', 'clean'), content: CONTENT, change_summary: S(3000) }, ['job_id', 'content', 'change_summary']),
        OP('render', { material_id: S(100) }),
        OP('register', { material_id: S(100), job_id: S(100), kind: E('resume', 'portfolio', 'photo'), template: E('classic', 'projects', 'clean'), file: S(4000), allowed_root: S(4000), authorized: B, user_ref: S(1000) }, ['kind', 'file', 'authorized', 'user_ref']),
        OP('approve', { material_id: S(100), sha256: S(64), visual_ok: B, content_ok: B, text_quality: E('pass', 'limited', 'not_checked'), ...APPROVAL }),
        OP('bind', { application_id: S(100), material_id: S(100) })
    ] });
tool('plan', '根据实际门户结构一次准备所有区域；缺少内部 checkpoint 不阻塞', O({ application_id: S(100), portal_url: S(3000), page_fingerprint: S(200), groups: A(GROUP, 30), required_groups: A(S(100), 30), checklist: A(CHECK, 100) }, ['application_id', 'portal_url', 'page_fingerprint', 'groups']));
tool('authorize', '记录本次具体接收方、普通字段和已审核附件的适用授权，不授予最终提交', O({ application_id: S(100), plan_hash: S(64), portal_url: S(3000), session_id: S(100), reuse: B, ...APPROVAL }, ['application_id', 'plan_hash', 'portal_url', 'session_id', 'confirmed', 'user_ref']));
tool('checkpoint', '每完成区域保存草稿与真实值回读；控件存在不等于填对', O({ application_id: S(100), plan_hash: S(64), session_id: S(100), portal_url: S(3000), page_fingerprint: S(200), observed_at: S(80), portal_saved: B, protected_fields: A(OBSERVED, 1000), phase: E('prepare', 'complete', 'recover'), host_version: S(100), batch_number: I(1, 3000), metrics: O({ agent_ms: I(0, 86400000), tool_ms: I(0, 86400000), human_wait_ms: I(0, 86400000), cua_calls: I(0, 100000), full_snapshots: I(0, 100000) }),
    groups: A(O({ key: S(100), before: A(OBSERVED, 100), fields: A(OBSERVED, 100) }, ['key', 'fields']), 30) }, ['application_id', 'plan_hash', 'session_id', 'portal_url', 'page_fingerprint', 'observed_at', 'groups']));
tool('recover', '比较原值、目标值和当前值，恢复草稿但不覆盖用户新修改', O({ application_id: S(100), fields: A(OBSERVED, 1000) }), true);
tool('review', '基于保存的真实回读生成最终审核包，最终由用户提交', O({ application_id: S(100), portal_url: S(3000) }));
tool('handoff', '登录/验证码/声明/真实未知项的可恢复人工接管', { oneOf: [
        OP('open', { application_id: S(100), kind: E('login', 'captcha', 'sensitive', 'conflict', 'unknown', 'host_permission'), prompt: S(1500), reply: S(300) }, ['application_id', 'kind', 'prompt']),
        OP('resolve', { application_id: S(100), completed: B, user_ref: S(1000) })
    ] });
tool('outcome', '记录用户提交及官方页面/邮件/短信观察，不要求 checkpoint；不冒充 provider 验证', O({ application_id: S(100), stage: E('unknown', 'submitted', 'screening', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'),
    source: E('official_portal', 'user_report', 'email', 'sms', 'import'), observed_at: S(80), background: B, raw_stage: S(1000), observation_ref: S(1000), job_id: S(200),
    user_confirmed: B, user_ref: S(1000), actual_resume_sha256: S(64), company: S(200), title: S(300) }, ['stage', 'source', 'observed_at']));
tool('followup', '全部申请的只读跟进、结构化通知和真实调度绑定', { oneOf: [
        OP('queue', { background: B }, []), OP('configure', { timezone: S(100), times: A({ type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }, 4), include_email: B, include_sms: B, ...APPROVAL }),
        OP('bind', { host_success: B, provider: S(100), provider_task_id: S(300), result_ref: S(1000), next_run_at: S(80) }, ['host_success', 'provider', 'provider_task_id', 'result_ref']),
        OP('schedule_status', { state: E('paused', 'failed', 'needs_rebind'), result_ref: S(1000) }),
        OP('capability', { background: B, company: S(150), state: E('available', 'permission_denied', 'not_configured', 'temporarily_unavailable'), note: S(1000) }, ['company', 'state']),
        OP('notification', { background: B, application_id: S(100), source: E('email', 'sms'), reference_id: S(500), sender_label: S(200), received_at: S(80), deadline: S(80), deadline_hours: I(1, 8760),
            stage: E('submitted', 'screening', 'assessment', 'interview', 'offer', 'rejected', 'unknown'), action_required: S(2000), permission_state: E('available', 'permission_denied', 'not_configured', 'temporarily_unavailable') }, ['application_id', 'source', 'reference_id', 'sender_label', 'stage', 'action_required', 'permission_state'])
    ] });
tool('interview', '依据实际提交材料准备面试，基于转写复盘并提议新记忆', { oneOf: [
        OP('context', { application_id: S(100) }), OP('prepare', { application_id: S(100), round: S(100), questions: A(O({ question: S(1500), reason: S(2000), evidence_ref: S(1000) }), 30) }),
        OP('debrief', { application_id: S(100), source_id: S(100), findings: A(O({ kind: E('strength', 'gap', 'uncertain', 'practice'), point: S(2000), quote: S(3000), locator: S(300), next_practice: S(2000) }), 50),
            memory_candidates: A(O({ speaker: { const: 'candidate' }, key: S(150), value: V, quote: S(3000) }), 30) }, ['application_id', 'source_id', 'findings'])
    ] });
tool('workspace', '授权资料导入、本地看板和跨版本数据导入导出', { oneOf: [
        OP('source', { label: S(300), kind: E('resume', 'portfolio', 'notes', 'repository', 'memory', 'transcript', 'audio'), purposes: PURPOSE, file: S(4000), allowed_root: S(4000), text: S(1000000), authorized: B, user_ref: S(1000) }, ['label', 'kind', 'purposes', 'authorized', 'user_ref']),
        OP('export', { authorized: B, user_ref: S(1000) }), OP('import', { file: S(4000), assets_dir: S(4000), authorized: B, user_ref: S(1000) }, ['file', 'authorized', 'user_ref']), OP('dashboard'), OP('presentation', { status: E('opened', 'failed'), result_ref: S(1000), view_hash: S(64) }, ['status', 'result_ref'])
    ] });
tool('finish', '每次真正停下前保存交接：完成了什么、下一步、明确回复方式；能继续就不要停', O({ session_id: S(100), turn_id: S(100), application_id: S(100), reason: E('need_user', 'blocked', 'done', 'paused', 'budget'), completed: S(2000), blocker: S(2000), reply: S(300), browser_preserved: B }, ['session_id', 'turn_id', 'reason', 'completed']));
export const TOOLS = Object.freeze(definitions);
