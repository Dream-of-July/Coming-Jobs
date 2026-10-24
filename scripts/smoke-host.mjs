#!/usr/bin/env node
/** Only the explicitly installed synthetic home is opened. No real candidate workspace. */
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {VERSION} from '../plugins/coming-jobs/src/core.mjs';
const args=process.argv.slice(2),home=args.includes('--home')?args[args.indexOf('--home')+1]:null;
if(!home)throw Error('Provide the temporary installer --home directory.');
for(const host of ['codex','claude']){
 const p=path.join(home,'.local/share/coming-jobs',host==='codex'?'releases':'claude-releases',VERSION,'plugins/coming-jobs');
 const c=JSON.parse(readFileSync(path.join(p,'.mcp.json'),'utf8')),m=(c.mcpServers??c).jobos_next;
 const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'jobos1_context',arguments:{}}}].map(JSON.stringify).join('\n')+'\n';
 const out=spawnSync(m.command,m.args,{cwd:m.cwd??p,env:{...process.env,...m.env},input,encoding:'utf8',timeout:15000});
 if(out.status!==0)throw Error(`${host}: MCP process failed`);
 const rows=out.stdout.trim().split('\n').map(JSON.parse);
 if(!rows[0].result.serverInfo||!rows[1].result.tools.every(t=>t.inputSchema.type==='object'))throw Error(`${host}: initialize/tools-list invalid`);
 const result=rows[2].result.structuredContent??JSON.parse(rows[2].result.content[0].text);if(!result.ok||result.data.host.id!==host)throw Error(`${host}: tools/call invalid`);
 const hooks=JSON.parse(readFileSync(path.join(p,'hooks/hooks.json'),'utf8'));
 for(const event of ['SessionStart','UserPromptSubmit','Stop']){
  const command=hooks.hooks[event][0].hooks[0].command;
  const r=spawnSync(command,{shell:true,input:JSON.stringify({session_id:'synthetic-smoke',hook_event_name:event,prompt:'继续投递合成岗位'}),encoding:'utf8',timeout:10000,env:{...process.env,JOBOS_NEXT_HOME:m.env.JOBOS_NEXT_HOME}});
  if(r.status!==0)throw Error(`${host}: hook ${event} failed`);JSON.parse(r.stdout);
 }
 console.log(JSON.stringify({host,initialize:true,tools_list:rows[1].result.tools.length,tools_call:true,hooks:true}));
}
