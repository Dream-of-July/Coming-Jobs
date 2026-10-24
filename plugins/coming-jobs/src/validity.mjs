import {hash} from './core.mjs';
import {facts,profileDigest,factRole} from './profile.mjs';
export const matchingDigest=store=>profileDigest(store);
export const intentDigest=store=>hash(facts(store,'matching').filter(f=>factRole(f)==='intent').map(f=>[f.id,f.value,f.evidence_level,f.scope]).sort());
export function evidenceIds(a){return [...new Set([...(a.mappings??[]).flatMap(m=>m.evidence_ids??[]),...(a.evidence_refs??[]).map(r=>r.evidence_id)])].sort();}
export function evidenceDigest(store,ids){const fs=new Map(facts(store,'matching').filter(f=>!f.sensitive).map(f=>[f.id,f]));return hash(ids.map(id=>{const f=fs.get(id);return [id,f?[f.value,f.evidence_level??'inference',f.scope]:null];}));}
export function assessmentStamp(store,a){const ids=evidenceIds(a);return {evidence_ids:ids,evidence_digest:evidenceDigest(store,ids),intent_digest:intentDigest(store),matching_digest:matchingDigest(store)};}
export function assessmentCurrent(store,a,job){
 if(!a||a.job_hash!==job.content_hash)return false;
 if(!a.evidence_digest||!a.intent_digest)return a.profile_hash===profileDigest(store);
 return a.evidence_digest===evidenceDigest(store,a.evidence_ids??evidenceIds(a))&&a.intent_digest===intentDigest(store);
}
export const softStale=(store,a)=>!!a?.matching_digest&&a.matching_digest!==matchingDigest(store);
