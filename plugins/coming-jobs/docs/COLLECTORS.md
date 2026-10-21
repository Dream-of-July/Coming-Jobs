# Anonymous public catalogue collectors

`plugins/coming-jobs/src/collectors/index.mjs` is a dependency-free ESM helper for an asynchronous host. It does not write to the database, change application state, or make a recommendation. The synchronous MCP service should ingest the reviewed result separately.

All automated verification uses synthetic HTTP responses. No employer catalogue or account was contacted during implementation. These adapters describe public transport shapes; passing fixture tests does not prove that a particular live portal currently permits anonymous access.

## Exports

```js
import {
    collectPublicCatalog,
    refreshPublicLists,
    compareLiveLists,
    compareCoverage, // alias of compareLiveLists
    SUPPORTED_PLATFORMS,
} from './plugins/coming-jobs/src/collectors/index.mjs';

const options = {
    platform: 'oppo',
    entries: [
        { url: 'https://recruitment.example.invalid/all', track: 'campus', campaign: 'all' },
        {
            url: 'https://recruitment.example.invalid/intern',
            track: 'internship', campaign: 'public-project',
            config: { projects: [{ project_id: 'public-project', recruitment_type: 'intern' }] },
        },
    ],
};

// Full list enumeration, then a full-detail read for every unique ID in each entry.
const catalogue = await collectPublicCatalog(options, { fetch: globalThis.fetch });

// Repeat every list page immediately before recommendation, without repeating details.
const live = await refreshPublicLists(options, { fetch: globalThis.fetch });
// Equivalent to collectPublicCatalog({ ...options, list_only: true }, dependencies).
const delta = compareLiveLists(catalogue.coverage.entries, live.coverage.entries);
```

The example addresses and identifiers are synthetic. The caller supplies approved public entrypoints and public tenant/site configuration. There are no employer presets, credentials, browser imports, title filters, or candidate data in this module. Use a separate collection call for each employer; external IDs are deduplicated within that call.

`dependencies.fetch` follows the standard asynchronous Fetch API. `dependencies.now` optionally returns a timestamp for deterministic observations. The helper otherwise uses the current timestamp. Requests run sequentially and have no automatic retries. A host can wrap injected fetch to add an appropriate public request interval.

## Results and completion

The result is `{ platform, observed_at, list_only, jobs, coverage }`.

Full collection returns every listed ID, including roles whose titles do not match a preferred discipline. A job includes `external_id`, `parent_application_id`, `parent_application_ids`, `title`, `platform`, `detail_platform`, `source_url`, `source_urls`, `url`, `jd`, `description`, `duty`, `requirement`, `extra_text`, structured `requirements`, `locations`, `project`, `category`, `track`, `tracks`, `campaign`, `campaigns`, `employment_type`, `observed_at`, and `detail_status`.

The external listing ID remains distinct from a parent requisition/application ID. Repeated listing IDs merge source membership and preserve successful detail content. Different full titles/JDs behind the same ID remain in `detail_variants`, with `detail_status: conflict` and `coverage.detail_conflict_ids`; union completion stays false until the host resolves scope-specific meanings. Do not ingest the preferred variant as an unambiguous qualification snapshot. Distinct listing IDs sharing a parent ID remain distinct jobs. Track and campaign labels come from the supplied entry; titles do not determine them. Public fields such as a vivo project and category remain separate. Tencent topic text and bonus text are retained in the JD. A URL falls back to the public entry when a direct public job link is unavailable. A missing or denied detail stays in the result with `detail_status: 'failed'`; it must not be ingested as a verified full JD.

Details need a title, a matching returned identity when present, and at least 40 characters of actual detail text, consistent with the ingest minimum. A list preview cannot substitute for a missing detail body. This is a minimum transport check, not a semantic guarantee that the portal supplied every requirement. Structured JD rows include duties as `responsibility`, mandatory text as `requirement`, standalone preference lines as `preferred`, and bonus text as `preferred`. A line mixing mandatory and preferred clauses stays `responsibility` with a `mixed_requirement_needs_host_structure` normalization note until the host separates its meaning; it cannot silently turn the preference into a hard qualification gate.

`coverage.entries` preserves input order, including successful empty entries and failed entries. Each record contains:

| Field | Meaning |
| --- | --- |
| `source_url`, `track`, `campaign`, `observed_at` | Public scope and observation timestamp. An invalid/private URL is replaced with `null` rather than retained. |
| `external_ids`, `total` | Distinct observed IDs and the reported list total, or `null` when unavailable. |
| `pages_read`, `pages` | Successfully parsed list responses, with request URL, page/offset, row count, IDs, reported total and reported page count. |
| `duplicate_rows` | Repeated listing IDs, including overlapping page blocks. |
| `details_ok`, `details_failed`, `details_skipped` | Per-entry detail outcomes. List-only refresh skips all details. |
| `list_complete` | Enumeration reached its terminal condition, totals agree, and there was no list failure. |
| `complete` | In full mode, both the list and every detail are complete. In list-only mode, equals successful list completion. |
| `has_more`, `cursor` | Unresolved list work and the page/offset to inspect next. A truncated current page retains its original cursor; this is evidence, not a resumable credential. |
| `status`, `failures` | `complete`, `empty`, `partial`, or `blocked`; failures identify phase, public ID when relevant, stable error code, and HTTP status. Response bodies and authentication material are excluded. |

`coverage` also contains union `external_ids`, `unique_ids`, unresolved union `details_failed`, successful union `details_ok`, `requests`, `list_complete`, `complete`, and `entry_only`. Counts across entrypoints can overlap; per-entry totals must not be summed and presented as a distinct-job total. A successful detail in one entry can resolve the union job while another entry still reports its own failed detail and remains incomplete.

A valid empty public API list records its checked URL, timestamp, zero total and completion. Missing rows, invalid JSON, an access rejection, and an arbitrary HTML page do not become a zero-job result. The helper does not infer the absence of jobs from a page with no known API.

List-only refresh returns `jobs: []`, all observed IDs in coverage, `details_skipped`, and `complete` based on enumeration. This prevents refreshed title cards from masquerading as full-detail jobs. Hosts can directly map the refreshed `coverage.entries` to their `live_entries`; use `list_complete` for list completeness when mixing records from full collection and list-only refresh.

## Platform configuration

All entries accept public `config.api_base` and `config.allowed_origins` when an approved public API uses a different origin. These are explicit caller configuration, not domains discovered from arbitrary redirects. Custom request headers and authentication-related configuration are rejected.

| Platform | Public transport and configuration |
| --- | --- |
| `feishu` | `POST /api/v1/search/job/posts` with limit/offset; `GET /api/v1/job/posts/{id}`. Optional `website_path`, `subject_ids`. No CSRF bootstrap is requested. A portal requiring even an anonymous CSRF token remains blocked under the token-free policy. |
| `moka` | `POST /api/outer/ats-apply/website/jobs/v2`, then `/api/outer/ats-apply/website/job`. Requires public `org_id`, `site_id`; optional `mode`, `locale`. Plain JSON needs no transport key. For encrypted public responses, `public_transport: { public: true, aes_iv: publicPageConfig.aesIv }` must come from the public page configuration, with a 16-byte IV; AES-CBC uses only the key supplied in that public response. The helper does not fetch configuration pages or accept an authentication key. Missing public configuration produces `public_transport_config_required`. |
| `hotjob` | Form POSTs to `/wecruit/positionInfo/listPosition/{tenant}` and `/wecruit/positionInfo/listPositionDetail/{tenant}`. Requires public `tenant`; optional `recruit_type` (default `1`). Default page size is `10`, with a maximum of `50`. IDs, totals and reported pages are checked independently so overlap cannot silently inflate completion. |
| `vivo` | `POST /api/Jobad/GetJobAdPageList`, then `GET /api/JobAd/GetJobAdInfo`. Requires public `portal_id`; optional `categories`, `display_fields`. Page index starts at zero. Projects and categories are public portal fields, not title inferences. |
| `oppo` | `POST /openapi/position/pageNew`, then `GET /openapi/position/detail`. Optional public `tenant_id` and `projects: [{ project_id, recruitment_type }]`. Include unfiltered and public project entries separately to capture their union. |
| `tencent` | `POST /api/v1/position/searchPosition`, then `GET /api/v1/jobDetails/getJobDetailsByPostId`. Optional public `project_mapping_ids`. Explicit Workday-sourced rows use the corresponding public CXS detail endpoint; the original listing ID and Workday requisition ID are both retained. There is no automatic discovery of project mappings. |
| `workday` | Public `/wday/cxs/{tenant}/{site}/jobs` offset pagination and `/job/...` details. Tenant/site are derived from the supplied public career URL. Optional public `cxs_base`, `applied_facets`. Locale prefixes on the public URL are supported. |
| `ashby` | Public `/posting-api/job-board/{board}`. Optional `board`; otherwise derived from the entry path. The standard public board host maps to its public posting API host. Every inline JD is checked; missing inline detail is a failure, not a successful detail read. |

Public entrypoint discovery is the host's responsibility. Include all relevant public campus, internship, language, overseas and unfiltered/project entrypoints explicitly. The adapter cannot prove that an omitted entrypoint has no additional roles. An entry's public configuration may differ between deployments; fixture compatibility is not a guarantee for every portal version.

## Live-list comparison

`compareLiveLists(previousEntries, currentEntries)` is pure and never contacts a site. Both arrays use the common shape `{ source_url, external_ids, complete, track, campaign, observed_at, total? }`.

It returns union `added_ids`, `removed_ids`, `confirmed_removed_ids`, `entry_deltas`, current `entry_only`, `previous_complete`, `current_complete`, `scope_complete`, `chronological`, `complete`, and both observation timestamps. `entry_only` identifies public IDs exclusive to each entry, including internship-only entries; it also preserves track, campaign, completion and observation time.

Apparent removals remain visible when observations are incomplete. `confirmed_removed_ids` is populated only when both observations are complete, all previous entry scopes were refreshed, and the replacement observations are valid and at least as recent. It means disappearance from a fully compared public list, not proof that a job is closed. Changed scope, older observations, denied pages and missing entrypoints do not confirm disappearance. Time ordering does not establish real-time freshness; the host must actually run `refreshPublicLists` and apply its own maximum observation age before recommendation.

## Limits and network boundary

| Option | Default |
| --- | --- |
| `page_size` | `50`, except hotjob `10`; hotjob clamps explicit values to `50` |
| `max_pages` | `100` per entry |
| `max_jobs` | `5000` distinct IDs per call |
| `max_requests` | `1000` per call |
| `max_response_bytes` | `5 MiB` per response |
| `timeout_ms` | `15000` per response, including body reading |
| `max_elapsed_ms` | `300000` per call |

Positive integer limits may be adjusted up to twenty times their defaults. Limits leave explicit incomplete evidence. Two consecutive nonempty pages with no new IDs stop with `pagination_no_progress`; a single overlapping page is tolerated. Unknown totals require a terminal empty page rather than assuming a short page is the end.

Only HTTPS URLs without embedded credentials or private query parameters are accepted. Local/private literal addresses, IPv6 literals and local hostname suffixes are rejected. Fetch always uses `credentials: 'omit'` and `redirect: 'manual'`; no cookies are collected or replayed, no tokens are fetched, and no access-denial workaround is attempted. HTTP 401/403/407/429 and redirects are recorded as blocked without retries. Tencent can read an explicit public `*.myworkdayjobs.com` detail link; other detail origins require explicit public configuration.

This helper is for host-approved public endpoints, not an unrestricted server-side URL proxy. It does not resolve and pin DNS addresses, inspect browser sessions, negotiate CAPTCHA, obtain CSRF tokens, authenticate, or discover hidden/internal APIs. DNS-based network restrictions belong in the host's egress boundary. These omissions are deliberate gaps and must not be described as successful coverage.

Run the synthetic regression checks with:

```sh
cd plugins/coming-jobs
node --no-warnings --test tests/collectors.test.mjs
```
