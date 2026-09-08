import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {registerMarketplace} from '../../../scripts/install.mjs';
import {environment} from './helpers.mjs';
test('installer replaces only the known Coming Jobs release source and installs no duplicate',t=>{
 const e=environment(t),old=path.join(e.dir,'.local/share/coming-jobs/releases/beta5'),dest=path.join(e.dir,'.local/share/coming-jobs/releases/beta6'),calls=[];
 const run=(cli,args)=>{calls.push(args);return {status:0,stdout:JSON.stringify({marketplaces:[{name:'coming-jobs',root:old,marketplaceSource:{sourceType:'local'}}]})};};
 assert(registerMarketplace('cli',dest,e.dir,path.join(e.dir,'backups'),run).ok);
 assert.deepEqual(calls.map(x=>x.slice(2)),[['list','--json'],['remove','coming-jobs','--json'],['add',dest,'--json']]);
});
test('failed marketplace replacement restores the exact previous source',t=>{
 const e=environment(t),old=path.join(e.dir,'.local/share/coming-jobs/releases/beta5'),dest=path.join(e.dir,'.local/share/coming-jobs/releases/beta6'),calls=[];
 const run=(cli,args)=>{calls.push(args);return {status:args.includes(dest)?1:0,stdout:JSON.stringify({marketplaces:[{name:'coming-jobs',root:old,marketplaceSource:{sourceType:'local'}}]})};};
 assert.equal(registerMarketplace('cli',dest,e.dir,path.join(e.dir,'backups'),run).state,'marketplace_update_failed');assert.deepEqual(calls.at(-1).slice(2),['add',old,'--json']);
});
test('unrelated marketplace source is preserved without removal or fallback mutation',t=>{
 const e=environment(t),calls=[];const run=(cli,args)=>{calls.push(args);return {status:0,stdout:JSON.stringify({marketplaces:[{name:'coming-jobs',root:'/unrelated/project',marketplaceSource:{sourceType:'local'}}]})};};
 assert.equal(registerMarketplace('cli','/new',e.dir,e.dir,run).state,'marketplace_source_conflict');assert.equal(calls.length,1);
});
