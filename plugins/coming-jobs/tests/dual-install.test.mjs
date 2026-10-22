import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import * as installer from '../../../scripts/install.mjs';
import {environment} from './helpers.mjs';

test('both installs produce absolute host-specific MCP configs that initialize and list tools',t=>{
 const e=environment(t);const out=installer.install({home:e.dir,host:'both',skipCli:true});
 assert(out.hosts?.claude?.installed_path);assert.equal(out.installed_path,out.hosts.codex.installed_path);
 for(const host of ['codex','claude']){
  const p=out.hosts[host].installed_path,c=JSON.parse(readFileSync(path.join(p,'.mcp.json'),'utf8')),m=(c.mcpServers??c).jobos_next;
  assert.equal(m.env.JOBOS_HOST,host);assert(path.isAbsolute(m.args.at(-1)));
  const r=spawnSync(m.command,m.args,{cwd:m.cwd??p,env:{...process.env,...m.env},input:[{jsonrpc:'2.0',id:1,method:'initialize'},{jsonrpc:'2.0',id:2,method:'tools/list'}].map(JSON.stringify).join('\n')+'\n',encoding:'utf8',timeout:15000});
  assert.equal(r.status,0,r.stderr);const lines=r.stdout.trim().split('\n').map(JSON.parse);assert(lines[0].result.serverInfo);assert(lines[1].result.tools.every(t=>t.inputSchema.type==='object'));
 }
});
test('installer never edits existing user host settings',t=>{
 const e=environment(t);for(const f of ['.codex/config.toml','.claude/settings.json']){mkdirSync(path.dirname(path.join(e.dir,f)),{recursive:true});writeFileSync(path.join(e.dir,f),'KEEP');}
 installer.install({home:e.dir,host:'both',skipCli:true});for(const f of ['.codex/config.toml','.claude/settings.json'])assert.equal(readFileSync(path.join(e.dir,f),'utf8'),'KEEP');
});
test('Claude marketplace registration replaces own source, rolls back failure, and preserves conflicts',t=>{
 assert.equal(typeof installer.registerClaudeMarketplace,'function');const e=environment(t),base=path.join(e.dir,'.local/share/coming-jobs/claude-releases'),old=path.join(base,'old'),dest=path.join(base,'new');
 for(const scenario of ['replace','failure','conflict']){
 const calls=[];const run=(cli,args)=>{calls.push(args);return {status:scenario==='failure'&&args.includes(dest)?1:0,stdout:JSON.stringify([{name:'coming-jobs',source:{source:'directory',path:scenario==='conflict'?'/unrelated/source':old},installLocation:old}])};};
 const result=installer.registerClaudeMarketplace('claude',dest,e.dir,path.join(e.dir,'backups'),run);
 assert.equal(result.ok,scenario==='replace');if(scenario==='conflict')assert.equal(calls.length,1);if(scenario==='failure')assert(calls.at(-1).includes(old));
 }
});

test('both and default Codex generate identical Codex host config apart from their home paths',t=>{
 const e=environment(t),a=path.join(e.dir,'a'),b=path.join(e.dir,'b');const one=installer.install({home:a,skipCli:true}),both=installer.install({home:b,host:'both',skipCli:true});
 for(const file of ['.mcp.json','hooks/hooks.json'])assert.equal(readFileSync(path.join(one.installed_path,file),'utf8').replaceAll(a,'HOME'),readFileSync(path.join(both.hosts.codex.installed_path,file),'utf8').replaceAll(b,'HOME'));
});
