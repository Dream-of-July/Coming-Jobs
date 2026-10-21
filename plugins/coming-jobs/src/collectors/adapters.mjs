import { createDecipheriv } from 'node:crypto';
import { fail, publicUrl, safeUrl } from './transport.mjs';

export const SUPPORTED_PLATFORMS = Object.freeze(['feishu', 'moka', 'hotjob', 'vivo', 'oppo', 'tencent', 'workday', 'ashby']);
const first = (...values) => values.find(v => v !== undefined && v !== null && v !== '');
const count = value => value === undefined || value === null || value === '' ? null : Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fail('invalid_list_count');
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : fail('invalid_response_shape');
const rows = value => Array.isArray(value) ? value : fail('missing_list_rows');
function status(body, field, accepted) {
    object(body);
    if (body[field] !== undefined && !accepted.includes(String(body[field]))) fail('api_rejected', true);
}
export const text = value => typeof value === 'string' ? value.replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '';
function names(value) {
    if (typeof value === 'string') return value ? [value] : [];
    if (!Array.isArray(value)) return [];
    return value.map(v => typeof v === 'string' ? v : first(v?.name, v?.title, v?.location)).filter(v => typeof v === 'string' && v);
}
export function externalId(row, platform) {
    const value = platform === 'workday' ? first(row.id, row.jobReqId, row.bulletFields?.[0], row.externalPath) :
        first(row.id, row.postId, row.Id, row.idRecruitPosition, row.jobId, row.job_post_id);
    if (!['string', 'number'].includes(typeof value) || !String(value).trim() || String(value).length > 300 || /[\x00-\x1f]/.test(String(value))) fail('missing_external_id');
    return String(value);
}
function workdayLocation(value) {
    const url = new URL(publicUrl(value));
    const parts = url.pathname.split('/').filter(Boolean);
    const jobAt = parts.indexOf('job');
    const site = jobAt >= 0 ? parts[jobAt - 1] : parts.at(-1);
    if (!site || site === 'job' || /[^a-z\d_.-]/i.test(site)) fail('workday_site_required', true);
    const tenant = url.hostname.split('.')[0];
    return { origin: url.origin, site, base: `${url.origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}`,
        path: jobAt >= 0 ? '/' + parts.slice(jobAt).join('/') : null,
        publicBase: `${url.origin}/${encodeURIComponent(site)}` };
}
function unwrapMoka(body, config) {
    object(body);
    if (body.necromancer) {
        if (config.public_transport?.public !== true || typeof config.public_transport.aes_iv !== 'string') fail('public_transport_config_required', true);
        const key = Buffer.from(body.necromancer), iv = Buffer.from(config.public_transport.aes_iv);
        if (![16, 24, 32].includes(key.length) || iv.length !== 16 || typeof body.data !== 'string') fail('invalid_public_transport');
        try {
            const cipher = createDecipheriv(`aes-${key.length * 8}-cbc`, key, iv);
            body = JSON.parse(Buffer.concat([cipher.update(Buffer.from(body.data, 'base64')), cipher.final()]).toString('utf8'));
        } catch { fail('invalid_public_transport'); }
    }
    if (body.success === false) fail('api_rejected', true);
    return body.success === true ? object(body.data) : body;
}

export function adapterFor(platform, entry, size) {
    if (!SUPPORTED_PLATFORMS.includes(platform)) fail('unsupported_platform', true);
    const config = entry.config ?? {}, origin = new URL(entry.url).origin;
    const api = publicUrl(config.api_base ?? origin);
    const allowedOrigins = new Set([origin, new URL(api).origin, ...(config.allowed_origins ?? []).map(v => new URL(publicUrl(v)).origin)]);
    const url = (path, query = {}) => {
        const target = new URL(path, api);
        for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
        return publicUrl(target.href);
    };
    const post = (path, body, headers) => ({ url: url(path), method: 'POST', body, ...(headers ? { headers } : {}) });
    const get = (path, query) => ({ url: url(path, query) });
    const result = { allowedOrigins, pageSize: size, inline: false,
        decode: body => body,
        parseDetail: body => object(body.data ?? body),
        jobUrl: row => safeUrl(first(row.jobUrl, row.positionUrl, row.url), entry.url) ?? entry.url };
    switch (platform) {
    case 'feishu': {
        const headers = { 'website-path': config.website_path ?? new URL(entry.url).pathname.split('/').filter(Boolean)[0] ?? '', 'Portal-Channel': 'saas-career', 'Portal-Platform': 'pc' };
        result.list = state => post('/api/v1/search/job/posts', { keyword: '', limit: size, offset: state.offset, job_category_id_list: [], tag_id_list: [],
            location_code_list: [], subject_id_list: config.subject_ids ?? [], recruitment_id_list: [], portal_type: 6, job_function_id_list: [], storefront_id_list: [], portal_entrance: 1 }, headers);
        result.parseList = body => { status(body, 'code', ['0', '200']); const d = object(body.data); return { rows: rows(first(d.job_post_list, d.job_posts)), total: count(d.count) }; };
        result.detail = row => ({ ...get(`/api/v1/job/posts/${encodeURIComponent(externalId(row, platform))}`, { portal_type: 6, with_recommend: false }), headers });
        result.parseDetail = body => { status(body, 'code', ['0', '200']); return object(body.data?.job_post ?? body.data); };
        result.jobUrl = row => url(`/${config.website_path ?? new URL(entry.url).pathname.split('/').filter(Boolean)[0] ?? ''}/position/${encodeURIComponent(externalId(row, platform))}/detail`);
        break;
    }
    case 'moka': {
        if (!config.org_id || !config.site_id) fail('moka_public_site_config_required', true);
        const common = { orgId: config.org_id, siteId: config.site_id, locale: config.locale ?? 'zh-CN' };
        result.decode = body => unwrapMoka(body, config);
        result.list = state => post('/api/outer/ats-apply/website/jobs/v2', { ...common, limit: size, offset: state.offset, needStat: true, customFields: {}, site: config.mode ?? 'campus' });
        result.parseList = body => ({ rows: rows(body.jobs), total: count(first(body.total, body.count, body.jobStats?.total)) });
        result.detail = row => post('/api/outer/ats-apply/website/job', { ...common, jobId: externalId(row, platform) });
        result.parseDetail = body => object(body);
        break;
    }
    case 'hotjob': {
        if (!config.tenant) fail('hotjob_tenant_required', true);
        const suffix = encodeURIComponent(config.tenant);
        const pageSize = Math.min(size, 50);
        result.pageSize = pageSize;
        result.list = state => ({ url: url(`/wecruit/positionInfo/listPosition/${suffix}`), method: 'POST', form: { isFrompb: 'true', recruitType: String(config.recruit_type ?? 1), pageSize: String(pageSize), currentPage: String(state.page) } });
        result.parseList = body => { status(body, 'state', ['200']); const d = object(body.data?.pageForm); return { rows: rows(d.pageData), total: count(d.dataCount), total_pages: count(d.totalPage) }; };
        result.detail = row => ({ url: url(`/wecruit/positionInfo/listPositionDetail/${suffix}`), method: 'POST', form: { postId: externalId(row, platform), recruitType: String(config.recruit_type ?? 1) } });
        result.parseDetail = body => { status(body, 'state', ['200']); return object(body.data); };
        result.jobUrl = row => url(`/${suffix}/pb/posDetail.html`, { postId: externalId(row, platform) });
        break;
    }
    case 'vivo': {
        if (!config.portal_id) fail('vivo_portal_required', true);
        const fields = config.display_fields ?? ['JobAdName', 'Duty', 'Require', 'LocNames', 'Category', 'ClassificationOne', 'ClassificationTwo'];
        result.list = state => post('/api/Jobad/GetJobAdPageList', { PageIndex: state.page - 1, PageSize: size, Category: config.categories ?? [], PortalId: config.portal_id, KeyWords: '', SpecialType: 0, DisplayFields: fields });
        result.parseList = body => { status(body, 'Code', ['200']); return { rows: rows(body.Data), total: count(body.Count) }; };
        result.detail = row => get('/api/JobAd/GetJobAdInfo', { jobAdId: externalId(row, platform), category: first(config.categories?.[0], row.CategoryId, row.Category), portalId: config.portal_id, displayFields: JSON.stringify(fields) });
        result.parseDetail = body => { status(body, 'Code', ['200']); return object(body.Data); };
        result.jobUrl = row => url('/job/detail', { jobAdId: externalId(row, platform) });
        break;
    }
    case 'oppo': {
        const projects = config.projects?.map(p => ({ projectId: p.project_id, recruitmentType: p.recruitment_type, isAllNode: 'Y', themeList: [] }));
        const headers = config.tenant_id === undefined ? undefined : { 'Tenant-Id': config.tenant_id };
        result.list = state => post('/openapi/position/pageNew', { pageNum: state.page, pageSize: size, ...(projects ? { projectList: projects } : {}) }, headers);
        result.parseList = body => { status(body, 'code', ['0']); const d = object(body.data); return { rows: rows(d.records), total: count(d.total), total_pages: count(d.pages) }; };
        result.detail = row => ({ ...get('/openapi/position/detail', { id: externalId(row, platform) }), ...(headers ? { headers } : {}) });
        result.parseDetail = body => { status(body, 'code', ['0']); return object(body.data); };
        result.jobUrl = row => url('/position/detail', { id: externalId(row, platform) });
        break;
    }
    case 'tencent': {
        result.list = state => post('/api/v1/position/searchPosition', { projectIdList: [], projectMappingIdList: config.project_mapping_ids ?? [], keyword: '', bgList: [], workCountryType: 0, workCityList: [], recruitCityList: [], positionFidList: [], pageIndex: state.page, pageSize: size });
        result.parseList = body => { status(body, 'status', ['0']); const d = object(body.data); return { rows: rows(d.positionList), total: count(d.count) }; };
        result.detail = row => {
            if (row.positionSource !== 'workday') return get('/api/v1/jobDetails/getJobDetailsByPostId', { postId: externalId(row, platform) });
            const target = publicUrl(row.positionUrl);
            const host = new URL(target).hostname;
            if (!host.endsWith('.myworkdayjobs.com') && !allowedOrigins.has(new URL(target).origin)) fail('origin_not_allowed', true);
            const location = workdayLocation(target);
            if (!location.path) fail('workday_job_path_required');
            allowedOrigins.add(location.origin);
            return { url: location.base + location.path, detail_platform: 'workday' };
        };
        result.parseDetail = body => {
            if (body.jobPostingInfo) return object(body.jobPostingInfo);
            status(body, 'status', ['0']); return object(body.data);
        };
        result.jobUrl = row => safeUrl(row.positionUrl) ?? url('/post_detail.html', { postid: externalId(row, platform) });
        break;
    }
    case 'workday': {
        const location = workdayLocation(entry.url);
        const base = config.cxs_base ? publicUrl(config.cxs_base).replace(/\/$/, '') : location.base;
        allowedOrigins.add(new URL(base).origin);
        result.list = state => ({ url: base + '/jobs', method: 'POST', body: { appliedFacets: config.applied_facets ?? {}, limit: size, offset: state.offset, searchText: '' } });
        result.parseList = body => ({ rows: rows(body.jobPostings), total: count(body.total) });
        result.detail = row => {
            if (typeof row.externalPath !== 'string' || !row.externalPath.startsWith('/job/')) fail('workday_job_path_required');
            return { url: base + row.externalPath, detail_platform: 'workday' };
        };
        result.parseDetail = body => object(body.jobPostingInfo);
        result.jobUrl = row => safeUrl(location.publicBase + row.externalPath) ?? entry.url;
        break;
    }
    case 'ashby': {
        result.inline = true;
        const board = config.board ?? new URL(entry.url).pathname.split('/').filter(Boolean)[0];
        if (!board) fail('ashby_board_required', true);
        const base = config.api_base ?? (new URL(entry.url).hostname === 'jobs.ashbyhq.com' ? 'https://api.ashbyhq.com' : origin);
        allowedOrigins.add(new URL(publicUrl(base)).origin);
        result.list = () => ({ url: new URL(`/posting-api/job-board/${encodeURIComponent(board)}`, base).href });
        result.parseList = body => ({ rows: rows(body.jobs), total: rows(body.jobs).length, has_more: false });
        result.parseDetail = row => row;
        break;
    }
    }
    return result;
}

export function normalizeJob(platform, entry, row, detail, adapter, observedAt, detailPlatform = platform) {
    const data = { ...row, ...(detail ?? {}) };
    const { duty, requirement, extra_text, jd } = detailText(data);
    const structured = structureRequirements(duty, requirement, extra_text);
    const parent = first(data.parent_application_id, data.parentApplicationId, data.applicationId, data.parentId, data.requisitionId, data.jobReqId, data.job_id, data.job?.id);
    const title = text(first(data.title, data.name, data.postName, data.JobAdName, data.positionName, data.positionTitle));
    return { external_id: externalId(row, platform), parent_application_id: parent === undefined ? null : String(parent), platform, detail_platform: detailPlatform,
        title, source_url: entry.url, source_urls: [entry.url], url: adapter.jobUrl(data),
        description: duty, duty, requirement, extra_text, jd,
        ...structured,
        locations: [...new Set(names(first(data.LocNames, data.workPlaceList, data.workCityList, data.locations, data.location, data.workPlaceStr, data.locationsText, data.job?.location_list)))],
        project: first(data.ClassificationOne, data.projectName, null) ?? null,
        category: first(data.ClassificationTwo, data.postTypeName, data.department, data.category?.name, null) ?? null,
        track: entry.track ?? 'unknown', campaign: entry.campaign ?? null, tracks: [entry.track ?? 'unknown'], campaigns: entry.campaign ? [entry.campaign] : [],
        employment_type: data.employmentType ?? null, observed_at: observedAt, detail_status: detail ? (jd ? 'ok' : 'failed') : 'failed' };
}

function structureRequirements(duty, requirement, extra) {
    const requirements = [], normalization_notes = [];
    const preferred = /优先|加分|preferred|\bplus\b|\bbonus\b|nice[ -]to[ -]have/i;
    const mandatory = /必须|须|需要|需具备|要求|至少|不得|不少于|\brequired\b|\bmust\b|\bmandatory\b|\bat least\b/i;
    for (const [body, sourceKind] of [[duty, 'responsibility'], [requirement, 'requirement'], [extra, 'preferred']]) {
        const lines = body.split(/\r?\n|[；;]/).map(value => value.replace(/^\s*(?:[-•]|\d+[、.)])\s*/, '').trim()).filter(Boolean);
        for (const line of lines) {
            let kind = sourceKind;
            const id = `r${requirements.length + 1}`;
            if (sourceKind === 'requirement' && preferred.test(line)) {
                if (mandatory.test(line)) {
                    kind = 'responsibility';
                    normalization_notes.push({ code: 'mixed_requirement_needs_host_structure', requirement_id: id });
                } else kind = 'preferred';
            }
            requirements.push({ id, text: line, kind });
        }
    }
    return { requirements, normalization_notes };
}

export function detailText(data) {
    const duty = [text(first(data.descriptionPlain, data.descriptionHtml, data.jobDescription, data.description, data.positionDesc, data.workContent, data.Duty, data.responsibility, data.responsibilities, data.desc)), text(data.topicDetail)].filter(Boolean).join('\n\n');
    const requirement = [text(first(data.requirement, data.requirements, data.positionRequire, data.serviceCondition, data.Require, data.qualification, data.request)), text(data.topicRequirement)].filter(Boolean).join('\n\n');
    const extra_text = [text(data.graduateBonus), text(data.internBonus), text(data.introduction)].filter(Boolean).join('\n\n');
    return { duty, requirement, extra_text, jd: [...new Set([duty, requirement, extra_text].filter(Boolean))].join('\n\n') };
}

export function validateDetailIdentity(platform, row, detail, detailPlatform) {
    if (platform === 'tencent' && detailPlatform === 'workday') return;
    const field = { feishu: 'id', moka: 'id', hotjob: 'postId', vivo: 'Id', oppo: 'idRecruitPosition', tencent: 'postId', workday: 'jobReqId', ashby: 'id' }[platform];
    if (platform === 'workday' && !row.jobReqId && !row.bulletFields?.[0]) return;
    if (detail[field] !== undefined && String(detail[field]) !== externalId(row, platform)) fail('detail_identity_mismatch');
}
