import { assert } from './core.mjs';
export const HOSTS = Object.freeze({
 codex: Object.freeze({id:'codex',name:'Codex',login_codes:'authorized_read',worker:'gpt-5.6-luna',worker_owner:'luna',scheduler:'codex_heartbeat',browser:'cua_repl',open_local_view:'open_in_codex',upload:'host_file_upload'}),
 claude: Object.freeze({id:'claude',name:'Claude',login_codes:'user_only',worker:'coming-jobs:jobos-worker',worker_owner:'worker',scheduler:'claude_scheduled_task',browser:'built_in_browser',open_local_view:'host_local_view',upload:'grouped_manual_drag_drop'})
});
export function currentHost(env = process.env) {
 const id = env.JOBOS_HOST || 'codex';
 assert(Object.hasOwn(HOSTS,id),'unsupported_host','JOBOS_HOST 必须为 codex 或 claude。');
 return HOSTS[id];
}
/** Always return complete JSON. Large private values stay available through scoped tools. */
export function boundedResult(result, limit = 90 * 1024) {
 if (currentHost().id !== 'claude' || Buffer.byteLength(JSON.stringify(result)) <= limit) return result;
 return { ok:result.ok,contract:result.contract,version:result.version,build:result.build,workspace_id:result.workspace_id,
   ...(result.error ? {error:result.error} : {}),data:{compact:true,scope_required:true,available_keys:Object.keys(result.data ?? {}),
   counts:Object.fromEntries(Object.entries(result.data ?? {}).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length])),
   next:'结果超过 90 KB。使用 application_id、source_ids、material_ids 或明确的 scope 缩小范围；未截断 JSON。'},
   flow: result.flow ? {stage:result.flow.stage,can_auto_continue:result.flow.can_auto_continue,next:{owner:'agent',action:'narrow_scope',prompt:'缩小查询范围后继续。'}} : undefined };
}
