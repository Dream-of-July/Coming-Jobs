import { S, I, E, A, O, assert, consent } from './core.mjs';
import { normalizeFitAssessment } from './fit-assessment.mjs';
import { facts, remember } from './profile.mjs';

export const EVIDENCE_LEVEL = E('self_statement', 'original_artifact', 'third_party', 'ai_summary', 'inference');
export const fitProfileFields = {
    graduation_year: I(1900, 2200), degree:S(300),
    availability: O({ current_location: S(150), location: S(150), earliest_start: S(80), days_per_week: I(0, 7), continuous_months: I(0, 120) }, []),
    capabilities: A(O({ name: S(200), breadth_depth: E('breadth', 'depth', 'none'), level: EVIDENCE_LEVEL, note: S(1000), evidence_id: S(100) }, ['name', 'breadth_depth', 'level']), 100),
    preferred_service_objects: A(E('consumer', 'enterprise_user', 'internal_team', 'developer', 'player', 'merchant', 'mixed'), 7),
    preferred_deliverables: A(E('product_spec', 'interaction_design', 'visual', 'research', 'code', 'operations', 'content', 'mixed'), 8)
};

/** Projection only: free-form legacy facts never become structured qualifications. */
export function candidateFitContext(store) {
    const fs = facts(store, 'matching').filter(f => !f.sensitive);
    const byKey = key => fs.find(f => f.key === key);
    const value = key => byKey(key)?.value;
    const confirmedDirection = key => {
        const f = byKey(key);
        return f && ['self_statement', 'original_artifact', 'third_party'].includes(f.evidence_level) && Array.isArray(f.value) ? f.value : [];
    };
    const availability = value('availability');
    return {
        degree:typeof value('education.degree')==='string'?value('education.degree'):undefined,
        graduation_year: Number.isInteger(value('education.graduation_year')) ? value('education.graduation_year') : undefined,
        availability: availability && typeof availability === 'object' && !Array.isArray(availability) ? availability : {},
        capabilities: Array.isArray(value('capabilities')) ? value('capabilities') : [],
        preferred_service_objects: confirmedDirection('intent.service_objects'),
        preferred_deliverables: confirmedDirection('intent.deliverables'),
        evidence: fs.map(f => ({ evidence_id: f.id, level: f.evidence_level ?? 'inference', note: f.evidence_level ? '已记录来源等级' : '旧事实的证据等级未知，需复核' }))
    };
}

export function saveFitProfile(store, a) {
    consent(a.confirmed, a.user_ref);
    if (a.availability?.earliest_start) assert(Number.isFinite(Date.parse(a.availability.earliest_start)), 'invalid_date', '最早到岗日需要有效日期。');
    const keys = { degree:'education.degree', graduation_year: 'education.graduation_year', availability: 'availability', capabilities: 'capabilities', preferred_service_objects: 'intent.service_objects', preferred_deliverables: 'intent.deliverables' };
    const prior=candidateFitContext(store);
    const changes={...a};
    if(a.availability) changes.availability={...prior.availability,...a.availability};
    if(a.capabilities?.length) changes.capabilities=[...new Map([...prior.capabilities,...a.capabilities].map(c=>[c.name,c])).values()];
    const entries = Object.entries(keys).filter(([field]) => Object.hasOwn(a, field)).map(([field, key]) => ({ key, value: changes[field], purposes: ['matching'], evidence_level: 'self_statement' }));
    assert(entries.length, 'fit_context_empty', '至少提供一项已确认到岗、能力或方向信息。');
    remember(store, { mode: 'user_statement', confirmed: true, user_ref: a.user_ref, facts: entries });
    const candidate=candidateFitContext(store);
    for(const a of store.all('assessment')){const job=store.get('job',a.job_id??a.id,false);if(job)store.put('assessment',a.id,normalizeFitAssessment({...a,tier:a.requested_tier??a.tier},job,candidate));}
    for(const q of store.all('fit_question'))if(Object.hasOwn(a,q.key)||Object.hasOwn(a.availability??{},q.key))store.put('fit_question',q.id,{...q,state:'answered'});
    return candidate;
}

/** Deduplicate by answer topic, and never repeat a previously presented question. */
export function fitQuestions(store){
 const byKind=new Map();
 for(const a of store.all('assessment'))for(const gate of a.hard_gates??[]){
  if(gate.status!=='unknown'||!gate.criterion||gate.source==='preferred')continue;
  const kind=gate.criterion.kind,ids=byKind.get(kind)??new Set();ids.add(a.job_id??a.id);byKind.set(kind,ids);
 }
 const labels={graduation_year:'你的毕业年份是？',days_per_week:'每周可以到岗几天？',continuous_months:'可以连续工作几个月？',location:'可以到岗的地点是？',degree:'已确认的学历是？'};
 const outstanding=[...byKind].map(([kind,ids])=>({key:kind,prompt:labels[kind],affected_jobs:ids.size,job_ids:[...ids]}));
 const questions=outstanding.filter(q=>!store.get('fit_question',q.key,false)).slice(0,5);
 for(const q of questions)store.put('fit_question',q.key,{...q,state:'presented'});
 return {questions,outstanding,next:questions.length?'一次合并询问这些问题。':'复用已提出的问题和已有答案；不重复提问。'};
}
