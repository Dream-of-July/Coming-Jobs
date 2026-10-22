import {assert,consent,hash,id,now} from './core.mjs';
import {readAssessment} from './jobs.mjs';
import {assessmentCurrent} from './validity.mjs';
import {isRecommendable} from './fit-assessment.mjs';
import {jobOpportunity} from './opportunities.mjs';
export function targetStatus(store,list){
 const needs_decision=[],refresh=[];
 for(const item of list.items){
  const job=store.get('job',item.job_id,false),a=job&&readAssessment(store,job),q=job&&jobOpportunity(store,job);
  const reason=!job||job.content_hash!==item.job_hash?'jd_changed':q.state==='exhausted'||q.state==='closed'?'quota_unavailable':!assessmentCurrent(store,a,job)||!isRecommendable(a)?'qualification_changed':null;
  if(reason)needs_decision.push({number:item.number,job_id:item.job_id,reason});
  else if(q.state==='needs_verification')refresh.push({number:item.number,action:'refresh_official_rules'});
 }
 return {...list,needs_decision,agent_refresh:refresh};
}
export function applyBatch(store,a){
 assert(a.operation==='targets','invalid_operation','操作尚未支持。');
 let list=a.target_list_id?store.get('target_list',a.target_list_id):null;
 if(!list){assert(a.job_ids?.length,'targets_required','需要非空目标岗位。');assert(new Set(a.job_ids).size===a.job_ids.length,'duplicate_target','目标不能重复。');const items=a.job_ids.map((key,i)=>{const job=store.get('job',key),assessment=readAssessment(store,job);assert(assessmentCurrent(store,assessment,job)&&isRecommendable(assessment),'qualification_unverified','先核验目标岗位与资格。');return {number:i+1,job_id:job.id,job_hash:job.content_hash,gates_digest:hash(assessment.hard_gates),quota:jobOpportunity(store,job)};});list=store.put('target_list',id('targets'),{items,approved_numbers:[],created_at:now()});}
 if(a.confirmed){consent(a.confirmed,a.user_ref);assert(a.numbers?.length&&a.numbers.every(n=>list.items.some(i=>i.number===n)),'invalid_selection','选择目标清单中的编号。');const status=targetStatus(store,list);assert(!status.needs_decision.some(i=>a.numbers.includes(i.number)),'targets_changed','变化项需要在下一张审批单中决定。');list=store.put('target_list',list.id,{...list,approved_numbers:[...new Set(a.numbers)],approved_ref:a.user_ref});}
 return targetStatus(store,list);
}
