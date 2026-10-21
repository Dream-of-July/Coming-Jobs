import test from 'node:test';
import assert from 'node:assert/strict';
import { O, validate } from '../src/core.mjs';
import { fitAssessmentFields, structuredJobFields, normalizeFitAssessment, compareFitAssessments, isRecommendable } from '../src/fit-assessment.mjs';

const job = {
    id: 'synthetic-job', title: 'Synthetic product role',
    requirements: [
        { id: 'r1', kind: 'requirement', text: 'An accredited degree is required.' },
        { id: 'r2', kind: 'preferred', text: 'Experience with SyntheticCAD is preferred.' }
    ]
};
function assessment(overrides = {}) {
    return {
        job_id: job.id, eligibility: 'pass', service_object: 'consumer', core_deliverable: 'product_spec',
        hard_gates: [{ gate: 'degree', source: 'requirement', status: 'meets', note: 'Synthetic confirmed qualification.', requirement_id: 'r1' }],
        tier: 'priority', evidence_refs: [{ evidence_id: 'synthetic-evidence', level: 'original_artifact' }],
        advantages: ['Synthetic product evidence.'], gaps: [], reason: 'Synthetic host assessment.', ...overrides
    };
}
function normalize(overrides = {}, jobOverrides = {}, candidate = {}) {
    return normalizeFitAssessment(assessment(overrides), { ...job, ...jobOverrides }, candidate);
}

test('complete supported assessment can remain a priority', () => {
    const result = normalize();
    assert.equal(result.eligibility, 'pass');
    assert.equal(result.tier, 'priority');
    assert.equal(isRecommendable(result), true);
});

test('preferred-only failure cannot create failed eligibility', () => {
    const result = normalize({ hard_gates: [{ gate: 'tool', source: 'preferred', status: 'fails', note: 'Synthetic preferred tool gap.', requirement_id: 'r2' }] });
    assert.equal(result.eligibility, 'unknown');
    assert.equal(result.tier, 'qualification_hold');
});

test('requirement reference demotes a mislabeled preferred gate before eligibility', () => {
    const result = normalize({ hard_gates: [
        ...assessment().hard_gates,
        { gate: 'tool', source: 'requirement', status: 'fails', note: 'Synthetic preferred tool gap.', requirement_id: 'r2' }
    ] });
    assert.equal(result.hard_gates[1].source, 'preferred');
    assert.equal(result.eligibility, 'pass');
});

test('a required requirement cannot be hidden behind preferred source', () => {
    const result = normalize({ hard_gates: [{ gate: 'degree', source: 'preferred', status: 'fails', note: 'Synthetic required degree gap.', requirement_id: 'r1' }] });
    assert.equal(result.hard_gates[0].source, 'requirement');
    assert.equal(result.eligibility, 'fail');
    assert.equal(result.tier, 'excluded');
});

test('unknown requirement references are rejected', () => {
    assert.throws(() => normalize({ hard_gates: [{ gate: 'tool', source: 'requirement', status: 'meets', note: 'Synthetic invalid reference.', requirement_id: 'absent' }] }), { code: 'invalid_requirement_reference' });
});

test('a responsibility cannot be relabeled as a hard qualification gate', () => {
    assert.throws(() => normalize({ hard_gates: [{ gate: 'tool', source: 'requirement', status: 'fails', note: 'Synthetic duty is not a qualification.', requirement_id: 'duty' }] }, {
        requirements: [...job.requirements, { id: 'duty', kind: 'responsibility', text: 'Coordinate synthetic product work.' }]
    }), { code: 'invalid_gate_source' });
});

test('graduation minimum of 2028 excludes a confirmed 2027 graduate', () => {
    const result = normalize({}, { graduation_min_year: 2028 }, { graduation_year: 2027 });
    assert.equal(result.eligibility, 'fail');
    assert.equal(result.tier, 'excluded');
    assert.equal(result.hard_gates.find(g => g.gate === 'graduation').status, 'fails');
    assert.equal(isRecommendable(result), false);
});

test('graduation bounds include their boundary years', () => {
    const result = normalize({}, { graduation_min_year: 2027, graduation_max_year: 2027 }, { graduation_year: 2027 });
    assert.equal(result.eligibility, 'pass');
});

test('missing candidate graduation data keeps required graduation unknown', () => {
    const result = normalize({}, { graduation_min_year: 2027 });
    assert.equal(result.eligibility, 'unknown');
    assert.equal(result.tier, 'qualification_hold');
});

test('invalid graduation bounds are rejected instead of creating a fake exclusion', () => {
    assert.throws(() => normalize({}, { graduation_min_year: 2028, graduation_max_year: 2027 }, { graduation_year: 2027 }), { code: 'invalid_qualification_range' });
});

test('insufficient internship days exclude despite strong product evidence', () => {
    const result = normalize({}, { availability: { days_per_week: 4, continuous_months: 6 } }, { availability: { days_per_week: 2, continuous_months: 6 } });
    assert.equal(result.eligibility, 'fail');
    assert.equal(result.tier, 'excluded');
});

test('candidate start later than required latest start excludes', () => {
    const result = normalize({}, { availability: { latest_start: '2027-01-01' } }, { availability: { earliest_start: '2027-02-01' } });
    assert.equal(result.eligibility, 'fail');
    assert.equal(result.tier, 'excluded');
});

test('explicit unavailable location excludes without parsing the title', () => {
    const result = normalize({}, { availability: { location: 'Synthetic City A' } }, { availability: { location: 'Synthetic City B' } });
    assert.equal(result.eligibility, 'fail');
});

test('partially known availability cannot become a hard pass', () => {
    const result = normalize({}, { availability: { days_per_week: 4, continuous_months: 6 } }, { availability: { days_per_week: 4 } });
    assert.equal(result.eligibility, 'unknown');
    assert.equal(result.tier, 'qualification_hold');
});

test('candidate current location cannot substitute for confirmed available location', () => {
    const result = normalize({}, { availability: { location: 'Synthetic City A' } }, { current_location: 'Synthetic City B' });
    assert.equal(result.eligibility, 'unknown');
});

test('impossible candidate weekly availability cannot establish a hard pass', () => {
    const result = normalize({}, { availability: { days_per_week: 4 } }, { availability: { days_per_week: 8 } });
    assert.equal(result.eligibility, 'unknown');
});

test('an invalid candidate date remains unknown instead of silently meeting a deadline', () => {
    const result = normalize({}, { availability: { latest_start: '2027-01-01' } }, { availability: { earliest_start: 'not-a-date' } });
    assert.equal(result.eligibility, 'unknown');
});

test('structured and body graduation conflict cannot pass or fail that gate', () => {
    const result = normalize({}, { graduation_min_year: 2028, qualification_conflicts: [{ gate: 'graduation', note: 'Synthetic body says 2027; structured form says 2028.' }] }, { graduation_year: 2027 });
    assert.equal(result.hard_gates.find(g => g.gate === 'graduation').status, 'conflict');
    assert.equal(result.eligibility, 'unknown');
    assert.equal(result.tier, 'qualification_hold');
});

test('an independent clear failure still excludes when another gate conflicts', () => {
    const result = normalize({ hard_gates: [
        { gate: 'degree', source: 'requirement', status: 'fails', note: 'Synthetic degree gap.', requirement_id: 'r1' },
        { gate: 'graduation', source: 'structured_field', status: 'conflict', note: 'Synthetic inconsistent years.' }
    ] });
    assert.equal(result.eligibility, 'fail');
    assert.equal(result.tier, 'excluded');
});

test('a host marked conflict also prevents a derived failure of the same gate', () => {
    const result = normalize({ hard_gates: [
        ...assessment().hard_gates,
        { gate: 'graduation', source: 'requirement', status: 'conflict', note: 'Synthetic body and structured year disagree.' }
    ] }, { graduation_min_year: 2028 }, { graduation_year: 2027 });
    assert.equal(result.eligibility, 'unknown');
    assert.equal(result.tier, 'qualification_hold');
});

test('an unclear service object cannot hide a confirmed hard qualification failure', () => {
    const result = normalize({ service_object: 'unclear' }, { graduation_min_year: 2028 }, { graduation_year: 2027 });
    assert.equal(result.eligibility, 'fail');
    assert.equal(result.tier, 'excluded');
});

test('unknown required gate overrides a host supplied pass', () => {
    const result = normalize({ hard_gates: [{ gate: 'language', source: 'requirement', status: 'unknown', note: 'Synthetic language not verified.' }] });
    assert.equal(result.eligibility, 'unknown');
    assert.equal(result.tier, 'qualification_hold');
});

test('preferred conflict does not block a separately verified required gate', () => {
    const result = normalize({ hard_gates: [
        ...assessment().hard_gates,
        { gate: 'tool', source: 'preferred', status: 'conflict', note: 'Synthetic preferred tool uncertainty.', requirement_id: 'r2' }
    ] });
    assert.equal(result.eligibility, 'pass');
});

test('a developer serving product manager title cannot establish consumer fit', () => {
    const result = normalize({ service_object: 'developer' }, { title: 'Consumer Product Manager' });
    assert.equal(result.tier, 'adjacent');
    assert.equal(result.service_object, 'developer');
});

test('internal service and code deliverables do not receive default priority', () => {
    assert.equal(normalize({ service_object: 'internal_team' }).tier, 'adjacent');
    assert.equal(normalize({ core_deliverable: 'code' }).tier, 'adjacent');
});

test('explicit confirmed direction can support a developer and code priority', () => {
    const result = normalize({ service_object: 'developer', core_deliverable: 'code' }, {}, { preferred_service_objects: ['developer'], preferred_deliverables: ['code'] });
    assert.equal(result.tier, 'priority');
});

test('inferred candidate direction cannot waive the service object restriction', () => {
    const result = normalize({ service_object: 'developer' }, {}, { preferred_service_objects: [{ value: 'developer', level: 'inference' }] });
    assert.equal(result.tier, 'adjacent');
});

test('inference-only and AI-summary-only evidence cannot establish priority', () => {
    for (const level of ['inference', 'ai_summary']) {
        assert.equal(normalize({ evidence_refs: [{ evidence_id: 'synthetic-weak-evidence', level }] }).tier, 'conditional');
    }
});

test('a user statement is stronger than inference without claiming artifact verification', () => {
    const result = normalize({ evidence_refs: [{ evidence_id: 'synthetic-statement', level: 'self_statement' }] });
    assert.equal(result.tier, 'priority');
    assert.equal(result.evidence_refs[0].level, 'self_statement');
});

test('legacy score and pass never substitute for semantic metadata', () => {
    const result = normalizeFitAssessment({ eligibility: 'pass', score: 100, reason: 'Synthetic legacy result.' }, job);
    assert.equal(result.eligibility, 'unknown');
    assert.equal(result.service_object, 'unclear');
    assert.equal(result.tier, 'qualification_hold');
    assert.equal(isRecommendable(result), false);
});

test('empty gates remain unknown unless the host explicitly completed gate review', () => {
    assert.equal(normalize({ hard_gates: [] }).eligibility, 'unknown');
    assert.equal(normalize({ hard_gates: [], gates_complete: true }).eligibility, 'pass');
});

test('gate completion cannot override an unknown required gate', () => {
    const result = normalize({ gates_complete: true, hard_gates: [{ gate: 'portfolio', source: 'requirement', status: 'unknown', note: 'Synthetic portfolio pending.' }] });
    assert.equal(result.eligibility, 'unknown');
});

test('structured degree and major requirements require host semantic checks', () => {
    const result = normalize({ hard_gates: [], gates_complete: true }, { required_degree: 'Synthetic degree', required_majors: ['Synthetic subject'] });
    assert.equal(result.eligibility, 'unknown');
    assert.deepEqual(result.hard_gates.map(g => [g.gate, g.status]), [['degree', 'unknown'], ['major', 'unknown']]);
});

test('unclear service object holds a role even if qualifications meet', () => {
    const result = normalize({ service_object: 'unclear' });
    assert.equal(result.tier, 'qualification_hold');
    assert.equal(isRecommendable(result), false);
});

test('normalization does not mutate host input or caller-owned qualification fields', () => {
    const input = assessment();
    const sourceJob = { ...job, graduation_min_year: 2028 };
    const before = structuredClone({ input, sourceJob });
    normalizeFitAssessment(input, sourceJob, { graduation_year: 2027 });
    assert.deepEqual({ input, sourceJob }, before);
});

test('fit schema permits independent rank and optional full gate review', () => {
    const fields = Object.fromEntries(Object.entries(assessment()).filter(([key]) => Object.hasOwn(fitAssessmentFields, key)));
    validate(O(fitAssessmentFields, ['service_object', 'core_deliverable', 'hard_gates', 'tier', 'evidence_refs']), { ...fields, rank: 7, gates_complete: true });
    assert.throws(() => validate(O(fitAssessmentFields, []), { rank: 1.5 }), { code: 'invalid_arguments' });
    assert.throws(() => validate(O(fitAssessmentFields, []), { service_object: 'guessed_from_title' }), { code: 'invalid_arguments' });
});

test('structured schema accepts explicit latest start without making availability subfields mandatory', () => {
    validate(O(structuredJobFields, []), { graduation_min_year: 2028, required_majors: ['Synthetic subject'], availability: { latest_start: '2027-01-01' }, qualification_conflicts: [{ gate: 'degree', note: 'Synthetic official disagreement.' }] });
});

test('ranking follows tier then host ordinal and ignores old weighted score', () => {
    const rows = [
        { job_id: 'low-rank', tier: 'priority', rank: 2, score: 100 },
        { job_id: 'conditional', tier: 'conditional', rank: 1, score: 1000 },
        { job_id: 'first', tier: 'priority', rank: 1, score: 0 }
    ];
    assert.deepEqual(rows.sort(compareFitAssessments).map(row => row.job_id), ['first', 'low-rank', 'conditional']);
});

test('ranking is deterministic with absent rank and legacy tier', () => {
    const rows = [{ job_id: 'legacy', score: 999 }, { job_id: 'b', tier: 'priority' }, { job_id: 'a', tier: 'priority' }];
    assert.deepEqual(rows.sort(compareFitAssessments).map(row => row.job_id), ['a', 'b', 'legacy']);
});

test('misjudged, held and excluded roles are never recommendable', () => {
    for (const tier of ['misjudged', 'qualification_hold', 'excluded']) assert.equal(isRecommendable(normalize({ tier })), false);
    assert.equal(isRecommendable({ eligibility: 'pass', score: 100 }), false);
});

test('recommendability fails closed for malformed semantic metadata', () => {
    assert.equal(isRecommendable(null), false);
    assert.equal(isRecommendable({ ...normalize(), service_object: 'unrecognized' }), false);
    assert.equal(isRecommendable({ ...normalize(), core_deliverable: 'unrecognized' }), false);
});
