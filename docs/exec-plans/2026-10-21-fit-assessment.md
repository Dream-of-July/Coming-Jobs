# Independent job-fit assessment

## Intent and evidence

Replace title/keyword and numeric-match ranking with evidence-graded, duty-based assessment shared by company comparison and daily recommendations. Keep all candidate information in private workspaces. This change does not log into portals, upload materials, submit applications, or migrate the operator's real workspace.

Base: main `5b27191`. Baseline: 212 tests passed after allowing the local HTTP test server; the restricted run had three loopback-listening permission failures.

## Design

- One optional, backwards-compatible assessment extension in the tool registry; normalize legacy records to unknown qualification rather than silently approving missing fields.
- Required/structured hard gates determine eligibility; preferred qualifications never fail eligibility. Unknown/conflicting qualifications are held. Evidence limited to inference cannot justify priority.
- Candidate availability and capability breadth/depth remain confirmed private facts. Service audience and deliverables are explicit semantic decisions, not inferred from titles.
- Reuse the company/scope opportunity ledger, extend amendment/order/deadline provenance, and suppress exhausted quotas and previously applied roles.
- Anonymous platform adapters collect all pages/details, merge entry points, and expose failures and live-list deltas. No authenticated data, imported browser state, or access-denial bypass.
- Separate resumable company comparison (up to 20 companies) from the existing daily budget. Seal independent ranking before reading prior rankings; render evidence/gates/reasons and categorized differences without scores.
- Keep collection instructions in discovery-and-daily-goals; place assessment, evidence, gates and output in fit-assessment.

## Milestones

1. Pure fit model and synthetic gate tests.
2. Anonymous platform adapters and synthetic collection tests.
3. Independent comparison workflow, cursor/budget, immutable snapshot, diff and synthetic end-to-end demo.
4. Registry, private profile, opportunities, jobs/daily, compatibility and migration integration.
5. Documentation, complete suite, public-data check, review, branch push and PR.

## Validation and recovery

Test each module through observable behavior, then the tool boundary and complete suite. Exercise a synthetic candidate and company catalog through the comparison tool and include the report in the PR. Run scripts/check-public.mjs and inspect the staged diff for copied private attachments or secrets. Preserve existing contracts where possible; missing new assessment information requires re-assessment. No plugin installation or live-workspace mutation. Revert the feature branch to recover code; no external application state is changed.

## Progress

- [x] Read method and designated implementation, pull main, branch, baseline.
- [x] Implement and integrate modules.
- [x] Synthetic end-to-end report and all tests: 339/339; 128 added synthetic cases and one wording-only check removed.
- [x] Public-data check and independent integration review; confirmed issues fixed with regression coverage.
- Initial branch/PR delivery left merging to the repository owner. A subsequent authorized maintenance pass checks the current PR head and all CI jobs before merging and installing.

Pre-merge maintenance: corrected global daily rank comparisons and nullable opportunity-rule updates, preserved recruitment-track aliases and historical report recovery, and added ten synthetic regression cases. Package beta.13 has a distinct immutable install directory; it does not overwrite beta.10–beta.12.

Validation: single-company/three-role and twenty-company/57-role tool replays completed offline; the latter resumed after five companies without budget reset. Public-data check found no patterns across 118 files. Skill frontmatter and references checked. Real portal compatibility, missing public-entry discovery, and semantic truth of external candidate materials remain host responsibilities; no live portal or real workspace was accessed.
