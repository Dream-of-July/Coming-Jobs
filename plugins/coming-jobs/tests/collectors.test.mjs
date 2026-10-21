import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';

const moduleUrl = new URL('../src/collectors/index.mjs', import.meta.url);
const load = () => import(moduleUrl);
const observed = '2026-10-21T12:00:00.000Z';
const entry = (url, config = {}, track = 'campus', campaign = 'synthetic') => ({ url, config, track, campaign });
function fixture(steps) {
    let at = 0;
    const failures = [];
    const fetch = async (url, init) => {
        try {
        const step = steps[at++];
        assert(step, `Unexpected request ${url}`);
        assert.equal(String(url), step.url);
        assert.equal(init.method, step.method ?? 'GET');
        assert.equal(init.credentials, 'omit');
        assert.equal(init.redirect, 'manual');
        assert(!Object.keys(init.headers).some(k => /cookie|authorization|token|csrf/i.test(k)));
        if (step.body) assert.deepEqual(JSON.parse(init.body), step.body);
        if (step.form) assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), step.form);
        return new Response(JSON.stringify(step.response ?? {}), {
            status: step.status ?? 200, headers: { 'content-type': 'application/json', ...step.headers },
        });
        } catch (error) { failures.push(error); throw error; }
    };
    fetch.verify = () => { if (failures.length) throw failures[0]; assert.equal(at, steps.length, 'Expected requests were skipped'); };
    return fetch;
}
const run = async (options, steps) => {
    const fetch = fixture(steps);
    const result = await (await load()).collectPublicCatalog(options, { fetch, now: () => observed });
    fetch.verify();
    return result;
};

test('exports an asynchronous collector and a pure live-list comparison', async () => {
    const api = await load();
    assert.equal(typeof api.collectPublicCatalog, 'function');
    assert.deepEqual(api.compareLiveLists([], []).added_ids, []);
});
test('different full JDs behind a shared ID retain variants and cannot silently complete a merged catalogue', async () => {
    const out=await run({platform:'ashby',entries:[entry('https://ashby.invalid/campus',{},'campus','synthetic'),entry('https://ashby.invalid/intern',{},'internship','synthetic')]},[
        {url:'https://ashby.invalid/posting-api/job-board/campus',response:{jobs:[{id:'shared',title:'Public product role',descriptionPlain:'Define public product requirements and validate a complete consumer interaction prototype.'}]}},
        {url:'https://ashby.invalid/posting-api/job-board/intern',response:{jobs:[{id:'shared',title:'Public product role',descriptionPlain:'Only the next graduating cohort may apply. Work onsite five days per week for six months.'}]}}
    ]);
    assert.equal(out.jobs.length,1);assert.equal(out.coverage.unique_ids,1);
    assert.equal(out.coverage.complete,false);assert.equal(out.jobs[0].detail_status,'conflict');
    assert.deepEqual(out.jobs[0].detail_variants.map(v=>v.track),['campus','internship']);
    assert.match(out.jobs[0].detail_variants[1].jd,/next graduating cohort/);
});

test('Feishu reads anonymous list and every full detail without a title filter', async () => {
    const out = await run({ platform: 'feishu', entries: [entry('https://feishu.invalid/portal', { website_path: 'portal' })] }, [
        { url: 'https://feishu.invalid/api/v1/search/job/posts', method: 'POST', response: { code: 0, data: { count: 2, job_post_list: [{ id: 'a', title: 'Product' }, { id: 'b', title: 'Unusual role' }] } } },
        { url: 'https://feishu.invalid/api/v1/job/posts/a?portal_type=6&with_recommend=false', response: { code: 0, data: { job_post: { id: 'a', title: 'Product', description: 'Study product behavior.', requirement: 'Explain the research.', job: { id: 'parent-a' } } } } },
        { url: 'https://feishu.invalid/api/v1/job/posts/b?portal_type=6&with_recommend=false', response: { code: 0, data: { job_post: { id: 'b', title: 'Unusual role', description: 'Measure the equipment.', requirement: 'Understand the process.' } } } },
    ]);
    assert.deepEqual(out.jobs.map(j => j.external_id), ['a', 'b']);
    assert.equal(out.jobs[0].parent_application_id, 'parent-a');
    assert(out.jobs[0].jd.includes('Explain the research.'));
    assert.equal(out.coverage.complete, true);
    assert.equal(out.coverage.details_ok, 2);
});

test('normalized JD rows preserve responsibilities, mandatory requirements, preferences, and mixed clauses', async () => {
    const out = await run({ platform: 'tencent', entries: [entry('https://tencent.invalid/jobs')] }, [
        { url: 'https://tencent.invalid/api/v1/position/searchPosition', method: 'POST', response: { status: 0, data: { count: 1, positionList: [{ postId: 'a', positionTitle: 'Public role' }] } } },
        { url: 'https://tencent.invalid/api/v1/jobDetails/getJobDetailsByPostId?postId=a', response: { status: 0, data: {
            postId: 'a', title: 'Public role', desc: '负责调研公开产品的使用流程，并清楚说明研究发现。',
            request: '必须能清楚表达研究结论。\n有相关研究经验者优先。\n必须完成分析，相关行业经验优先。',
            graduateBonus: '参与过服务设计研究可加分。',
        } } },
    ]);
    const requirements = out.jobs[0].requirements;
    assert.equal(requirements.find(r => r.text.startsWith('负责调研')).kind, 'responsibility');
    assert.equal(requirements.find(r => r.text === '必须能清楚表达研究结论。').kind, 'requirement');
    assert.equal(requirements.find(r => r.text === '有相关研究经验者优先。').kind, 'preferred');
    assert.equal(requirements.find(r => r.text === '参与过服务设计研究可加分。').kind, 'preferred');
    assert.equal(requirements.find(r => r.text === '必须完成分析，相关行业经验优先。').kind, 'responsibility');
    assert(out.jobs[0].normalization_notes.some(n => n.code === 'mixed_requirement_needs_host_structure'));
    assert.equal(out.coverage.complete, true);
});

test('hotjob deduplicates overlapping pages and respects the reported last page', async () => {
    const out = await run({ platform: 'hotjob', page_size: 100, entries: [entry('https://hotjob.invalid/synthetic/pb', { tenant: 'synthetic', recruit_type: 1 })] }, [
        ...[
            { pageData: [{ postId: 'a', postName: 'One' }, { postId: 'b', postName: 'Two' }], totalPage: 3, dataCount: 3 },
            { pageData: [{ postId: 'b', postName: 'Two' }], totalPage: 3, dataCount: 3 },
            { pageData: [{ postId: 'c', postName: 'Three' }], totalPage: 3, dataCount: 3 },
        ].map((pageForm, i) => ({ url: 'https://hotjob.invalid/wecruit/positionInfo/listPosition/synthetic', method: 'POST', form: { isFrompb: 'true', recruitType: '1', pageSize: '50', currentPage: String(i + 1) }, response: { state: 200, data: { pageForm } } })),
        ...['a', 'b', 'c'].map(postId => ({ url: 'https://hotjob.invalid/wecruit/positionInfo/listPositionDetail/synthetic', method: 'POST', response: { state: 200, data: { postId, workContent: 'Perform role duties.', serviceCondition: 'Understand this discipline.' } } })),
    ]);
    assert.equal(out.jobs.length, 3);
    assert.equal(out.coverage.entries[0].duplicate_rows, 1);
    assert.equal(out.coverage.entries[0].pages_read, 3);
    assert.equal(out.coverage.complete, true);
});

test('hotjob defaults to a small page size that tolerates overlapping first-page blocks', async () => {
    const out = await run({ platform: 'hotjob', entries: [entry('https://hotjob.invalid/synthetic', { tenant: 'synthetic' })] }, [
        { url: 'https://hotjob.invalid/wecruit/positionInfo/listPosition/synthetic', method: 'POST', form: { isFrompb: 'true', recruitType: '1', pageSize: '10', currentPage: '1' }, response: { state: 200, data: { pageForm: { pageData: [], totalPage: 0, dataCount: 0 } } } },
    ]);
    assert.equal(out.coverage.complete, true);
});

test('list-only refresh reads every current page and never refetches full details', async () => {
    const api = await load();
    const steps = [
        { url: 'https://oppo.invalid/openapi/position/pageNew', method: 'POST', response: { code: 0, data: { total: 2, pages: 2, records: [{ idRecruitPosition: 'a', positionName: 'One' }] } } },
        { url: 'https://oppo.invalid/openapi/position/pageNew', method: 'POST', response: { code: 0, data: { total: 2, pages: 2, records: [{ idRecruitPosition: 'b', positionName: 'Two' }] } } },
    ];
    const fetch = fixture(steps);
    const out = await api.refreshPublicLists({ platform: 'oppo', entries: [entry('https://oppo.invalid/jobs')] }, { fetch, now: () => observed });
    fetch.verify();
    assert.deepEqual(out.jobs, []);
    assert.equal(out.list_only, true);
    assert.deepEqual(out.coverage.external_ids, ['a', 'b']);
    assert.equal(out.coverage.complete, true);
    assert.equal(out.coverage.entries[0].details_skipped, 2);
    assert.equal(out.coverage.details_ok, 0);
});

test('repeated pages stop with an explicit incomplete-list reason after a tolerated overlap', async () => {
    const out = await run({ platform: 'oppo', entries: [entry('https://oppo.invalid/jobs')] }, [
        ...[1, 2, 3].map(() => ({ url: 'https://oppo.invalid/openapi/position/pageNew', method: 'POST', response: { code: 0, data: { total: 9, records: [{ idRecruitPosition: 'a', positionName: 'One' }] } } })),
        { url: 'https://oppo.invalid/openapi/position/detail?id=a', response: { code: 0, data: { positionDesc: 'Explore this discipline.' } } },
    ]);
    assert.equal(out.coverage.entries[0].pages_read, 3);
    assert.equal(out.coverage.entries[0].failures[0].code, 'pagination_no_progress');
    assert.equal(out.coverage.complete, false);
});

test('vivo preserves custom project and job-category fields separately', async () => {
    const out = await run({ platform: 'vivo', entries: [entry('https://vivo.invalid/campus', { portal_id: 'public-portal', categories: [2] })] }, [
        { url: 'https://vivo.invalid/api/Jobad/GetJobAdPageList', method: 'POST', response: { Code: 200, Count: 1, Data: [{ Id: 'v1', JobAdName: 'Experience', ClassificationOne: 'Synthetic graduate project', ClassificationTwo: 'Research' }] } },
        { url: 'https://vivo.invalid/api/JobAd/GetJobAdInfo?jobAdId=v1&category=2&portalId=public-portal&displayFields=%5B%22JobAdName%22%2C%22Duty%22%2C%22Require%22%2C%22LocNames%22%2C%22Category%22%2C%22ClassificationOne%22%2C%22ClassificationTwo%22%5D', response: { Code: 200, Data: { Id: 'v1', JobAdName: 'Experience', Duty: 'Study a workflow.', Require: 'Explain findings clearly.', LocNames: ['Synthetic City'], ClassificationOne: 'Synthetic graduate project', ClassificationTwo: 'Research' } } },
    ]);
    assert.equal(out.jobs[0].project, 'Synthetic graduate project');
    assert.equal(out.jobs[0].category, 'Research');
    assert.deepEqual(out.jobs[0].locations, ['Synthetic City']);
    assert.equal(out.coverage.complete, true);
});

test('OPPO unions unfiltered and project entries and keeps internship-only IDs', async () => {
    const out = await run({ platform: 'oppo', entries: [entry('https://oppo.invalid/all', {}, 'campus', 'all'), entry('https://oppo.invalid/intern', { projects: [{ project_id: 'p', recruitment_type: 'intern' }] }, 'internship', 'intern')] }, [
        { url: 'https://oppo.invalid/openapi/position/pageNew', method: 'POST', response: { code: 0, data: { total: 2, pages: 1, records: [{ idRecruitPosition: 'a', positionName: 'One' }, { idRecruitPosition: 'b', positionName: 'Two' }] } } },
        ...['a', 'b'].map(id => ({ url: `https://oppo.invalid/openapi/position/detail?id=${id}`, response: { code: 0, data: { idRecruitPosition: id, positionDesc: 'Study the role.', positionRequire: 'Explain your reasoning.' } } })),
        { url: 'https://oppo.invalid/openapi/position/pageNew', method: 'POST', response: { code: 0, data: { total: 2, pages: 1, records: [{ idRecruitPosition: 'b', positionName: 'Two' }, { idRecruitPosition: 'c', positionName: 'Third' }] } } },
        ...['b', 'c'].map(id => ({ url: `https://oppo.invalid/openapi/position/detail?id=${id}`, response: { code: 0, data: { idRecruitPosition: id, positionDesc: 'Study the role.', positionRequire: 'Explain your reasoning.' } } })),
    ]);
    assert.deepEqual(out.jobs.map(j => j.external_id), ['a', 'b', 'c']);
    assert.deepEqual(out.jobs.find(j => j.external_id === 'b').tracks, ['campus', 'internship']);
    assert.deepEqual(out.coverage.entry_only.find(e => e.source_url.endsWith('/intern')).external_ids, ['c']);
    assert.equal(out.coverage.complete, true);
});

test('Tencent follows an explicit public Workday listing while retaining its application ID', async () => {
    const out = await run({ platform: 'tencent', entries: [entry('https://tencent.invalid/jobs')] }, [
        { url: 'https://tencent.invalid/api/v1/position/searchPosition', method: 'POST', response: { status: 0, data: { count: 2, positionList: [{ postId: 'oa1', positionTitle: 'Local' }, { postId: 'wd1', positionTitle: 'Overseas', positionSource: 'workday', positionUrl: 'https://synthetic.wd1.myworkdayjobs.com/Careers/job/City/Role_REQ-1' }] } } },
        { url: 'https://tencent.invalid/api/v1/jobDetails/getJobDetailsByPostId?postId=oa1', response: { status: 0, data: { postId: 'oa1', title: 'Local', desc: 'Study a service.', request: 'Explain results.', topicDetail: 'Explore the interface.', topicRequirement: 'Present evidence.', graduateBonus: 'Research experience is preferred.' } } },
        { url: 'https://synthetic.wd1.myworkdayjobs.com/wday/cxs/synthetic/Careers/job/City/Role_REQ-1', response: { jobPostingInfo: { jobReqId: 'REQ-1', title: 'Overseas', jobDescription: '<p>Study public services.</p><p>Explain the findings.</p>' } } },
    ]);
    const wd = out.jobs.find(j => j.external_id === 'wd1');
    assert.equal(wd.parent_application_id, 'REQ-1');
    assert.equal(wd.detail_platform, 'workday');
    assert(out.jobs.find(j => j.external_id === 'oa1').jd.includes('Present evidence.'));
    assert(out.jobs.find(j => j.external_id === 'oa1').jd.includes('Research experience is preferred.'));
    assert.equal(out.coverage.details_ok, 2);
});

test('Workday offset pagination reads the complete public job list', async () => {
    const out = await run({ platform: 'workday', page_size: 1, entries: [entry('https://synthetic.wd1.myworkdayjobs.com/en-US/Careers')] }, [
        ...[
            { title: 'One', bulletFields: ['REQ-1'], externalPath: '/job/City/One_REQ-1' },
            { title: 'Two', bulletFields: ['REQ-2'], externalPath: '/job/City/Two_REQ-2' },
        ].map((row, i) => ({ url: 'https://synthetic.wd1.myworkdayjobs.com/wday/cxs/synthetic/Careers/jobs', method: 'POST', body: { appliedFacets: {}, limit: 1, offset: i, searchText: '' }, response: { total: 2, jobPostings: [row] } })),
        ...['1', '2'].map(id => ({ url: `https://synthetic.wd1.myworkdayjobs.com/wday/cxs/synthetic/Careers/job/City/${id === '1' ? 'One' : 'Two'}_REQ-${id}`, response: { jobPostingInfo: { jobReqId: `REQ-${id}`, title: `Role ${id}`, jobDescription: 'Investigate a problem and explain findings.' } } })),
    ]);
    assert.equal(out.coverage.complete, true);
    assert.equal(out.coverage.entries[0].pages_read, 2);
    assert.deepEqual(out.jobs.map(j => j.external_id), ['REQ-1', 'REQ-2']);
});

test('Ashby reads every inline full JD including differently titled roles', async () => {
    const out = await run({ platform: 'ashby', entries: [entry('https://jobs.ashbyhq.com/synthetic')] }, [
        { url: 'https://api.ashbyhq.com/posting-api/job-board/synthetic', response: { jobs: [{ id: 'a', title: 'Unusual specialist', descriptionPlain: 'Explore a public workflow and explain the findings.', employmentType: 'Intern', jobUrl: 'https://jobs.ashbyhq.com/synthetic/a' }, { id: 'b', title: 'Another discipline', descriptionHtml: '<p>Investigate behavior.</p><p>Present the complete results clearly.</p>', jobUrl: 'https://jobs.ashbyhq.com/synthetic/b' }] } },
    ]);
    assert.equal(out.jobs.length, 2);
    assert.equal(out.coverage.details_ok, 2);
    assert.equal(out.coverage.entries[0].pages[0].detail_transport, 'inline');
    assert.equal(out.coverage.complete, true);
});

test('Moka decrypts response transport only with explicitly public page configuration', async () => {
    const key = '0123456789abcdef', iv = 'abcdef0123456789';
    const encrypt = value => {
        const cipher = createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv));
        return { necromancer: key, data: Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]).toString('base64') };
    };
    const out = await run({ platform: 'moka', entries: [entry('https://moka.invalid/campus/public-org/public-site', { org_id: 'public-org', site_id: 'public-site', public_transport: { public: true, aes_iv: iv } })] }, [
        { url: 'https://moka.invalid/api/outer/ats-apply/website/jobs/v2', method: 'POST', response: encrypt({ success: true, data: { total: 1, jobs: [{ id: 'm1', title: 'Research' }] } }) },
        { url: 'https://moka.invalid/api/outer/ats-apply/website/job', method: 'POST', response: encrypt({ success: true, data: { id: 'm1', title: 'Research', jobDescription: 'Explore a public process and present evidence.' } }) },
    ]);
    assert.equal(out.coverage.complete, true);
    assert.equal(out.jobs[0].external_id, 'm1');
    assert.equal(out.jobs[0].url, 'https://moka.invalid/campus/public-org/public-site');
    assert(!JSON.stringify(out).includes(key));
});

test('Moka reports encrypted transport as blocked when public configuration is unavailable', async () => {
    const out = await run({ platform: 'moka', entries: [entry('https://moka.invalid/campus', { org_id: 'public-org', site_id: 'public-site' })] }, [
        { url: 'https://moka.invalid/api/outer/ats-apply/website/jobs/v2', method: 'POST', response: { necromancer: 'synthetic-key-123', data: 'encrypted' } },
    ]);
    assert.equal(out.coverage.entries[0].status, 'blocked');
    assert.equal(out.coverage.entries[0].failures[0].code, 'public_transport_config_required');
    assert.equal(out.coverage.complete, false);
});

test('a CSRF denial is a blocked entry and never triggers token acquisition or retries', async () => {
    const out = await run({ platform: 'feishu', entries: [entry('https://feishu.invalid/campus')] }, [
        { url: 'https://feishu.invalid/api/v1/search/job/posts', method: 'POST', status: 403, response: { message: 'CSRF required' }, headers: { 'set-cookie': 'private=ignored' } },
    ]);
    assert.equal(out.coverage.entries[0].status, 'blocked');
    assert.equal(out.coverage.requests, 1);
    assert.equal(out.coverage.complete, false);
    assert.equal(out.coverage.entries[0].total, null);
});

test('empty public lists retain URL, successful observation, and zero count', async () => {
    const out = await run({ platform: 'ashby', entries: [entry('https://jobs.ashbyhq.com/empty')] }, [
        { url: 'https://api.ashbyhq.com/posting-api/job-board/empty', response: { jobs: [] } },
    ]);
    assert.equal(out.jobs.length, 0);
    assert.equal(out.coverage.entries[0].source_url, 'https://jobs.ashbyhq.com/empty');
    assert.equal(out.coverage.entries[0].total, 0);
    assert.equal(out.coverage.entries[0].observed_at, observed);
    assert.equal(out.coverage.entries[0].complete, true);
});

test('one failed detail preserves list IDs, prevents full completion, and leaves later entries usable', async () => {
    const out = await run({ platform: 'oppo', entries: [entry('https://oppo.invalid/a'), entry('https://oppo.invalid/b')] }, [
        { url: 'https://oppo.invalid/openapi/position/pageNew', method: 'POST', response: { code: 0, data: { total: 1, records: [{ idRecruitPosition: 'a', positionName: 'One' }] } } },
        { url: 'https://oppo.invalid/openapi/position/detail?id=a', status: 404 },
        { url: 'https://oppo.invalid/openapi/position/pageNew', method: 'POST', response: { code: 0, data: { total: 1, records: [{ idRecruitPosition: 'b', positionName: 'Two' }] } } },
        { url: 'https://oppo.invalid/openapi/position/detail?id=b', response: { code: 0, data: { positionDesc: 'Investigate and explain a public workflow with supporting evidence.' } } },
    ]);
    assert.equal(out.coverage.entries[0].list_complete, true);
    assert.equal(out.coverage.entries[0].complete, false);
    assert.deepEqual(out.coverage.entries[0].external_ids, ['a']);
    assert.equal(out.coverage.entries[1].complete, true);
    assert.equal(out.jobs.find(j => j.external_id === 'a').detail_status, 'failed');
    assert.equal(out.coverage.details_failed, 1);
});

test('redirect targets are recorded as blocked without following them or retaining private locations', async () => {
    const out = await run({ platform: 'ashby', entries: [entry('https://jobs.ashbyhq.com/redirect')] }, [
        { url: 'https://api.ashbyhq.com/posting-api/job-board/redirect', status: 302, headers: { location: 'https://accounts.invalid/login?token=private' } },
    ]);
    assert.equal(out.coverage.entries[0].status, 'blocked');
    assert.equal(out.coverage.entries[0].failures[0].code, 'redirect_blocked');
    assert(!JSON.stringify(out).includes('private'));
});

test('a public listing cannot direct Tencent detail reads to an unrelated origin', async () => {
    const out = await run({ platform: 'tencent', entries: [entry('https://tencent.invalid/jobs')] }, [
        { url: 'https://tencent.invalid/api/v1/position/searchPosition', method: 'POST', response: { status: 0, data: { count: 1, positionList: [{ postId: 'a', positionTitle: 'Role', positionSource: 'workday', positionUrl: 'https://unrelated.invalid/Careers/job/One' }] } } },
    ]);
    assert.equal(out.coverage.requests, 1);
    assert.equal(out.coverage.entries[0].details_failed, 1);
    assert.equal(out.coverage.entries[0].failures[0].code, 'origin_not_allowed');
});

test('response cookies are never replayed into a second entrypoint', async () => {
    const out = await run({ platform: 'ashby', entries: [entry('https://jobs.ashbyhq.com/one'), entry('https://jobs.ashbyhq.com/two')] }, [
        { url: 'https://api.ashbyhq.com/posting-api/job-board/one', response: { jobs: [] }, headers: { 'set-cookie': 'synthetic-cookie=ignored' } },
        { url: 'https://api.ashbyhq.com/posting-api/job-board/two', response: { jobs: [] } },
    ]);
    assert.equal(out.coverage.complete, true);
    assert.equal(out.coverage.requests, 2);
});

test('response and timeout budgets fail one entry without presenting an empty successful catalogue', async () => {
    const large = await run({ platform: 'ashby', max_response_bytes: 12, entries: [entry('https://jobs.ashbyhq.com/large')] }, [
        { url: 'https://api.ashbyhq.com/posting-api/job-board/large', response: { jobs: [{ id: 'a', title: 'large response' }] } },
    ]);
    assert.equal(large.coverage.entries[0].failures[0].code, 'response_budget_exhausted');
    const slow = await (await load()).collectPublicCatalog({ platform: 'ashby', timeout_ms: 5, entries: [entry('https://jobs.ashbyhq.com/slow')] }, { fetch: () => new Promise(() => {}), now: () => observed });
    assert.equal(slow.coverage.entries[0].failures[0].code, 'request_timeout');
    assert.equal(slow.coverage.entries[0].complete, false);
});

test('a missing detail title and a different job ID cannot be reported as successful details', async () => {
    for (const [row, detail, code] of [
        [{ idRecruitPosition: 'a' }, { positionDesc: 'Explore the process.' }, 'detail_title_missing'],
        [{ idRecruitPosition: 'a', positionName: 'One' }, { idRecruitPosition: 'different', positionDesc: 'Explore the process.' }, 'detail_identity_mismatch'],
        [{ idRecruitPosition: 'a', positionName: 'One', positionDesc: 'Preview only.' }, {}, 'detail_body_missing'],
        [{ idRecruitPosition: 'a', positionName: 'One' }, { positionDesc: 'Preview only.' }, 'detail_body_incomplete'],
    ]) {
        const out = await run({ platform: 'oppo', entries: [entry('https://oppo.invalid/jobs')] }, [
            { url: 'https://oppo.invalid/openapi/position/pageNew', method: 'POST', response: { code: 0, data: { total: 1, records: [row] } } },
            { url: 'https://oppo.invalid/openapi/position/detail?id=a', response: { code: 0, data: detail } },
        ]);
        assert.equal(out.coverage.complete, false);
        assert.equal(out.coverage.entries[0].failures[0].code, code);
        assert.equal(out.jobs[0].detail_status, 'failed');
    }
});

test('tokens, cookies, private URLs and private network targets are rejected before a request', async () => {
    for (const bad of [
        entry('https://jobs.ashbyhq.com/synthetic?token=SYNTHETIC-SENSITIVE-VALUE'),
        entry('https://jobs.ashbyhq.com/synthetic', { headers: { Cookie: 'SYNTHETIC-SENSITIVE-VALUE' } }),
        entry('https://jobs.ashbyhq.com/synthetic', { csrf_token: 'SYNTHETIC-SENSITIVE-VALUE' }),
        entry('https://127.0.0.1/jobs'),
        entry('https://169.254.169.254/jobs'),
    ]) {
        const out = await run({ platform: 'ashby', entries: [bad] }, []);
        assert.equal(out.coverage.requests, 0);
        assert.equal(out.coverage.entries[0].status, 'blocked');
        assert(!JSON.stringify(out).includes('SYNTHETIC-SENSITIVE-VALUE'));
    }
});

test('a page budget exposes the remaining cursor and never claims all jobs were read', async () => {
    const out = await run({ platform: 'workday', page_size: 1, max_pages: 1, entries: [entry('https://synthetic.wd1.myworkdayjobs.com/Careers')] }, [
        { url: 'https://synthetic.wd1.myworkdayjobs.com/wday/cxs/synthetic/Careers/jobs', method: 'POST', response: { total: 3, jobPostings: [{ title: 'One', bulletFields: ['REQ-1'], externalPath: '/job/City/One_REQ-1' }] } },
        { url: 'https://synthetic.wd1.myworkdayjobs.com/wday/cxs/synthetic/Careers/job/City/One_REQ-1', response: { jobPostingInfo: { jobDescription: 'Investigate the process and present conclusions.' } } },
    ]);
    assert.equal(out.coverage.complete, false);
    assert.equal(out.coverage.entries[0].cursor.offset, 1);
    assert(out.coverage.entries[0].failures.some(f => f.code === 'page_budget_exhausted'));
});

test('a global request budget records unvisited details and later entrypoints', async () => {
    const out = await run({ platform: 'oppo', max_requests: 1, entries: [entry('https://oppo.invalid/a'), entry('https://oppo.invalid/b')] }, [
        { url: 'https://oppo.invalid/openapi/position/pageNew', method: 'POST', response: { code: 0, data: { total: 1, records: [{ idRecruitPosition: 'a', positionName: 'One' }] } } },
    ]);
    assert.equal(out.coverage.requests, 1);
    assert.equal(out.coverage.complete, false);
    assert.equal(out.coverage.entries.length, 2);
    assert.equal(out.coverage.entries[0].details_failed, 1);
    assert(out.coverage.entries[1].failures.some(f => f.code === 'request_budget_exhausted'));
});

test('a job budget retains the page observation and the IDs collected before truncation', async () => {
    const out = await run({ platform: 'oppo', max_jobs: 1, entries: [entry('https://oppo.invalid/jobs')] }, [
        { url: 'https://oppo.invalid/openapi/position/pageNew', method: 'POST', response: { code: 0, data: { total: 2, records: [{ idRecruitPosition: 'a', positionName: 'One' }, { idRecruitPosition: 'b', positionName: 'Two' }] } } },
        { url: 'https://oppo.invalid/openapi/position/detail?id=a', response: { code: 0, data: { positionDesc: 'Study the process.' } } },
    ]);
    assert.equal(out.coverage.entries[0].pages_read, 1);
    assert.equal(out.coverage.entries[0].pages[0].row_count, 2);
    assert.deepEqual(out.coverage.entries[0].external_ids, ['a']);
    assert(out.coverage.entries[0].failures.some(f => f.code === 'job_budget_exhausted'));
    assert.equal(out.coverage.complete, false);
});

test('missing or contradictory list evidence remains incomplete instead of inventing zero jobs', async () => {
    for (const response of [{ code: 0, data: {} }, { code: 0, data: { total: 2, records: [] } }]) {
        const out = await run({ platform: 'oppo', entries: [entry('https://oppo.invalid/all')] }, [
            { url: 'https://oppo.invalid/openapi/position/pageNew', method: 'POST', response },
        ]);
        assert.equal(out.coverage.complete, false);
        assert.equal(out.coverage.entries[0].list_complete, false);
    }
});

test('live-list comparison distinguishes union changes and internship-only membership', async () => {
    const api = await load();
    const previous = [{ source_url: 'https://example.invalid/campus', external_ids: ['a', 'gone'], complete: true, track: 'campus', campaign: 'g', observed_at: '2026-10-20T12:00:00Z' }, { source_url: 'https://example.invalid/intern', external_ids: ['a', 'old-i'], complete: true, track: 'internship', campaign: 'i', observed_at: '2026-10-20T12:00:00Z' }];
    const current = [{ ...previous[0], external_ids: ['a', 'new'], observed_at: observed }, { ...previous[1], external_ids: ['a', 'new-i'], observed_at: observed }];
    const out = api.compareLiveLists(previous, current);
    assert.deepEqual(out.added_ids, ['new', 'new-i']);
    assert.deepEqual(out.removed_ids, ['gone', 'old-i']);
    assert.deepEqual(out.confirmed_removed_ids, ['gone', 'old-i']);
    assert.deepEqual(out.entry_only.find(e => e.track === 'internship').external_ids, ['new-i']);
    assert.equal(out.complete, true);
    assert.equal(out.current_observed_at, observed);
    assert.deepEqual(previous[0].external_ids, ['a', 'gone']);
});

test('partial live lists expose apparent removals without confirming closure', async () => {
    const api = await load();
    const previous = [{ source_url: 'https://example.invalid/campus', external_ids: ['a', 'b'], complete: true, track: 'campus', observed_at: observed }];
    const current = [{ ...previous[0], external_ids: ['a'], complete: false }];
    const out = api.compareLiveLists(previous, current);
    assert.deepEqual(out.removed_ids, ['b']);
    assert.deepEqual(out.confirmed_removed_ids, []);
    assert.equal(out.complete, false);
});

test('a missing entrypoint or an older observation cannot confirm disappearance', async () => {
    const api = await load();
    const previous = [{ source_url: 'https://example.invalid/a', external_ids: ['a'], complete: true, observed_at: observed }, { source_url: 'https://example.invalid/b', external_ids: ['b'], complete: true, observed_at: observed }];
    for (const current of [[{ ...previous[0], external_ids: [] }], previous.map(e => ({ ...e, external_ids: [], observed_at: '2026-10-20T12:00:00Z' }))]) {
        const out = api.compareLiveLists(previous, current);
        assert.deepEqual(out.confirmed_removed_ids, []);
        assert.equal(out.complete, false);
    }
});
