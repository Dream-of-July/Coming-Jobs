import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {hook} from '../hooks/lifecycle.mjs';
import {HOST_POLICY} from '../src/policy.mjs';
import {TOOLS} from '../src/catalog.mjs';
function home(t){const p=mkdtempSync(path.join(os.tmpdir(),'jobos-policy-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
test('recruiting hook permits host browser while preserving human-only actions',t=>{
 const h=home(t);
 for(const event of [{hook_event_name:'SessionStart'},{hook_event_name:'UserPromptSubmit',prompt:'上小米官网查投递进度'}]){
 const out=hook({...event,session_id:'s',turn_id:'t'},h).hookSpecificOutput.additionalContext;
 assert(out.includes(event.hook_event_name === 'SessionStart' ? HOST_POLICY : 'jobos1_finish'));assert(!out.includes('只调用 jobos_next'));
 }
});
test('maintenance clears recruiting state and does not trigger finish repair loop',t=>{
 const h=home(t);hook({hook_event_name:'UserPromptSubmit',session_id:'s',turn_id:'1',prompt:'投递小米'},h);
 const out=hook({hook_event_name:'UserPromptSubmit',session_id:'s',turn_id:'2',prompt:'修复 Coming Jobs 的全局工具限制，允许 Codex 浏览器、Computer Use 和插件维护工具'},h);
 assert(out.hookSpecificOutput.additionalContext.includes('文件编辑'));
 assert.deepEqual(hook({hook_event_name:'Stop',session_id:'s',turn_id:'2',last_assistant_message:'修复并验证完成'},h),{});
});
test('live MCP advertises shared boundaries once and keeps tool descriptions compact',t=>{
 const h=home(t);const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{}},{jsonrpc:'2.0',id:2,method:'tools/list'}].map(JSON.stringify).join('\n')+'\n';
 const child=spawnSync(process.execPath,['--no-warnings',new URL('../src/mcp.mjs',import.meta.url).pathname],{env:{...process.env,JOBOS_NEXT_HOME:h},input,encoding:'utf8',timeout:15000});
 assert.equal(child.status,0,child.stderr);const out=child.stdout.trim().split('\n').map(JSON.parse);
 assert(out[0].result.instructions.includes(HOST_POLICY));assert.equal(out[1].result.tools.length,TOOLS.length);
 for(const tool of out[1].result.tools) assert(tool.description.includes('宿主') && tool.description.length < 220);
 assert(readFileSync(new URL('../skills/jobos/SKILL.md',import.meta.url),'utf8').includes(HOST_POLICY));
});
test('remembering discovery rules in the plugin is a maintenance turn',t=>{
 const h=home(t);hook({hook_event_name:'UserPromptSubmit',session_id:'s',turn_id:'1',prompt:'投递小米'},h);
 hook({hook_event_name:'UserPromptSubmit',session_id:'s',turn_id:'2',prompt:'记到插件里，每次查询岗位优先读取接口'},h);
 assert.deepEqual(hook({hook_event_name:'Stop',session_id:'s',turn_id:'2'},h),{});
});
test('application workflow reuses confirmed answers and reviews tailoring before upload',()=>{
 assert(HOST_POLICY.includes('不逐项重复提问'));
 assert(HOST_POLICY.includes('用户审核后上传更新'));
 const s=readFileSync(new URL('../skills/jobos/SKILL.md',import.meta.url),'utf8');
 for(const clause of ['AX未显示值不等于字段为空','每次投递重新读取','不凭历史缓存复用内推码','不得先上传未审核稿','用户已在本轮确认无修改时直接交接','私密候选资料不写插件源码']) assert(s.includes(clause),clause);
 assert(s.includes('preferences.referral_source'));assert(!s.includes('docs.qq.com/smartsheet/'));
});
