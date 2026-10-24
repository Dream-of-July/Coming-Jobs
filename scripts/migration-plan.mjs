#!/usr/bin/env node
/** Explicit read-only connection: never constructs Store or changes a real workspace. */
import {DatabaseSync} from 'node:sqlite';
import {writeFileSync} from 'node:fs';
import {migrationPlan} from '../plugins/coming-jobs/src/migration.mjs';
const args=process.argv.slice(2),file=args.includes('--workspace')?args[args.indexOf('--workspace')+1]:null;
if(!file)throw Error('Provide an explicit --workspace database file. No default workspace is opened.');
const db=new DatabaseSync(file,{readOnly:true});
try{
 const contract=db.prepare('SELECT value FROM meta WHERE key=?').get('contract')?.value;if(contract!=='jobos/1')throw Error('Unsupported workspace contract.');
 const store={db,workspace:db.prepare('SELECT value FROM meta WHERE key=?').get('workspace').value,
 all:kind=>db.prepare('SELECT value,revision FROM records WHERE kind=? ORDER BY updated_at,id').all(kind).map(r=>({...JSON.parse(r.value),revision:r.revision})),
 get:(kind,id,required=true)=>{const r=db.prepare('SELECT value,revision FROM records WHERE kind=? AND id=?').get(kind,id);if(!r&&required)throw Error('Record missing');return r?{...JSON.parse(r.value),revision:r.revision}:null;}};
 const result=migrationPlan(store),out=args.includes('--output')?args[args.indexOf('--output')+1]:null;
 if(out)writeFileSync(out,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({code:result.code,read_only:true,...result.summary,...(out?{private_plan_file:out}:{})}));
}finally{db.close();}
