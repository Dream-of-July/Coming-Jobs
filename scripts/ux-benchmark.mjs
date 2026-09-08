/** Deterministic regression benchmark. Measures bytes and scripted actions, not live token use. */
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const base=process.argv[2],out=process.argv[3]||'/tmp/jobos-ux-benchmark.json';
if(!base)throw Error('Provide the explicitly selected baseline package directory.');
const root=path.resolve(new URL('..',import.meta.url).pathname);
async function sample(dir){
 const plugin=path.join(dir,'plugins/coming-jobs');
 const {TOOLS}=await import(pathToFileURL(path.join(plugin,'src/catalog.mjs')));
 const {fillGroup}=await import(pathToFileURL(path.join(plugin,'src/browser.mjs')));
 const {environment,seedProfile,seedApplication,seedPlan}=await import(pathToFileURL(path.join(plugin,'tests/helpers.mjs')));
 const {call}=await import(pathToFileURL(path.join(plugin,'src/service.mjs')));
 const e=environment();let count=0,persisted=[],retained=0,value={one:'',two:''};
 try{
  seedProfile(e);const c=call(e.store,'jobos1_context',{});
  const repeat=call(e.store,'jobos1_context',c.data.context_revision?{since:c.data.context_revision}:{});
  const s=seedApplication(e),p=seedPlan(e,s);
  const args={application_id:s.app.id,portal_url:'https://jobs.example.com/application',page_fingerprint:'same',required_groups:p.required_groups,groups:p.groups.map(g=>({...g,fields:g.fields.map(f=>Object.fromEntries(Object.entries(f).filter(([k])=>!['material','local_file','evidence_versions'].includes(k))))})).reverse()};
  const update=call(e.store,'jobos1_plan',args);const grant=e.store.get('application',s.app.id).authorization;
  const group={key:'g',fields:['one','two'].map(key=>({key,label:key,type:'free_text',value:key,locator:{kind:'label',value:key}}))};
  const tab={url:async()=> 'https://jobs.example.com/application',markHandoff:async()=>retained++,playwright:{getByLabel:key=>({count:async()=>1,evaluate:async()=>({value:value[key]}),fill:async v=>{count++;if(key==='two')throw Error('synthetic interrupted write');value[key]=v;}})}};
  try{await fillGroup(tab,group,{origin:'https://jobs.example.com',authorization:{origin:'https://jobs.example.com',expires_at:new Date(Date.now()+60000).toISOString()},saveBefore:async()=>{},saveAfter:async({fields})=>persisted=fields});}catch{}
  const skill=readFileSync(path.join(plugin,'skills/jobos/SKILL.md'));
  return {tool_description_bytes:Buffer.byteLength(TOOLS.map(t=>t.description).join('\n')),skill_bytes:skill.length,skill_sha256:createHash('sha256').update(skill).digest('hex'),context_first_bytes:Buffer.byteLength(JSON.stringify(c.data)),context_repeat_bytes:Buffer.byteLength(JSON.stringify(repeat.data)),reorder_requires_content_reapproval:update.data?.authorization_status? !update.data.authorization_status.content_authorized:!grant,failed_group_write_attempts:count,successful_fields_durable_after_failure:persisted.filter(f=>f.value==='one').length,tab_preservation_calls:retained};
 }finally{e.store.close();rmSync(e.dir,{recursive:true,force:true});}
}
const before=await sample(path.resolve(base)),after=await sample(root);
const result={scope:'Fixed synthetic scenarios; byte counts are not model token counts; no live application time or user-interruption savings claimed.',before,after};mkdirSync(path.dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
