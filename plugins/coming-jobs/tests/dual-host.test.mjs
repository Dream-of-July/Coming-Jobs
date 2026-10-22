import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { TOOLS } from '../src/catalog.mjs';
import { call } from '../src/service.mjs';
import { environment, seedProfile } from './helpers.mjs';
import { hook } from '../hooks/lifecycle.mjs';

test('every published tool is an object without top-level combinators', () => {
 for (const tool of TOOLS) { assert.equal(tool.inputSchema.type,'object',tool.name); for(const key of ['oneOf','anyOf','allOf']) assert(!tool.inputSchema[key],tool.name); }
});
test('flattening does not weaken operation-specific required and allowed fields',t=>{
 const e=environment(t);
 const r=call(e.store,'jobos1_profile',{operation:'revoke'});
 assert.equal(r.ok,false); assert.match(r.error.message,/revoke.*fact_id/);
 assert.equal(call(e.store,'jobos1_profile',{operation:'pause',fact_id:'other-operation'}).ok,false);
});
test('Claude hooks generate a stable per-prompt turn and do not disturb unrelated work',t=>{
 const e=environment(t);
 const start=hook({hook_event_name:'SessionStart',session_id:'claude'},e.dir,'claude');
 assert(start.hookSpecificOutput.additionalContext.length<160);
 assert.deepEqual(hook({hook_event_name:'UserPromptSubmit',session_id:'claude',prompt:'fix a CSS margin'},e.dir,'claude'),{});
 const prompt=hook({hook_event_name:'UserPromptSubmit',session_id:'claude',prompt:'继续投递'},e.dir,'claude');
 assert.match(prompt.hookSpecificOutput.additionalContext,/turn_id="[^"]+"/);
 assert.deepEqual(hook({hook_event_name:'Stop',session_id:'claude'},e.dir,'claude'),{});
});
test('Claude context never requests email or SMS credentials',t=>{
 const e=environment(t); seedProfile(e);
 const old=process.env.JOBOS_HOST; process.env.JOBOS_HOST='claude';t.after(()=>old===undefined?delete process.env.JOBOS_HOST:process.env.JOBOS_HOST=old);
 const context=e.run('context'); assert.equal(context.host.id,'claude'); assert.deepEqual(context.authentication.request_channels,[]);
 assert.equal(context.capabilities.final_submit,'batch_grant_only'); assert.equal(context.authentication.email_read,'user_only');
});
test('Claude MCP uses one content channel and a host-specific policy',t=>{
 const e=environment(t);const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{}},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'jobos1_context',arguments:{}}}].map(JSON.stringify).join('\n')+'\n';
 const r=spawnSync(process.execPath,['--no-warnings',new URL('../src/mcp.mjs',import.meta.url).pathname],{input,encoding:'utf8',env:{...process.env,JOBOS_HOST:'claude',JOBOS_NEXT_HOME:e.dir},timeout:15000});
 assert.equal(r.status,0,r.stderr);const out=r.stdout.trim().split('\n').map(JSON.parse);
 assert.match(out[0].result.instructions,/验证码由用户输入/);assert.equal(out[1].result.structuredContent,undefined); assert(JSON.parse(out[1].result.content[0].text).ok);
});

test('every operation accepts its generated minimal structural arguments', async()=>{
 const {INTERNAL_SCHEMAS}=await import('../src/catalog.mjs');const {validate}=await import('../src/core.mjs');
 const sample=s=>s.const??s.enum?.[0]??(s.oneOf?sample(s.oneOf[0]):s.type==='object'?Object.fromEntries((s.required??[]).map(k=>[k,sample(s.properties[k])])):s.type==='array'?Array.from({length:s.minItems??0},()=>sample(s.items)):s.type==='boolean'?false:['integer','number'].includes(s.type)?s.minimum??0:s.pattern?.includes('01')?'09:00':'x'.repeat(s.minLength??1));
 for(const [name,s] of INTERNAL_SCHEMAS)for(const branch of s.oneOf??[s]) assert.doesNotThrow(()=>validate(s,sample(branch)),name+':'+branch.properties?.operation?.const);
});
test('Claude oversized results remain valid compact JSON with no raw fact payload',async t=>{
 const {boundedResult}=await import('../src/host.mjs');const old=process.env.JOBOS_HOST;process.env.JOBOS_HOST='claude';t.after(()=>old===undefined?delete process.env.JOBOS_HOST:process.env.JOBOS_HOST=old);
 const out=boundedResult({ok:true,data:{facts:Array.from({length:1000},()=>({value:'Synthetic'.repeat(100)}))}});
 assert.equal(out.data.scope_required,true);assert(Buffer.byteLength(JSON.stringify(out))<90*1024);assert.equal(out.data.facts,undefined);
});
