import { S, B, I, E, A, O, OP } from './core.mjs';
export function dailySchema(JOB, COLLECTION, ASSESSMENT) {
    const approval = { confirmed: B, user_ref: S(1000) }, run = { run_id: S(100), task_id: S(100) };
    const scope = O({ track: E('campus', 'internship', 'experienced'), campaign: S(300), source_url: S(3000) });
    const company = O({ company_id: S(100), name: S(150), aliases: A(S(150), 30), scopes: A(scope, 12),
        introduction: O({ text: S(1500), source_url: S(3000), observed_at: S(80) }),
        priority: I(0, 5), priority_reason: S(1000), origin: E('directory', 'expanded') }, ['name']);
    return { oneOf: [
        OP('configure', { enabled: B, settings: O({ timezone: S(100), time: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
            target_companies: I(1, 5), metadata_limit: I(1, 100), company_limit: I(1, 5), assessment_limit: I(1, 1000), minutes: I(1, 120), expansion_limit: I(0, 1), intro_days: I(1, 90) }, []), ...approval }, ['confirmed', 'user_ref']),
        OP('company', { company, ...run }, ['company']),
        OP('opportunity', { company_id: S(100), track: E('campus', 'internship', 'experienced'), campaign: S(300), limit: I(0, 100), exhausted: B,
            can_change: B, volunteer_order: E('ordered', 'parallel', 'unknown'), deadline: S(80),
            source: E('official', 'user_report'), source_ref: S(2000), observed_at: S(80) }, ['company_id', 'track', 'campaign', 'source', 'source_ref', 'observed_at']),
        OP('link_application', { application_id: S(100), company_id: S(100), track: E('campus', 'internship', 'experienced'), campaign: S(300), source: E('official', 'user_report'), source_ref: S(2000), observed_at: S(80) }),
        OP('status', { mode: E('live', 'demo') }, []), OP('start', { mode: E('live', 'demo') }, []), OP('next', { run_id: S(100), limit: I(1, 3) }, ['run_id']),
        OP('observe', { ...run, state: E('done', 'partial', 'blocked'), changed: B, deadline: S(80), fingerprint: S(200),
            change_basis: E('complete_jd_manifest', 'revalidated_details', 'unknown'), live_entries: COLLECTION.properties.live_entries, live_checked_at: S(80), cursor: S(1000), reason: S(1000) }, ['run_id', 'task_id', 'state']),
        OP('ingest', { ...run, jobs: A(JOB, 100), collection: COLLECTION, cursor: S(1000) }, ['run_id', 'task_id', 'jobs', 'collection']),
        OP('assess', { ...run, assessments: A(ASSESSMENT, 10) }), OP('report', { run_id: S(100) }),
        OP('acknowledge', { report_id: S(100), result_ref: S(1000) }),
        OP('feedback', { company_id: S(100), mode: E('live', 'demo'), decision: E('save', 'reject', 'defer'), until: S(80), ...approval }, ['company_id', 'decision', 'confirmed', 'user_ref']),
        OP('choose', { report_id: S(100), label: E('A', 'B', 'C', 'D', 'E'), role_number: I(1, 3), ...approval }),
        OP('bind', { host_success: B, provider_task_id: S(300), target_thread_id: S(100), result_ref: S(1000) }),
        OP('health', { state: E('paused', 'failed', 'needs_rebind', 'host_reported_active'), result_ref: S(1000) })
    ] };
}
