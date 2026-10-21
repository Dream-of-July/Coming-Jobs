import { A, B, E, I, O, S, assert, validate } from './core.mjs';

const serviceObjects = ['consumer', 'enterprise_user', 'internal_team', 'developer', 'player', 'merchant', 'mixed', 'unclear'];
const deliverables = ['product_spec', 'interaction_design', 'visual', 'research', 'code', 'operations', 'content', 'mixed'];
const gates = ['graduation', 'degree', 'major', 'language', 'tool', 'portfolio', 'availability', 'city', 'quota'];
const tiers = ['priority', 'conditional', 'adjacent', 'qualification_hold', 'misjudged', 'excluded'];
const evidenceLevels = ['self_statement', 'original_artifact', 'third_party', 'ai_summary', 'inference'];
const directEvidence = new Set(['self_statement', 'original_artifact', 'third_party']);

export const fitAssessmentFields = {
    service_object: E(...serviceObjects),
    core_deliverable: E(...deliverables),
    hard_gates: A(O({
        gate: E(...gates), source: E('requirement', 'preferred', 'structured_field'),
        status: E('meets', 'fails', 'unknown', 'conflict'), note: S(2000), requirement_id: S(300)
    }, ['gate', 'source', 'status', 'note']), 100),
    tier: E(...tiers),
    evidence_refs: A(O({ evidence_id: S(300), level: E(...evidenceLevels), note: S(2000) }, ['evidence_id', 'level']), 200),
    rank: I(1, 1000000),
    // Empty gates establish eligibility only after the host reviewed the full JD.
    gates_complete: B
};

export const structuredJobFields = {
    graduation_min_year: I(1900, 2200),
    graduation_max_year: I(1900, 2200),
    required_degree: S(300),
    required_majors: A(S(300), 100),
    availability: O({
        location: S(300),
        latest_start: S(40),
        days_per_week: I(1, 7),
        continuous_months: { type: 'number', minimum: 0, maximum: 120 }
    }, []),
    qualification_conflicts: A(O({ gate: E(...gates), note: S(2000) }), 100)
};

const metadataKeys = ['service_object', 'core_deliverable', 'hard_gates', 'tier', 'evidence_refs'];
const hasMetadata = value => Boolean(value && typeof value === 'object' && metadataKeys.every(key => Object.hasOwn(value, key)));
const pick = (value, fields) => Object.fromEntries(Object.keys(fields).filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
const requiredGates = value => value.hard_gates.filter(gate => gate.source !== 'preferred');
const knownNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const locationKey = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';

function structuredGate(gate, status, note) {
    return { gate, source: 'structured_field', status, note };
}

function replaceStructuredGate(hardGates, gate) {
    return [...hardGates.filter(existing => existing.source !== 'structured_field' || existing.gate !== gate.gate), gate];
}

function graduationGate(job, candidate) {
    const min = job.graduation_min_year, max = job.graduation_max_year;
    if (min === undefined && max === undefined) return null;
    assert(min === undefined || max === undefined || min <= max, 'invalid_qualification_range', '毕业年份下限不能晚于上限。');
    const year = candidate.graduation_year;
    if (!Number.isSafeInteger(year) || year < 1900 || year > 2200)
        return structuredGate('graduation', 'unknown', '岗位已限定毕业年份，候选人的毕业年份尚未确认。');
    const meets = (min === undefined || year >= min) && (max === undefined || year <= max);
    return structuredGate('graduation', meets ? 'meets' : 'fails', meets ? '已确认的毕业年份符合岗位结构化范围。' : '已确认的毕业年份不在岗位结构化范围内。');
}

function availabilityGates(job, candidate) {
    const expected = job.availability ?? {}, actual = candidate.availability ?? {};
    const result = [], checks = [];
    if (expected.location !== undefined) {
        const actualLocations = (Array.isArray(actual.location) ? actual.location : [actual.location]).map(locationKey).filter(Boolean);
        const status = !actualLocations.length ? 'unknown' : actualLocations.includes(locationKey(expected.location)) ? 'meets' : 'fails';
        result.push(structuredGate('city', status, status === 'unknown' ? '岗位要求的到岗地点尚未与候选人确认。' : status === 'meets' ? '已确认可到岗地点符合要求。' : '已确认可到岗地点与岗位要求冲突。'));
    }
    for (const key of ['days_per_week', 'continuous_months']) {
        if (expected[key] !== undefined) {
            const valid = knownNumber(actual[key]) && (key !== 'days_per_week' || Number.isSafeInteger(actual[key]) && actual[key] <= 7);
            checks.push(!valid ? 'unknown' : actual[key] >= expected[key] ? 'meets' : 'fails');
        }
    }
    if (expected.latest_start !== undefined) {
        const latest = Date.parse(expected.latest_start);
        assert(Number.isFinite(latest), 'invalid_qualification_date', '岗位最晚到岗日必须是可解析日期。');
        const earliest = typeof actual.earliest_start === 'string' ? Date.parse(actual.earliest_start) : NaN;
        checks.push(!Number.isFinite(earliest) ? 'unknown' : earliest <= latest ? 'meets' : 'fails');
    }
    if (checks.length) {
        const status = checks.includes('fails') ? 'fails' : checks.includes('unknown') ? 'unknown' : 'meets';
        result.push(structuredGate('availability', status, status === 'fails' ? '已确认的最早到岗日、每周天数或连续时长不满足岗位要求。' : status === 'unknown' ? '到岗日期、每周天数或连续时长仍有必填条件待确认。' : '已确认的到岗日期、每周天数和连续时长符合已列要求。'));
    }
    return result;
}

function explicitlySupports(values, expected) {
    return Array.isArray(values) && values.some(value => typeof value === 'string' ? value === expected :
        value && (value.value ?? value.name) === expected && directEvidence.has(value.level));
}

function hasDirectEvidence(assessment) {
    return assessment.evidence_refs.some(ref => directEvidence.has(ref.level));
}

export function normalizeFitAssessment(assessment, job, candidate = {}) {
    validate(O(fitAssessmentFields, []), pick(assessment, fitAssessmentFields));
    validate(O(structuredJobFields, []), pick(job, structuredJobFields));
    const complete = hasMetadata(assessment);
    const requirements = new Map((job.requirements ?? []).map(requirement => [requirement.id, requirement]));
    let hardGates = (assessment.hard_gates ?? []).map(gate => {
        if (gate.requirement_id === undefined) return { ...gate };
        const requirement = requirements.get(gate.requirement_id);
        assert(requirement, 'invalid_requirement_reference', '硬性条件引用了不存在的 JD 条目。', '请使用当前岗位的 requirement_id，优先项不能充当硬门槛。');
        assert(['requirement', 'preferred'].includes(requirement.kind), 'invalid_gate_source', '岗位职责条目不能充当资格门槛。', '请引用明确的任职要求或优先项，并保留其原始性质。');
        return { ...gate, source: requirement.kind === 'preferred' ? 'preferred' : 'requirement' };
    });
    const conflicts = new Map(hardGates.filter(gate => gate.source !== 'preferred' && gate.status === 'conflict').map(gate => [gate.gate, gate.note]));
    for (const conflict of job.qualification_conflicts ?? []) conflicts.set(conflict.gate, conflict.note);

    const graduation = graduationGate(job, candidate);
    if (graduation) hardGates = replaceStructuredGate(hardGates, graduation);
    for (const gate of availabilityGates(job, candidate)) hardGates = replaceStructuredGate(hardGates, gate);
    for (const [gate, present] of [['degree', Boolean(job.required_degree)], ['major', Boolean(job.required_majors?.length)]]) {
        if (present && !hardGates.some(existing => existing.gate === gate && existing.source !== 'preferred'))
            hardGates.push(structuredGate(gate, 'unknown', '岗位已有明确资格要求，仍需宿主以原始资料核验。'));
    }
    for (const [conflictGate, note] of conflicts) {
        const matching = hardGates.some(gate => gate.gate === conflictGate && gate.source !== 'preferred');
        hardGates = hardGates.map(gate => gate.gate === conflictGate && gate.source !== 'preferred' ? { ...gate, status: 'conflict', note } : gate);
        if (!matching) hardGates.push(structuredGate(conflictGate, 'conflict', note));
    }

    // Legacy weighted scores are not part of the semantic assessment contract.
    const { score, ...original } = assessment;
    const result = {
        ...original,
        service_object: assessment.service_object ?? 'unclear',
        core_deliverable: assessment.core_deliverable ?? 'mixed',
        hard_gates: hardGates,
        evidence_refs: (assessment.evidence_refs ?? []).map(ref => ({ ...ref })),
        tier: assessment.tier ?? 'qualification_hold'
    };
    const required = requiredGates(result);
    result.eligibility = !complete ? 'unknown' : required.some(gate => gate.status === 'fails') ? 'fail' :
        required.some(gate => gate.status === 'unknown' || gate.status === 'conflict') || !required.length && assessment.gates_complete !== true ? 'unknown' : 'pass';

    if (result.eligibility === 'fail') result.tier = 'excluded';
    else if (!complete || result.eligibility === 'unknown' || result.service_object === 'unclear') result.tier = 'qualification_hold';
    else if (result.tier === 'priority') {
        const mismatchedService = ['developer', 'internal_team'].includes(result.service_object) && !explicitlySupports(candidate.preferred_service_objects, result.service_object);
        const mismatchedDeliverable = result.core_deliverable === 'code' && !explicitlySupports(candidate.preferred_deliverables, result.core_deliverable);
        if (mismatchedService || mismatchedDeliverable) result.tier = 'adjacent';
        else if (!hasDirectEvidence(result)) result.tier = 'conditional';
    }
    return result;
}

export function compareFitAssessments(a, b) {
    const tierA = tiers.indexOf(a.tier), tierB = tiers.indexOf(b.tier);
    const order = (tierA < 0 ? tiers.indexOf('qualification_hold') : tierA) - (tierB < 0 ? tiers.indexOf('qualification_hold') : tierB);
    if (order) return order;
    const rankA = Number.isSafeInteger(a.rank) && a.rank > 0 ? a.rank : Infinity;
    const rankB = Number.isSafeInteger(b.rank) && b.rank > 0 ? b.rank : Infinity;
    if (rankA !== rankB) return rankA < rankB ? -1 : 1;
    const idA = String(a.job_id ?? a.id ?? ''), idB = String(b.job_id ?? b.id ?? '');
    return idA < idB ? -1 : idA > idB ? 1 : 0;
}

export function isRecommendable(assessment) {
    if (!hasMetadata(assessment) || assessment.eligibility !== 'pass' || !['priority', 'conditional', 'adjacent'].includes(assessment.tier) || assessment.service_object === 'unclear') return false;
    try {
        validate(O(fitAssessmentFields, []), pick(assessment, fitAssessmentFields));
    }
    catch {
        return false;
    }
    if (!Array.isArray(assessment.hard_gates) || !Array.isArray(assessment.evidence_refs) || !assessment.evidence_refs.length) return false;
    const required = requiredGates(assessment);
    return (!required.length ? assessment.gates_complete === true : required.every(gate => gate.status === 'meets')) && (assessment.tier !== 'priority' || hasDirectEvidence(assessment));
}
