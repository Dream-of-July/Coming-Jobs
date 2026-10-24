#!/usr/bin/env node
/** Reproducible synthetic benchmark; no real profile, recruiter or submit action.
 * node --no-warnings scripts/application-batch-benchmark.mjs [--engine auto|chromium|synthetic]
 * Optional installed runtime: JOBOS_PLAYWRIGHT=/path/to/playwright/index.mjs
 * Optional installed browser: JOBOS_QA_CHROMIUM=/path/to/chrome
 * Writes only a disposable synthetic SQLite workspace; emits one JSON report.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { batchFixture, startBatch, approveBatch } from '../plugins/coming-jobs/tests/batch-helpers.mjs';
import { executeOrdinaryBatch } from '../plugins/coming-jobs/src/host-batch.mjs';
import { browserExecutable } from '../plugins/coming-jobs/src/materials.mjs';
import { call } from '../plugins/coming-jobs/src/service.mjs';
import { Store } from '../plugins/coming-jobs/src/store.mjs';
import { now } from '../plugins/coming-jobs/src/core.mjs';

const origin = 'https://coming-jobs-benchmark.invalid';
const session = 'synthetic-session';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const requestedEngine = process.argv.includes('--engine') ? process.argv[process.argv.indexOf('--engine') + 1] : 'auto';
assert(['auto', 'chromium', 'synthetic'].includes(requestedEngine), 'Use --engine auto|chromium|synthetic');
process.env.JOBOS_HOST = 'codex';

// Frozen production algorithm from beta.17, commit 9b0f1d0, host-batch.mjs.
// This baseline is executed on the same inputs; its call count is not a constant.
async function executeBeta17Batch(tab, batch) {
    const read = label => tab.playwright.evaluate(name => {
        const controls = [...document.querySelectorAll('input,textarea,select')].filter(el => [...(el.labels ?? [])].some(l => l.textContent.trim() === name));
        if (controls.length !== 1) throw new Error('unique_match_required');
        const el = controls[0];
        return { value: el.type === 'checkbox' ? el.checked : el.value, maxLength: el.maxLength };
    }, label);
    const observations = [];
    let active;
    try {
        if (batch.state !== 'pending' || !batch.id || batch.targets.length > 8) throw new Error('invalid_batch');
        for (const field of batch.targets) {
            active = field.key;
            if (!['free_text', 'url', 'checkbox'].includes(field.type)) throw new Error('separate_control_required');
            if (new URL(await tab.url()).origin !== batch.scope.origin || Date.parse(batch.grant.expires_at) <= Date.now()) throw new Error('boundary_changed');
            if (field.locator?.kind !== 'label') throw new Error('observed_label_required');
            const locator = tab.playwright.getByLabel(field.locator.value, { exact: true });
            if (await locator.count() !== 1) throw new Error('unique_match_required');
            const before = await read(field.locator.value);
            const original = batch.before.find(o => o.key === field.key);
            if (before.value !== original?.value && before.value !== field.value) throw new Error('user_edit');
            if (typeof field.value === 'string' && before.maxLength >= 0 && field.value.length > before.maxLength) throw new Error('length_limit');
            if (before.value !== field.value) {
                if (field.type === 'checkbox') await locator.setChecked(field.value);
                else await locator.fill(field.value);
            }
            const value = (await read(field.locator.value)).value;
            observations.push({ key: field.key, value, read_state: 'known' });
            if (value !== field.value) throw new Error('readback_mismatch');
            active = null;
        }
        return { batch_id: batch.id, observations, state: 'complete' };
    } catch {
        if (active && !observations.some(o => o.key === active)) observations.push({ key: active, read_state: 'unreadable' });
        return { batch_id: batch.id, observations, state: 'unknown', next: 'readonly_recovery' };
    }
}

async function installedBrowser() {
    if (requestedEngine === 'synthetic') return { browser: null, reason: 'explicit_synthetic_mode' };
    const candidates = [process.env.JOBOS_PLAYWRIGHT, 'playwright', process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES && path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright', 'index.mjs')].filter(Boolean);
    let chromium;
    for (const candidate of candidates) {
        try { ({ chromium } = await import(path.isAbsolute(candidate) ? pathToFileURL(candidate).href : candidate)); break; }
        catch { /* Try only an already installed module. */ }
    }
    if (!chromium) return { browser: null, reason: 'installed_playwright_unavailable' };
    const executable = process.env.JOBOS_QA_CHROMIUM || browserExecutable();
    if (executable && !existsSync(executable)) return { browser: null, reason: 'configured_chromium_unavailable' };
    // The default launcher may have only its headless-shell binary installed.
    // Calling launch does not install anything or contact a recruiting site.
    try { return { browser: await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) }), reason: null }; }
    catch (error) { return { browser: null, reason: /Executable doesn't exist/.test(error.message) ? 'installed_chromium_unavailable' : 'installed_chromium_launch_failed' }; }
}

function portalHTML(fields, route) {
    return `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Synthetic application benchmark</title>
      <h1>Synthetic application; no recruiting service</h1>
      ${fields.map(field => `<label for="${escape(field.key)}">${escape(field.label)}</label><input id="${escape(field.key)}" data-field="true" required maxlength="4000">`).join('\n')}
      <label for="cv">Resume</label><input id="cv" type="file" accept="application/pdf">
      <output id="upload" data-complete="false" data-associated="false" data-parse-complete="false"></output>
      <button id="save">Save draft</button><button id="submit">Submit</button><output id="status"></output>
      <script>
      const base=${JSON.stringify(route)}, upload=document.getElementById('upload'), status=document.getElementById('status');
      document.getElementById('cv').onchange=async()=>{
        const file=document.getElementById('cv').files[0];
        const response=await fetch(base+'/upload',{method:'POST',headers:{'X-Filename':encodeURIComponent(file.name)},body:file});
        const data=await response.json();
        upload.dataset.name=data.name;upload.dataset.bytes=String(data.bytes);upload.dataset.complete=String(data.ok);
        upload.dataset.associated=String(data.ok);upload.dataset.parseComplete=String(data.ok);
        upload.textContent='Attachment stored; this synthetic portal has no resume parser.';
      };
      document.getElementById('save').onclick=async()=>{
        const values=Object.fromEntries([...document.querySelectorAll('input[data-field]')].map(element=>[element.id,element.value]));
        const data=await(await fetch(base+'/save',{method:'POST',body:JSON.stringify(values)})).json();
        status.dataset.revision=String(data.revision);status.textContent='Draft saved';
      };
      document.getElementById('submit').onclick=()=>fetch(base+'/submit',{method:'POST'});
      </script>`;
}

class Portal {
    constructor(id, fields) {
        this.id = String(id); this.fields = fields; this.page = null; this.failureAfter = null; this.failureUsed = false;
        this.writes = []; this.uploads = 0; this.saves = 0; this.submits = 0; this.attachment = null; this.saved = null;
        this.resetCalls();
        this.elements = fields.map(field => ({ id: field.key, value: '', type: 'text', maxLength: 4000, disabled: false, readOnly: false,
            labels: [{ textContent: field.label }], ownerDocument: { location: { origin } }, getAttribute: () => null }));
        const locate = name => {
            const matching = this.elements.filter(element => element.labels.some(label => label.textContent === name));
            const native = this.page?.getByLabel(name, { exact: true });
            return {
                count: async () => { this.calls.count++; return native ? native.count() : matching.length; },
                evaluate: async fn => { this.calls.dom_reads++; assert.equal(matching.length, 1); return native ? native.evaluate(fn) : fn(matching[0]); },
                fill: async value => {
                    this.calls.writes++;
                    assert.equal(matching.length, 1);
                    if (native) await native.fill(value); else matching[0].value = value;
                    this.writes.push(matching[0].id);
                    if (!this.failureUsed && this.failureAfter === this.writes.length) { this.failureUsed = true; throw new Error('Synthetic transport failure after applied write'); }
                }
            };
        };
        this.tab = { url: async () => { this.calls.url_reads++; return this.page ? this.page.url() : this.url; }, playwright: {
            getByLabel: locate,
            evaluate: async (fn, argument) => {
                this.calls.dom_reads++;
                return this.page ? this.page.evaluate(fn, argument) : vm.runInNewContext(`(${fn.toString()})(argument)`, {
                    document: { querySelectorAll: () => this.elements, getElementById: id => this.elements.find(element => element.id === id) },
                    location: { origin }, argument
                });
            }
        } };
    }
    get url() { return `${origin}/app/${this.id}`; }
    resetCalls() { this.calls = { url_reads: 0, count: 0, dom_reads: 0, writes: 0 }; }
    receiveUpload(name, buffer) {
        assert(buffer.subarray(0, 5).equals(Buffer.from('%PDF-')));
        this.uploads++;
        this.attachment = { name, bytes: buffer.length, sha256: sha(buffer) };
        return { ok: true, ...this.attachment };
    }
    receiveSave(values) { this.saves++; this.saved = { values, attachment_sha256: this.attachment?.sha256 ?? null }; return { ok: true, revision: this.saves }; }
    async readFields() {
        return this.page ? this.page.locator('input[data-field]').evaluateAll(elements => elements.map(element => ({ key: element.id, value: element.value, read_state: 'known' })))
            : this.elements.map(element => ({ key: element.id, value: element.value, read_state: 'known' }));
    }
    async controls() {
        const observations = await this.readFields();
        return [...this.fields.map(field => ({ key: field.key, label: field.label, type: 'free_text', required: true, ...observations.find(value => value.key === field.key) })),
            { key: 'cv', label: 'Resume', type: 'file_upload', required: true }];
    }
    async upload(field) {
        const file = readFileSync(field.local_file);
        assert.equal(sha(file), field.material.sha256);
        if (this.page) {
            await this.page.getByLabel('Resume', { exact: true }).setInputFiles(field.local_file);
            await this.page.locator('#upload[data-complete="true"]').waitFor();
        } else this.receiveUpload(path.basename(field.local_file), file);
        assert.equal(this.attachment.sha256, field.material.sha256);
    }
    async save() {
        if (this.page) {
            const revision = this.saves;
            await this.page.getByRole('button', { name: 'Save draft', exact: true }).click();
            await this.page.waitForFunction(prior => Number(document.getElementById('status').dataset.revision) > prior, revision);
        } else this.receiveSave(Object.fromEntries((await this.readFields()).map(field => [field.key, field.value])));
        assert(await this.isSaved());
    }
    async isSaved() {
        return !!this.saved && this.saved.attachment_sha256 === (this.attachment?.sha256 ?? null)
            && (await this.readFields()).every(field => this.saved.values[field.key] === field.value);
    }
    async readUpload() {
        if (!this.attachment) return { key: 'cv', read_state: 'known', file_count: 0 };
        const state = this.page ? await this.page.locator('#cv').evaluate(element => {
            const upload = document.getElementById('upload');
            return { file_selected: element.files.length === 1, file_count: element.files.length,
                file_name: upload.dataset.name, file_bytes: Number(upload.dataset.bytes),
                upload_complete: upload.dataset.complete === 'true', parse_complete: upload.dataset.parseComplete === 'true',
                attachment_associated: upload.dataset.associated === 'true' };
        }) : { file_selected: true, file_count: 1, file_name: this.attachment.name, file_bytes: this.attachment.bytes,
            upload_complete: true, parse_complete: true, attachment_associated: true };
        assert.equal(state.file_name, this.attachment.name); assert.equal(state.file_bytes, this.attachment.bytes);
        return { key: 'cv', read_state: 'known', ...state, local_sha256: this.attachment.sha256,
            portal_saved: this.saved?.attachment_sha256 === this.attachment.sha256 };
    }
}

async function main() {
    const wallStarted = performance.now(), installed = await installedBrowser();
    if (requestedEngine === 'chromium') assert(installed.browser, `Requested installed Chromium unavailable: ${installed.reason}`);
    const engine = installed.browser ? 'local_chromium' : 'synthetic_dom_vm';
    const portals = new Map(), browser = installed.browser;
    let context, fixture, store, externalRequests = 0, baseline, payload;
    const reports = [], claims = [], restarts = [];
    const run = (name, args = {}) => { const result = call(store, `jobos1_${name}`, args); assert.equal(result.ok, true, JSON.stringify(result.error)); return result.data; };
    try {
        if (browser) {
            context = await browser.newContext({ serviceWorkers: 'block' });
            await context.route('**/*', async route => {
                const url = new URL(route.request().url()), match = url.pathname.match(/^\/app\/([^/]+)(?:\/(upload|save|submit))?$/);
                if (url.origin !== origin || !match || !portals.has(match[1])) { externalRequests++; await route.abort(); return; }
                const portal = portals.get(match[1]);
                if (!match[2]) await route.fulfill({ contentType: 'text/html', body: portalHTML(portal.fields, url.pathname) });
                else {
                    const request = route.request();
                    const result = match[2] === 'upload' ? portal.receiveUpload(decodeURIComponent(request.headers()['x-filename']), request.postDataBuffer())
                        : match[2] === 'save' ? portal.receiveSave(JSON.parse(request.postData())) : (portal.submits++, { ok: true });
                    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
                }
            });
        }
        fixture = batchFixture(null, 10, { batch_submit: null });
        store = fixture.store; fixture.run = run;
        const values = [
            'Synthetic Candidate', 'Synthetic University', 'Product Design', '2027',
            'Synthetic interaction design project', 'Synthetic user research internship',
            'Synthetic prototyping and usability studies', 'Synthetic portfolio description'
        ];
        run('remember', { mode: 'user_statement', confirmed: true, user_ref: 'Synthetic benchmark facts only',
            facts: values.map((value, index) => ({ key: `benchmark.field.${index}`, value, purposes: ['form'], evidence_level: 'self_statement' })) });
        const fields = values.map((value, index) => ({ key: `field_${index}`, label: `Synthetic field ${index + 1}`, type: 'free_text', required: true, value,
            source: { fact_id: store.all('fact').find(fact => fact.key === `benchmark.field.${index}`).id, transform: 'identity' },
            locator: { kind: 'label', value: `Synthetic field ${index + 1}` } }));
        for (const [index, application] of fixture.apps.entries()) {
            const portal = new Portal(index + 1, fields); portals.set(portal.id, portal);
            if (context) { portal.page = await context.newPage(); await portal.page.goto(portal.url); }
            application.portal = portal;
            application.plan = run('plan', { application_id: application.app.id, portal_url: portal.url, page_fingerprint: 'synthetic-eight-fields-v1',
                observed_fields: [...fields.map((field, i) => ({ key: field.key, label: field.label, type: field.type, required: true, profile_key: `benchmark.field.${i}` })),
                    { key: 'cv', label: 'Resume', type: 'file_upload', required: true }],
                groups: [{ key: 'identity', label: 'Eight synthetic fields', required: true, fields },
                    { key: 'resume', label: 'Resume', required: true, fields: [{ key: 'cv', label: 'Resume', type: 'file_upload', required: true, value: application.material.id }] }],
                checklist: [{ key: 'no_resume_parser', label: 'Synthetic portal stores attachments without parsing', required: true, state: 'not_applicable', observation_ref: 'The local fixture has no resume parser; attachment completion is directly observed.' }] }).plan;
        }
        const batch = startBatch(fixture);
        assert.equal(approveBatch(fixture, batch).grant.mode, 'prefill_only');
        const queueCall = (operation, extra = {}) => run('apply_batch', { operation, batch_id: batch.id, ...(operation === 'status' ? {} : { session_id: session }), ...extra });
        const applications = new Map(fixture.apps.map(application => [application.app.id, application]));
        fixture.apps[0].portal.failureAfter = 3;

        async function drive(application) {
            const { portal, plan, app } = application;
            for (;;) {
                const packet = run('context', { scope: 'execution', application_id: app.id }), spec = packet.next_batch;
                if (!spec) break;
                const controls = await portal.controls(), current = await portal.readFields();
                const before = spec.kind === 'file_upload' ? [await portal.readUpload()] : current.filter(field => spec.field_keys.includes(field.key));
                const base = { application_id: app.id, plan_hash: plan.content_hash, session_id: session, portal_url: portal.url,
                    page_fingerprint: plan.page_fingerprint, observed_at: now(), batch_number: spec.number, controls, protected_fields: current };
                if (spec.recovery_required) {
                    const recovery = run('checkpoint', { ...base, phase: 'recover', portal_saved: await portal.isSaved(), groups: [{ key: spec.group_key, fields: before }] });
                    assert.notEqual(recovery.state, 'conflict');
                    if (recovery.state === 'complete') continue;
                    assert.equal(recovery.state, 'recovered');
                }
                if (!payload && spec.kind === 'ordinary') {
                    const full = run('context', { scope: 'application', application_id: app.id });
                    const compact = run('context', { scope: 'execution', application_id: app.id });
                    payload = { measurement: 'UTF-8 bytes of JSON.stringify(service response.data), same application and stored state',
                        full_application_bytes: bytes(full), execution_packet_bytes: bytes(compact), target_fields: compact.next_batch.targets.length,
                        reduction_percent: Number((100 * (1 - bytes(compact) / bytes(full))).toFixed(2)), write_authority: compact.next_batch.write_authority };
                    assert.equal(compact.next_batch.write_authority, false);
                    assert(bytes(compact) < bytes(full));
                }
                const receipt = run('checkpoint', { ...base, phase: 'prepare', groups: [{ key: spec.group_key, fields: before }] });
                if (spec.kind === 'file_upload') {
                    await portal.upload(receipt.targets[0]); await portal.save();
                    run('checkpoint', { ...base, phase: 'complete', observed_at: now(), portal_saved: await portal.isSaved(), controls: await portal.controls(), protected_fields: await portal.readFields(),
                        groups: [{ key: spec.group_key, fields: [await portal.readUpload()] }] });
                    continue;
                }
                assert.equal(spec.kind, 'ordinary');
                if (!baseline) {
                    const comparator = new Portal('baseline', fields); portals.set(comparator.id, comparator);
                    if (context) { comparator.page = await context.newPage(); await comparator.page.goto(comparator.url); }
                    const result = await executeBeta17Batch(comparator.tab, receipt);
                    assert.equal(result.state, 'complete');
                    baseline = { source_commit: '9b0f1d0', source: 'frozen beta.17 executeOrdinaryBatch, executed with identical prepared targets',
                        state: result.state, calls: { ...comparator.calls }, browser_calls: Object.values(comparator.calls).reduce((sum, value) => sum + value, 0) };
                }
                portal.resetCalls();
                const result = await executeOrdinaryBatch(portal.tab, receipt);
                const measured = Object.values(portal.calls).reduce((sum, value) => sum + value, 0);
                assert.equal(result.metrics.browser_calls, measured);
                reports.push({ application_number: Number(portal.id), state: result.state, code: result.code, counts: result.counts, metrics: result.metrics, measured_calls: { ...portal.calls } });
                if (result.state === 'complete') await portal.save();
                run('checkpoint', { ...base, phase: 'complete', observed_at: now(), portal_saved: await portal.isSaved(),
                    groups: [{ key: spec.group_key, fields: result.state === 'complete' ? await portal.readFields() : result.observations }] });
                if (result.state !== 'complete') return result;
            }
            assert(await portal.isSaved());
            const review = run('review', { application_id: app.id, portal_url: portal.url, controls: await portal.controls() });
            assert.equal(review.ready, true, JSON.stringify(review.blockers));
            return { state: 'complete' };
        }

        let restartDone = false, completed = 0, finalQueue, backoffWaitMs = 0;
        for (let step = 0; step < 30; step++) {
            const selected = queueCall(restartDone && restarts.at(-1)?.claim_after_restart === null ? 'resume' : 'next');
            if (!selected.item) {
                if (selected.queue.state === 'waiting') {
                    const pause = Math.max(1, Date.parse(selected.queue.next.retry_at) - Date.now() + 5);
                    assert(pause < 2000, 'The fixture should wait only for its one-second retry delay');
                    const started = performance.now(); await wait(pause); backoffWaitMs += performance.now() - started; continue;
                }
                finalQueue = selected.queue; break;
            }
            const item = selected.item, application = applications.get(item.application_id);
            claims.push({ application_number: Number(application.portal.id), phase: item.next.action, attempts: item.attempts });
            if (restartDone && restarts.at(-1).claim_after_restart === null) restarts.at(-1).claim_after_restart = Number(application.portal.id);
            const result = await drive(application);
            if (result.state !== 'complete') {
                queueCall('defer', { application_id: item.application_id, claim_id: item.claim_id, reason: 'host_unavailable', error_code: result.code, retry_after_ms: 1000 });
            } else completed++;
            if (!restartDone && completed === 4) {
                const before = queueCall('status');
                store.close(); store = new Store(fixture.dir); fixture.store = store;
                const after = queueCall('status');
                assert.deepEqual(after.queue.ready_application_ids, before.queue.ready_application_ids);
                restarts.push({ kind: 'sqlite_store_close_and_reopen', completed_drafts_preserved: after.queue.ready_application_ids.length, claim_after_restart: null });
                restartDone = true;
            }
        }
        assert(finalQueue); assert.equal(finalQueue.state, 'ready_for_user'); assert.equal(finalQueue.ready_application_ids.length, 10);
        const current = reports.find(report => report.state === 'complete' && report.counts.written === 8);
        assert(current); assert.equal(baseline.browser_calls, 40); assert.equal(current.metrics.browser_calls, 25);
        const recovered = reports.filter(report => report.application_number === 1);
        assert.equal(recovered.length, 2); assert.equal(recovered[0].state, 'unknown'); assert.equal(recovered[1].counts.skipped, 3); assert.equal(recovered[1].counts.written, 5);
        const fieldWrites = fixture.apps.map(application => ({ application_number: Number(application.portal.id),
            counts: Object.fromEntries(fields.map(field => [field.key, application.portal.writes.filter(key => key === field.key).length])) }));
        assert(fieldWrites.every(row => Object.values(row.counts).every(count => count === 1)));
        assert(fixture.apps.every(application => application.portal.uploads === 1 && application.portal.submits === 0));
        assert.equal(store.all('submit_attempt').length, 0); assert.equal(externalRequests, 0);
        for (const application of fixture.apps) {
            const clear = call(store, 'jobos1_apply_batch', { operation: 'clear_submit', batch_id: batch.id, application_id: application.app.id, session_id: session });
            assert.equal(clear.error?.code, 'submit_disabled');
            assert.equal(store.get('application', application.app.id).stage, 'preparing');
        }
        return {
            benchmark: 'application_batch_v1', status: 'passed', engine, fallback_reason: installed.reason,
            scope: 'Synthetic data only. Browser API counts exclude prepare, save and service calls. Byte counts are not token counts. Wall time is measured locally, not a recruiting-portal speed claim.',
            browser_calls: { fields: 8, baseline, current: { calls: current.measured_calls, browser_calls: current.metrics.browser_calls },
                reduction_percent: Number((100 * (1 - current.metrics.browser_calls / baseline.browser_calls)).toFixed(2)) },
            context_payload: payload,
            queue: { jobs: 10, mode: 'prefill_only', final_state: finalQueue.state, ready_for_user: finalQueue.ready_application_ids.length,
                injected_failure: 'transport exception after the third applied field on application 1', claims, restart: restarts[0],
                recovered_application: { written_before_interruption: recovered[0].counts.written, skipped_on_resume: recovered[1].counts.skipped, written_on_resume: recovered[1].counts.written },
                per_field_writes: fieldWrites, ordinary_execution_attempts: reports.length,
                measured_browser_calls: reports.reduce((sum, report) => sum + report.metrics.browser_calls, 0),
                measured_backoff_wait_ms: Number(backoffWaitMs.toFixed(3)) },
            safety: { external_requests: externalRequests, submission_clicks: [...portals.values()].reduce((sum, portal) => sum + portal.submits, 0),
                submit_attempt_records: store.all('submit_attempt').length, all_applications_still_preparing: true, real_personal_data: false },
            measured_elapsed_ms: Number((performance.now() - wallStarted).toFixed(3))
        };
    } finally {
        await browser?.close();
        try { store?.close(); } catch { /* The benchmark may fail at a reopen boundary. */ }
        if (fixture) rmSync(fixture.dir, { recursive: true, force: true });
    }
}

try { console.log(JSON.stringify(await main(), null, 2)); }
catch (error) { console.error(JSON.stringify({ benchmark: 'application_batch_v1', status: 'failed', error: error.message })); process.exitCode = 1; }
