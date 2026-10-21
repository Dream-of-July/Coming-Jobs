import { adapterFor, detailText, externalId, normalizeJob, SUPPORTED_PLATFORMS, validateDetailIdentity } from './adapters.mjs';
import { CollectionError, errorRecord, fail, publicConfig, publicUrl, safeUrl, transport } from './transport.mjs';

export { SUPPORTED_PLATFORMS };
const unique = values => [...new Set(values)];
const sorted = values => unique(values).sort();
const defaults = { page_size: 50, max_pages: 100, max_jobs: 5000, max_requests: 1000, max_response_bytes: 5 * 1024 * 1024, timeout_ms: 15000, max_elapsed_ms: 300000 };
function limitsFor(options) {
    const limits = {};
    for (const [key, fallback] of Object.entries(defaults)) {
        const value = options[key] ?? (key === 'page_size' && options.platform === 'hotjob' ? 10 : fallback);
        if (!Number.isSafeInteger(value) || value < 1 || value > fallback * 20) fail('invalid_collection_limit');
        limits[key] = value;
    }
    return limits;
}
function entryRecord(entry, observedAt) {
    return { source_url: safeUrl(entry?.url), track: entry?.track ?? 'unknown', campaign: entry?.campaign ?? null,
        observed_at: observedAt, external_ids: [], total: null, pages_read: 0, pages: [], duplicate_rows: 0,
        details_ok: 0, details_failed: 0, details_skipped: 0, failures: [], complete: false, list_complete: false, has_more: true, cursor: { page: 1, offset: 0 }, status: 'partial' };
}
function mergeJob(old, next) {
    if (!old) return { ...next, parent_application_ids: next.parent_application_id ? [next.parent_application_id] : [] };
    const preferred = old.detail_status === 'ok' ? old : next;
    const variant = job => Object.fromEntries(['source_url','track','campaign','title','jd','requirements','locations','parent_application_id','observed_at'].map(key=>[key,job[key]]));
    const variants = [...(old.detail_variants ?? (old.detail_status==='ok'?[variant(old)]:[])), ...(next.detail_status==='ok'?[variant(next)]:[])];
    const conflict = old.detail_status==='conflict' || new Set(variants.map(v=>JSON.stringify([v.title,v.jd]))).size>1;
    return { ...preferred, source_url: old.source_url,
        ...(conflict ? { detail_status:'conflict', detail_variants:variants } : {}),
        source_urls: unique([...old.source_urls, ...next.source_urls]), tracks: unique([...old.tracks, ...next.tracks]), campaigns: unique([...old.campaigns, ...next.campaigns]),
        parent_application_ids: unique([...old.parent_application_ids, ...(next.parent_application_id ? [next.parent_application_id] : [])]) };
}

/** Anonymous, asynchronous collection. It does not write to the service or disk. */
export async function collectPublicCatalog(options, dependencies = {}) {
    if (!options || !Array.isArray(options.entries)) fail('collection_entries_required');
    if (options.list_only !== undefined && typeof options.list_only !== 'boolean') fail('invalid_collection_mode');
    const platform = String(options.platform ?? '').toLowerCase();
    const limits = limitsFor(options), client = transport(limits, dependencies);
    const observedAt = new Date((dependencies.now ?? (() => new Date().toISOString()))()).toISOString();
    const entries = [], jobs = new Map(), observedIds = new Set();
    for (const supplied of options.entries) {
        const record = entryRecord(supplied, observedAt), listed = new Map();
        entries.push(record);
        let adapter, entry;
        try {
            publicConfig(supplied);
            entry = { ...supplied, url: publicUrl(supplied.url) };
            adapter = adapterFor(platform, entry, limits.page_size);
            let cursor = { page: 1, offset: 0 }, done = false, noProgress = 0;
            while (!done) {
                if (record.pages_read >= limits.max_pages) fail('page_budget_exhausted');
                const spec = adapter.list(cursor);
                const response = adapter.decode(await client.request(spec, adapter.allowedOrigins));
                const page = adapter.parseList(response);
                if (page.total !== null && page.total !== undefined) {
                    if (record.total !== null && record.total !== page.total) record.failures.push(errorRecord(new CollectionError('list_total_changed'), 'list'));
                    record.total = page.total;
                }
                const ids = [], beforePage = listed.size;
                record.pages.push({ page: cursor.page, offset: cursor.offset, url: spec.url, row_count: page.rows.length,
                    external_ids: ids, total: page.total ?? null, total_pages: page.total_pages ?? null,
                    ...(adapter.inline ? { detail_transport: 'inline' } : {}) });
                record.pages_read++;
                for (const row of page.rows) {
                    const id = externalId(row, platform);
                    if (!observedIds.has(id) && observedIds.size >= limits.max_jobs) fail('job_budget_exhausted');
                    observedIds.add(id);
                    if (!ids.includes(id)) ids.push(id);
                    if (listed.has(id)) record.duplicate_rows++;
                    else listed.set(id, row);
                }
                cursor = { page: cursor.page + 1, offset: cursor.offset + page.rows.length };
                record.cursor = cursor;
                if (record.total !== null && listed.size > record.total) fail('list_total_mismatch');
                const reachedTotal = record.total !== null && listed.size >= record.total;
                done = page.has_more === false || !page.rows.length || reachedTotal && (!page.total_pages || record.pages_read >= page.total_pages);
                noProgress = listed.size === beforePage && page.rows.length ? noProgress + 1 : 0;
                if (!done && noProgress >= 2) fail('pagination_no_progress');
                if (done && record.total !== null && listed.size !== record.total) fail('list_total_mismatch');
                if (done && !record.failures.length) {
                    record.list_complete = true;
                    record.has_more = false;
                    record.cursor = null;
                }
            }
        } catch (error) {
            record.failures.push(errorRecord(error, 'list'));
        }
        record.external_ids = [...listed.keys()];
        if (options.list_only) record.details_skipped = listed.size;
        if (adapter && entry && !options.list_only) {
            for (const [externalId, row] of listed) {
                let detail = null, detailPlatform = platform;
                try {
                    if (adapter.inline) detail = adapter.parseDetail(row);
                    else {
                        const spec = adapter.detail(row);
                        detailPlatform = spec.detail_platform ?? platform;
                        detail = adapter.parseDetail(adapter.decode(await client.request(spec, adapter.allowedOrigins)));
                    }
                    validateDetailIdentity(platform, row, detail, detailPlatform);
                    const job = normalizeJob(platform, entry, row, detail, adapter, observedAt, detailPlatform);
                    if (!job.title) fail('detail_title_missing');
                    const fullBody = detailText(detail).jd;
                    if (!fullBody) fail('detail_body_missing');
                    if (fullBody.length < 40) fail('detail_body_incomplete');
                    record.details_ok++;
                    jobs.set(externalId, mergeJob(jobs.get(externalId), job));
                } catch (error) {
                    record.details_failed++;
                    record.failures.push(errorRecord(error, 'detail', externalId));
                    const job = normalizeJob(platform, entry, row, null, adapter, observedAt, detailPlatform);
                    jobs.set(externalId, mergeJob(jobs.get(externalId), job));
                }
            }
        }
        record.complete = record.list_complete && !record.details_failed && !record.failures.length && (options.list_only || record.details_ok === listed.size);
        record.status = record.complete ? (listed.size ? 'complete' : 'empty') : record.failures.some(f => f.blocked) ? 'blocked' : 'partial';
    }
    const externalIds = unique(entries.flatMap(e => e.external_ids));
    const coverage = { entries, observed_at: observedAt, external_ids: externalIds, unique_ids: externalIds.length,
        details_ok: [...jobs.values()].filter(j => j.detail_status === 'ok').length,
        details_failed: [...jobs.values()].filter(j => j.detail_status !== 'ok').length,
        requests: client.state.requests, complete: !!entries.length && entries.every(e => e.complete) && ![...jobs.values()].some(j=>j.detail_status==='conflict'),
        detail_conflict_ids: [...jobs.values()].filter(j=>j.detail_status==='conflict').map(j=>j.external_id),
        list_complete: !!entries.length && entries.every(e => e.list_complete), entry_only: exclusiveEntries(entries) };
    return { platform, observed_at: observedAt, list_only: options.list_only === true, jobs: [...jobs.values()], coverage };
}

/** Fresh list observations for recommendation checks, without fetching details again. */
export function refreshPublicLists(options, dependencies = {}) {
    return collectPublicCatalog({ ...options, list_only: true }, dependencies);
}

const entryKey = entry => JSON.stringify([entry.source_url, entry.track ?? 'unknown', entry.campaign ?? null]);
function exclusiveEntries(entries) {
    return entries.map((entry, index) => {
        const elsewhere = new Set(entries.filter((_, n) => n !== index).flatMap(e => e.external_ids));
        return { source_url: entry.source_url, track: entry.track ?? 'unknown', campaign: entry.campaign ?? null,
            external_ids: sorted(entry.external_ids.filter(id => !elsewhere.has(id))), complete: entry.complete === true, observed_at: entry.observed_at ?? null };
    });
}
function listEntries(entries) {
    if (!Array.isArray(entries)) fail('invalid_live_lists');
    const result = new Map();
    for (const entry of entries) {
        if (!entry || typeof entry.source_url !== 'string' || !Array.isArray(entry.external_ids) || entry.external_ids.some(id => !['string', 'number'].includes(typeof id))) fail('invalid_live_lists');
        const normalized = { ...entry, external_ids: sorted(entry.external_ids.map(String)) };
        const key = entryKey(normalized), old = result.get(key);
        result.set(key, old ? { ...normalized, complete: old.complete === true && normalized.complete === true, external_ids: sorted([...old.external_ids, ...normalized.external_ids]) } : normalized);
    }
    return [...result.values()];
}
const latest = entries => {
    const values = entries.map(e => Date.parse(e.observed_at)).filter(Number.isFinite);
    return values.length ? new Date(Math.max(...values)).toISOString() : null;
};

/** Compare observations only; even confirmed disappearance is not a closure claim. */
export function compareLiveLists(previousEntries, currentEntries) {
    const previous = listEntries(previousEntries), current = listEntries(currentEntries);
    const previousMap = new Map(previous.map(e => [entryKey(e), e])), currentMap = new Map(current.map(e => [entryKey(e), e]));
    const before = new Set(previous.flatMap(e => e.external_ids)), after = new Set(current.flatMap(e => e.external_ids));
    const previousComplete = !!previous.length && previous.every(e => e.complete === true);
    const currentComplete = !!current.length && current.every(e => e.complete === true);
    const scopeComplete = [...previousMap.keys()].every(key => currentMap.has(key));
    const chronological = [...previousMap].every(([key, old]) => Number.isFinite(Date.parse(old.observed_at)) &&
        Number.isFinite(Date.parse(currentMap.get(key)?.observed_at)) && Date.parse(currentMap.get(key).observed_at) >= Date.parse(old.observed_at));
    const complete = previousComplete && currentComplete && scopeComplete && chronological;
    const removed = sorted([...before].filter(id => !after.has(id)));
    const entryDeltas = unique([...previousMap.keys(), ...currentMap.keys()]).map(key => {
        const a = previousMap.get(key), b = currentMap.get(key), base = b ?? a;
        const previousIds = new Set(a?.external_ids ?? []), currentIds = new Set(b?.external_ids ?? []);
        return { source_url: base.source_url, track: base.track ?? 'unknown', campaign: base.campaign ?? null,
            added_ids: sorted([...currentIds].filter(id => !previousIds.has(id))), removed_ids: sorted([...previousIds].filter(id => !currentIds.has(id))),
            complete: a?.complete === true && b?.complete === true && Number.isFinite(Date.parse(a.observed_at)) && Date.parse(b.observed_at) >= Date.parse(a.observed_at), previous_complete: a?.complete === true, current_complete: b?.complete === true,
            previous_observed_at: a?.observed_at ?? null, current_observed_at: b?.observed_at ?? null };
    });
    return { added_ids: sorted([...after].filter(id => !before.has(id))), removed_ids: removed,
        confirmed_removed_ids: complete ? removed : [], entry_deltas: entryDeltas, entry_only: exclusiveEntries(current),
        previous_complete: previousComplete, current_complete: currentComplete, scope_complete: scopeComplete, chronological, complete,
        previous_observed_at: latest(previous), current_observed_at: latest(current) };
}
export const compareCoverage = compareLiveLists;
