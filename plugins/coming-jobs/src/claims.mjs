import {readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {assert,consent,noSecrets,hash,id,now,assertExternalFilename} from './core.mjs';
import {facts} from './profile.mjs';
import {pinRenderer,expectedText} from './renderer.mjs';
function leaves(value,prefix=''){return typeof value==='string'?[{path:prefix,text:value}]:value&&typeof value==='object'?Object.entries(value).flatMap(([k,v])=>leaves(v,prefix?prefix+'.'+k:k)):[];}
const pathMatches=(pattern,p)=>pattern.split('.').length===p.split('.').length&&pattern.split('.').every((part,i)=>part==='*'||part===p.split('.')[i]);
const identityPath=(p,extra=[])=>extra.some(x=>pathMatches(x,p)||p.startsWith(x+'.'))||p.split('.').some(part=>/(?:^|_)(?:name|contact|email|phone|link|links|role|position|date|dates|start|end|started|ended|period|duration|icon|icons|image|logo|company|institution|organization|employer)(?:_|$)/i.test(part.replace(/([a-z])([A-Z])/g,'$1_$2')))||/(?:experiences?|employment|education|projects?)\.\d+\.(?:title|heading)$/i.test(p);
const narrativePath=p=>/(?:^|\.)(?:headline|summary|description|details|text|bullets?)(?:\.\d+)?$/i.test(p);
const fixed=(p,baseline)=>identityPath(p,baseline.identity_paths)||!baseline.editable_paths?.includes(p);
export function claimAction(store,a){
 if(a.operation==='template_baseline'){
  consent(a.confirmed,a.user_ref);const file=realpathSync(a.file);if(a.allowed_root){const root=realpathSync(a.allowed_root);assert(file.startsWith(root+path.sep),'scope_violation','基线不在授权目录。');}
  const bytes=readFileSync(file);assert(bytes.length<2*1024*1024,'template_too_large','基线数据过大。');const data=JSON.parse(bytes.toString());noSecrets(data);assert(data&&typeof data==='object'&&!Array.isArray(data),'template_data','基线必须为对象。');
  const renderer=pinRenderer(store,a),content_hash=hash(data),identity_paths=a.identity_paths??[];
  const editable_paths=leaves(data).filter(x=>!identityPath(x.path,identity_paths)&&(a.editable_paths?a.editable_paths.some(p=>pathMatches(p,x.path)):narrativePath(x.path))).map(x=>x.path);
  const baseline={data,content_hash,renderer,identity_paths,editable_paths,user_ref:a.user_ref,created_at:now()};
  const claims=leaves(data).filter(x=>!fixed(x.path,baseline)).map(x=>store.put('claim',hash([content_hash,x.path,x.text]),{...x,baseline_hash:content_hash,state:'approved',baseline:true,evidence:[],approval_ref:a.user_ref}));
  store.put('settings','preferences',{...store.get('settings','preferences',false),renderer});store.put('settings','template_baseline',baseline);return {content_hash,claims,identity_locked:true};
 }
 const baseline=store.get('settings','template_baseline');
 if(a.operation==='claim_propose'){
  const available=new Map(facts(store,'resume').map(f=>[f.id,f]));
  const claims=a.claims.map(c=>{noSecrets(c.text);assert(!fixed(c.path,baseline),'identity_locked','仅登记为可改写的叙述字段可变化；身份、经历名称、角色、日期和图标固定。');assert(leaves(baseline.data).some(l=>l.path===c.path),'claim_path','条目必须引用现有基线文本。');assert(c.evidence_ids.length&&c.evidence_ids.every(k=>available.has(k)),'resume_evidence','改写条目必须引用可用的简历证据。');const evidence=c.evidence_ids.map(k=>({id:k,digest:hash(available.get(k).value)}));return store.put('claim',hash([baseline.content_hash,c.path,c.text,evidence]),{...c,baseline_hash:baseline.content_hash,state:'proposed',evidence});});return {claims,question_budget:5,next:'合并展示全部改写与证据，一条消息批准；最多 5 问，一次问完。'};
 }
 if(a.operation==='claim_approve'){
  consent(a.confirmed,a.user_ref);return {claims:a.claim_ids.map(key=>{const c=store.get('claim',key);assert(c.baseline_hash===baseline.content_hash,'stale_baseline','条目基线已变化。');return store.put('claim',key,{...c,state:'approved',approval_ref:a.user_ref,approved_at:now()});})};
 }
 assert(a.operation==='compose','invalid_operation','不支持的条目操作。');const job=store.get('job',a.job_id),data=structuredClone(baseline.data),selected=(a.claim_ids??[]).map(k=>store.get('claim',k)),available=new Map(facts(store,'resume').map(f=>[f.id,f]));
 assert(new Set(selected.map(c=>c.path)).size===selected.length,'claim_conflict','同一条目只能选择一种表述。');
 for(const c of selected){assert(c.state==='approved'&&c.baseline_hash===baseline.content_hash,'claim_unapproved','组装只能使用当前基线已批准的条目。');assert(!fixed(c.path,baseline),'identity_locked','身份字段固定。');assert(c.evidence.every(e=>available.has(e.id)&&hash(available.get(e.id).value)===e.digest),'material_evidence_changed','条目引用的事实已变化。');const keys=c.path.split('.');let parent=data;for(const k of keys.slice(0,-1))parent=parent[k];parent[keys.at(-1)]=c.text;}
 const text=expectedText(data,baseline.renderer.text_paths),baseText=expectedText(baseline.data,baseline.renderer.text_paths),ratio=[...text].length/Math.max(1,[...baseText].length);
 const warnings=ratio<.9||ratio>1.1?['word_count_outside_10_percent']:[];
 const evidence=[...new Map(selected.flatMap(c=>c.evidence).map(e=>[e.id,e])).values()],key=hash([job.id,job.content_hash,baseline.content_hash,data,evidence]);
 return store.get('material',key,false)??store.put('material',key,{kind:'resume',job_id:job.id,job_hash:job.content_hash,template:'classic',template_adapter:true,template_baseline_hash:baseline.content_hash,template_data:data,claim_ids:selected.map(c=>c.id),evidence,approved:false,asset:null,external_name:assertExternalFilename(a.external_name??'resume.pdf'),composition:{headline:data.headline??'',summary:data.summary??'',word_count:[...text].length,ratio,warnings,selection_paths:selected.map(c=>c.path),selection_claims:selected.map(c=>({path:c.path,digest:hash(c.text)}))},created_at:now()});
}
