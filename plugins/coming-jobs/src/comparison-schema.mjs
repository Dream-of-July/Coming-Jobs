import { S, B, I, E, A, O, OP } from './core.mjs';

/** A comparison has its own lifetime and cumulative budget; it is not a daily run. */
export function comparisonSchema(JOB, COLLECTION, ASSESSMENT) {
    const run = { run_id: S(100) }, task = { ...run, task_id: S(100) };
    return { oneOf: [
        OP('start', { comparison_key: S(150), company_ids: { ...A(S(100), 20), minItems: 1 }, mode: E('live', 'demo'),
            limits: O({ details: I(0, 10000), assessments: I(0, 10000), batch_size: I(1, 100) }, []), timezone: S(100) }, ['comparison_key', 'company_ids']),
        OP('next', { ...run, limit: I(1, 20) }, ['run_id']),
        OP('ingest', { ...task, jobs: A(JOB, 100), collection: COLLECTION, cursor: S(1000) }, ['run_id', 'task_id', 'jobs', 'collection']),
        OP('assess', { ...task, assessments: A(ASSESSMENT, 100) }),
        OP('observe', { ...task, state: E('done', 'collect', 'partial', 'blocked'), cursor: S(1000), reason: S(2000) }, ['run_id', 'task_id', 'state']),
        OP('seal', { ...run, allow_partial: B, reason: S(2000) }, ['run_id']),
        OP('previous', { ...run, previous_run_id: S(100), previous_batch_id: S(100) }, ['run_id']),
        OP('report', run)
    ] };
}
