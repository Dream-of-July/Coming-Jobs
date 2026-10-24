/** Copy this fixed function into the current host runtime after reading its docs.
 * Pass only a persisted checkpoint(prepare) result. No dynamic imports/eval.
 * All DOM evaluation is read-only; mutations use documented locator methods.
 * Dynamic controls, agreements and attachments use separately observed operations.
 * Read-only calls have a local timeout; the batch budget is cooperative. A native
 * write is always awaited: only the host can cancel it or bound its auto-wait.
 * Never replace that await with Promise.race, which could leave a late write.
 * metrics count calls made here, not calls hidden inside host callbacks. written
 * counts attempted fields whose final observed value matches; skipped counts
 * fields already at target; recovered counts readable fields after an error.
 */
export async function executeOrdinaryBatch(tab, batch, { settle, maxDurationMs = 15000, readTimeoutMs = 2000, now = () => Date.now() } = {}) {
    const observations = [], visited = [];
    const attempted = new Set(), skipped = new Set(), failures = new WeakSet();
    const metrics = { browser_calls: 0, browser_reads: 0, browser_writes: 0, callback_reads: 0, read_timeouts: 0, elapsed_ms: 0 };
    const wallStarted = Date.now();
    let active, finalRead = false, phase = 'validate', startedAt, deadline, expiry, scopeOrigin, targets = [], originals = [], recovered = 0, stop = false;
    const fault = code => { const error = new Error(code); failures.add(error); return error; };
    const fail = code => { throw fault(code); };
    const codeOf = error => failures.has(error) ? error.message : error?.name === 'TimeoutError' ? 'host_timeout' : 'host_operation_failed';
    const checkTime = () => {
        const time = now();
        if (!Number.isFinite(time) || time < startedAt) fail('invalid_clock');
        if (time >= expiry) fail('lease_expired');
        if (time >= deadline) fail('deadline_exceeded');
        return time;
    };
    // A late read result has no continuation that can write. Timers are never
    // applied to locator.fill/setChecked, whose cancellation is host-owned.
    const readonly = async (operation, callback = false) => {
        const time = checkTime();
        if (callback) metrics.callback_reads++;
        else { metrics.browser_calls++; metrics.browser_reads++; }
        let timer;
        try {
            const value = await new Promise((resolve, reject) => {
                timer = setTimeout(() => { metrics.read_timeouts++; stop = true; reject(fault('read_timeout')); }, Math.max(1, Math.min(readTimeoutMs, deadline - time, expiry - time)));
                Promise.resolve().then(operation).then(resolve, reject);
            });
            checkTime();
            return value;
        } finally { clearTimeout(timer); }
    };
    const originCheck = async states => {
        checkTime();
        const origins = states.map(state => state?.origin);
        if (origins.some(origin => origin !== undefined && origin !== null && origin !== scopeOrigin)) fail('origin_changed');
        if (!origins.length || origins.some(origin => origin === undefined || origin === null)) {
            if (typeof tab?.url !== 'function') fail('origin_adapter_required');
            if (new URL(await readonly(() => tab.url())).origin !== scopeOrigin) fail('origin_changed');
        }
    };
    const response = (state, code = null, failure = null) => {
        metrics.elapsed_ms = Math.max(0, Date.now() - wallStarted);
        const written = targets.filter(field => attempted.has(field.key) && observations.some(value => value.key === field.key && value.read_state === 'known' && value.value === field.value)).length;
        const next = code === 'agreement_requires_observation' ? 'observe_agreement'
            : code === 'separate_control_required' ? 'observe_separate_control'
            : [code, failure?.recovery_code].some(value => ['deadline_exceeded', 'read_timeout', 'host_timeout'].includes(value)) ? 'continue_other_work_then_readonly_recovery'
            : code === 'user_edit' ? 'preserve_user_edit' : state === 'complete' ? 'checkpoint_complete' : 'readonly_recovery';
        return { batch_id: batch?.id, observations, state, code, next, failure,
            counts: { written, skipped: skipped.size, recovered }, metrics,
            limits: { max_duration_ms: maxDurationMs, read_timeout_ms: readTimeoutMs, native_write_timeout: 'host_owned' } };
    };
    const locate = field => {
        const spec = field.locator, p = tab?.playwright;
        const method = { label: 'getByLabel', role: 'getByRole', placeholder: 'getByPlaceholder', testid: 'getByTestId', css: 'locator' }[spec?.kind];
        if (!spec?.value || typeof p?.[method] !== 'function') fail('observed_locator_required');
        return spec.kind === 'role' ? p[method](spec.value, { name: spec.name, exact: true })
            : ['css', 'testid'].includes(spec.kind) ? p[method](spec.value) : p[method](spec.value, { exact: true });
    };
    // A single read function supports a legacy one-label host call and the final
    // multi-field read. ARIA labels have the same precedence as semantic locators.
    const readLabels = input => {
        const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
        const origin = typeof location === 'object' ? location.origin : undefined;
        const controls = [...document.querySelectorAll('input,textarea,select')];
        const named = (el, name) => {
            const ids = el.getAttribute('aria-labelledby')?.trim().split(/\s+/).filter(Boolean) ?? [];
            const labels = ids.map(id => document.getElementById(id)).filter(Boolean);
            if (labels.length) return normalize(labels.map(label => label.textContent).join(' ')) === name;
            const aria = el.getAttribute('aria-label');
            if (aria?.trim()) return normalize(aria) === name;
            return [...(el.labels ?? [])].some(label => normalize(label.textContent) === name);
        };
        const read = field => {
            const matches = controls.filter(el => named(el, normalize(field.label)));
            if (matches.length !== 1) return { key: field.key, origin, match_count: matches.length, read_state: 'unreadable' };
            const el = matches[0];
            if (el.type === 'password' || el.getAttribute('autocomplete') === 'one-time-code') return { key: field.key, origin, match_count: 1, read_state: 'unreadable' };
            return { key: field.key, origin, value: el.type === 'checkbox' ? el.checked : el.value, maxLength: el.maxLength,
                disabled: el.disabled, readOnly: el.readOnly, match_count: 1 };
        };
        return typeof input === 'string' ? read({ label: input }) : input.map(read);
    };
    const record = (field, state) => ({ key: field.key, ...(state?.value === undefined ? {} : { value: state.value }),
        read_state: state?.read_state === 'unreadable' || state?.value === undefined || state.match_count !== undefined && state.match_count !== 1 ? 'unreadable' : 'known' });
    const read = async (field, locator = locate(field)) => {
        if (typeof locator?.count !== 'function' || await readonly(() => locator.count()) !== 1) fail('unique_match_required');
        let state;
        if (typeof locator.evaluate === 'function') state = await readonly(() => locator.evaluate(el => {
            const origin = el.ownerDocument?.location?.origin ?? (typeof location === 'object' ? location.origin : undefined);
            if (el.type === 'password' || el.getAttribute('autocomplete') === 'one-time-code') return { origin, read_state: 'unreadable' };
            return { origin, value: el.type === 'checkbox' ? el.checked : el.value, maxLength: el.maxLength, disabled: el.disabled, readOnly: el.readOnly };
        }));
        else {
            if (field.locator.kind !== 'label' || typeof tab.playwright.evaluate !== 'function') fail('read_adapter_required');
            state = await readonly(() => tab.playwright.evaluate(readLabels, field.locator.value));
        }
        // The current origin and value share a read-only observation. Older host
        // facades without a DOM origin retain the explicit tab.url() fallback.
        await originCheck([state]);
        if (record(field, state).read_state !== 'known') fail('field_unreadable');
        return state;
    };
    const readMany = async fields => {
        if (fields.length && fields.every(field => field.locator.kind === 'label') && typeof tab.playwright.evaluate === 'function') {
            const states = await readonly(() => tab.playwright.evaluate(readLabels, fields.map(field => ({ key: field.key, label: field.locator.value }))));
            if (Array.isArray(states)) {
                if (states.length !== fields.length || new Set(states.map(state => state?.key)).size !== fields.length
                    || states.some(state => !fields.some(field => field.key === state?.key))) fail('readback_mismatch');
                await originCheck(states);
                const result = [];
                for (const field of fields) {
                    let state = record(field, states.find(state => state.key === field.key));
                    // Native locators may reach a shadow tree or control absent
                    // from a main-document scan. Re-read only that field.
                    if (state.read_state === 'unreadable') {
                        try { state = record(field, await read(field)); }
                        catch (error) { if (stop || ['deadline_exceeded', 'lease_expired', 'invalid_clock', 'origin_changed'].includes(codeOf(error))) throw error; }
                    }
                    result.push(state);
                }
                return result;
            }
            // Older host facades may support only a single-label evaluation.
        }
        const result = [];
        for (const field of fields) {
            try { result.push(record(field, await read(field))); }
            catch (error) {
                if (stop || ['deadline_exceeded', 'lease_expired', 'invalid_clock', 'origin_changed'].includes(codeOf(error))) throw error;
                result.push({ key: field.key, read_state: 'unreadable' });
            }
        }
        return result;
    };
    try {
        if (typeof now !== 'function' || !Number.isInteger(maxDurationMs) || maxDurationMs < 0 || maxDurationMs > 60000
            || !Number.isInteger(readTimeoutMs) || readTimeoutMs < 1 || readTimeoutMs > 10000 || settle && typeof settle !== 'function') fail('invalid_options');
        startedAt = now();
        if (!Number.isFinite(startedAt)) fail('invalid_clock');
        deadline = startedAt + maxDurationMs;
        expiry = Date.parse(batch?.grant?.expires_at);
        scopeOrigin = batch?.scope?.origin;
        if (!Number.isFinite(expiry) || expiry <= startedAt || !scopeOrigin || new URL(scopeOrigin).origin !== scopeOrigin
            || batch?.grant?.origin && batch.grant.origin !== scopeOrigin) fail('boundary_changed');
        if (batch?.state !== 'pending' || !batch.id || !Array.isArray(batch.targets) || !batch.targets.length || batch.targets.length > 8
            || !Array.isArray(batch.before) || new Set(batch.targets.map(field => field.key)).size !== batch.targets.length) fail('invalid_batch');
        targets = batch.targets.map(field => ({ ...field, locator: field.locator ? { ...field.locator } : undefined }));
        originals = batch.before.map(observation => ({ ...observation }));
        // Reject a mixed batch before ordinary fields have already been written.
        for (const field of targets) {
            active = field.key;
            if (field.type === 'agreement') fail('agreement_requires_observation');
            if (field.manual || !['free_text', 'url', 'checkbox'].includes(field.type)) fail('separate_control_required');
            if (field.type === 'checkbox' ? typeof field.value !== 'boolean' : typeof field.value !== 'string') fail('field_value_type');
            const original = originals.filter(observation => observation.key === field.key);
            if (original.length !== 1 || original[0].value === undefined || original[0].read_state === 'unreadable') fail('before_required');
        }
        for (const field of targets) {
            active = field.key;
            visited.push(field);
            phase = 'read_before';
            checkTime();
            const locator = locate(field), before = await read(field, locator);
            const original = originals.find(observation => observation.key === field.key);
            if (before.value !== original.value && before.value !== field.value) fail('user_edit');
            if (typeof field.value === 'string' && before.maxLength >= 0 && field.value.length > before.maxLength) fail('length_limit');
            if (before.value !== field.value) {
                if (before.disabled || before.readOnly) fail('control_not_editable');
                const method = field.type === 'checkbox' ? 'setChecked' : 'fill';
                if (typeof locator[method] !== 'function') fail('write_adapter_required');
                checkTime();
                phase = 'write';
                attempted.add(field.key);
                metrics.browser_calls++;
                metrics.browser_writes++;
                await locator[method](field.value);
                checkTime();
                if (settle) {
                    phase = 'settle';
                    await readonly(() => settle({ ...field, locator: field.locator ? { ...field.locator } : undefined }), true);
                }
            } else skipped.add(field.key);
            active = null;
        }
        phase = 'read_after';
        observations.push(...await readMany(targets));
        finalRead = true;
        const mismatch = targets.find(field => !observations.some(state => state.key === field.key && state.read_state === 'known' && state.value === field.value));
        if (mismatch) { active = mismatch.key; fail('readback_mismatch'); }
        return response('complete');
    } catch (error) {
        const code = codeOf(error), failedPhase = phase, failedField = active ?? null;
        let recoveryCode = null;
        if (!finalRead && visited.length && !stop && !['deadline_exceeded', 'lease_expired', 'invalid_clock', 'origin_changed'].includes(code)) {
            // An interrupted write may have taken effect. Recover by reading only;
            // no control is written a second time, even after a transport error.
            phase = 'recover';
            try { observations.push(...await readMany(visited)); recovered = observations.filter(state => state.read_state === 'known').length; }
            catch (recoveryError) { recoveryCode = codeOf(recoveryError); }
        }
        for (const field of visited) if (!observations.some(state => state.key === field.key)) observations.push({ key: field.key, read_state: 'unreadable' });
        if (active && !observations.some(state => state.key === active)) observations.push({ key: active, read_state: 'unreadable' });
        const category = ['deadline_exceeded', 'read_timeout', 'host_timeout'].includes(code) ? 'timeout'
            : ['user_edit', 'readback_mismatch'].includes(code) ? 'conflict' : code === 'host_operation_failed' ? 'external' : 'blocked';
        return response('unknown', code, { code, category, phase: failedPhase, field_key: failedField, write_attempted: attempted.size > 0, recovery_code: recoveryCode });
    }
}

/** Ephemeral authentication helper; never pass its request/code through a plan,
 * checkpoint, business fact, or diagnostic log. Define it in the current host
 * runtime and provide only callbacks supported by that host's current docs.
 *
 * request: {kind:'one_time_code', purpose:'login', request_id, origin, account,
 *   channel:'sms'|'email', requested_at, expires_at, locator}
 * authorization: {purpose:'login', origin, account, channel, expires_at, user_ref}
 *   user_ref points to an already applicable instruction, not a new permission.
 * receiveCode(scope): null or {code, request_id, origin, account, channel, received_at}
 * readStatus(scope): 'pending'|'accepted'|'rejected'|'expired'|'captcha'; no input values.
 * Both callbacks are read-only. Local timeouts discard late read results. The
 * whole read/poll budget is maxWaitMs, including callback latency, not only sleep.
 * Native fill is awaited once, without racing an uncancellable host mutation;
 * its actual cancellation/auto-wait limit remains a host capability requirement.
 *
 * The helper never requests/resends a code, clicks a challenge or submit button,
 * persists data, or repeats a code write. A pending status after entry is not a
 * successful login. A known login-only confirmation can be handled by the host
 * under the same authorization; application submission is a separate boundary.
 */
export async function executeVerificationCode(tab, request, { authorization, receiveCode, readStatus,
    now = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)), pollIntervalMs = 250, maxWaitMs = 15000, readTimeoutMs = 2000 } = {}) {
    const wallStarted = Date.now(), failures = new WeakSet();
    const metrics = { browser_calls: 0, browser_reads: 0, browser_writes: 0, callback_reads: 0, wait_calls: 0, read_timeouts: 0, elapsed_ms: 0 };
    const outcome = (state, next, resultCode = state) => {
        metrics.elapsed_ms = Math.max(0, Date.now() - wallStarted);
        return { state, next, code: resultCode, metrics, limits: { max_wait_ms: maxWaitMs, read_timeout_ms: readTimeoutMs, native_write_timeout: 'host_owned' } };
    };
    const fault = code => { const error = new Error(code); failures.add(error); return error; };
    const fail = code => { throw fault(code); };
    let code, writeStarted = false, startedAt, deadline, expiresAt, grantExpiresAt;
    const checkTime = () => {
        const time = now();
        if (!Number.isFinite(time) || time < startedAt || time >= grantExpiresAt) fail('authorization_expired');
        if (time >= expiresAt) fail('code_expired');
        if (time >= deadline) fail('deadline_exceeded');
        return time;
    };
    const readonly = async (operation, browser = false, waiting = false) => {
        const time = checkTime();
        if (browser) { metrics.browser_calls++; metrics.browser_reads++; }
        else if (waiting) metrics.wait_calls++;
        else metrics.callback_reads++;
        let timer;
        try {
            const value = await new Promise((resolve, reject) => {
                timer = setTimeout(() => { metrics.read_timeouts++; reject(fault('read_timeout')); }, Math.max(1, Math.min(waiting ? deadline - time : readTimeoutMs, deadline - time, expiresAt - time, grantExpiresAt - time)));
                Promise.resolve().then(operation).then(resolve, reject);
            });
            checkTime();
            return value;
        } finally { clearTimeout(timer); }
    };
    try {
        if (typeof now !== 'function' || typeof wait !== 'function' || typeof receiveCode !== 'function' || typeof readStatus !== 'function'
            || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 25 || pollIntervalMs > 1000
            || !Number.isInteger(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > 60000
            || !Number.isInteger(readTimeoutMs) || readTimeoutMs < 1 || readTimeoutMs > 10000)
            return outcome('blocked', 'host_auth_adapter_required');
        startedAt = now();
        const requestedAt = Date.parse(request?.requested_at);
        expiresAt = Date.parse(request?.expires_at);
        grantExpiresAt = Date.parse(authorization?.expires_at);
        if (!Number.isFinite(startedAt) || request?.kind !== 'one_time_code' || request.purpose !== 'login'
            || !['sms', 'email'].includes(request.channel) || typeof request.account !== 'string' || !request.account.trim()
            || typeof request.request_id !== 'string' || !request.request_id.trim()
            || !Number.isFinite(requestedAt) || requestedAt > startedAt || !Number.isFinite(expiresAt) || expiresAt <= requestedAt)
            return outcome('blocked', 'observe_current_auth_request');
        if (!authorization || authorization.purpose !== 'login' || authorization.origin !== request.origin
            || authorization.account !== request.account || authorization.channel !== request.channel
            || typeof authorization.user_ref !== 'string' || !authorization.user_ref.trim()
            || !Number.isFinite(grantExpiresAt) || grantExpiresAt <= startedAt)
            return outcome('blocked', 'resolve_auth_scope');
        const recipient = new URL(request.origin);
        if (recipient.protocol !== 'https:' || recipient.origin !== request.origin || typeof tab?.url !== 'function')
            return outcome('blocked', 'observe_current_auth_request');
        deadline = Math.min(startedAt + maxWaitMs, expiresAt, grantExpiresAt);
        // Snapshot scope before invoking a callback; callback mutation cannot
        // widen the authorized origin/account/channel or extend the deadline.
        const scope = { purpose: 'login', request_id: request.request_id, origin: request.origin, account: request.account,
            channel: request.channel, requested_at: request.requested_at, expires_at: request.expires_at };
        const boundary = async () => {
            checkTime();
            if (new URL(await readonly(() => tab.url(), true)).origin !== scope.origin) return outcome('blocked', 'observe_current_auth_request', 'origin_changed');
            return null;
        };
        const statusOutcome = (status, afterWrite = false) => {
            if (status === 'accepted') return outcome('verified', 'resume_authorized_work');
            if (status === 'captcha') return outcome('challenge', 'manual_security_challenge');
            if (status === 'expired') return outcome('expired', 'observe_current_auth_request');
            if (status === 'rejected') return outcome('rejected', 'readonly_auth_status');
            if (status === 'pending') return afterWrite ? outcome('entered', 'readonly_auth_status') : null;
            return outcome('unknown', 'readonly_auth_status');
        };
        let blocked = await boundary();
        if (blocked) return blocked;
        let status = statusOutcome(await readonly(() => readStatus({ ...scope })));
        if (status) return status;
        const spec = request.locator, p = tab.playwright;
        const method = { label: 'getByLabel', role: 'getByRole', placeholder: 'getByPlaceholder', testid: 'getByTestId', css: 'locator' }[spec?.kind];
        if (!spec?.value || typeof p?.[method] !== 'function') return outcome('blocked', 'host_auth_adapter_required');
        const locator = spec.kind === 'role' ? p[method](spec.value, { name: spec.name, exact: true })
            : ['css', 'testid'].includes(spec.kind) ? p[method](spec.value) : p[method](spec.value, { exact: true });
        if (typeof locator?.count !== 'function' || typeof locator.fill !== 'function' || await readonly(() => locator.count(), true) !== 1)
            return outcome('blocked', 'observe_current_auth_request');
        const maxPolls = Math.ceil(maxWaitMs / pollIntervalMs);
        for (let attempt = 0; attempt <= maxPolls; attempt++) {
            blocked = await boundary();
            if (blocked) return blocked;
            if (attempt) {
                status = statusOutcome(await readonly(() => readStatus({ ...scope })));
                if (status) return status;
            }
            // Always read immediately before considering a wait. Stale messages
            // are ignored; they never cause a resend or a second write.
            let message = await readonly(() => receiveCode({ ...scope }));
            blocked = await boundary();
            if (blocked) return blocked;
            const receivedAt = Date.parse(message?.received_at);
            if (message && message.request_id === scope.request_id && message.origin === scope.origin
                && message.account === scope.account && message.channel === scope.channel
                && Number.isFinite(receivedAt) && receivedAt >= requestedAt && receivedAt <= now() && receivedAt < expiresAt
                && typeof message.code === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(message.code)) {
                code = message.code;
                message = null;
                checkTime();
                writeStarted = true;
                metrics.browser_calls++;
                metrics.browser_writes++;
                await locator.fill(code);
                code = undefined;
                blocked = await boundary();
                if (blocked) return outcome('unknown', 'readonly_auth_status');
                return statusOutcome(await readonly(() => readStatus({ ...scope })), true);
            }
            message = null;
            const remaining = deadline - now();
            if (remaining <= 0 || attempt === maxPolls) return outcome('unavailable', 'await_current_code');
            await readonly(() => wait(Math.min(pollIntervalMs, remaining)), false, true);
        }
        return outcome('unavailable', 'await_current_code');
    } catch (error) {
        // Host errors may echo a filled value. Never return their message, stack,
        // request, or raw readback. An attempted write must be checked read-only.
        const resultCode = failures.has(error) ? error.message : error?.name === 'TimeoutError' ? 'host_timeout' : 'host_operation_failed';
        if (writeStarted) return outcome('unknown', 'readonly_auth_status', resultCode);
        if (resultCode === 'authorization_expired') return outcome('blocked', 'resolve_auth_scope', resultCode);
        if (resultCode === 'code_expired') return outcome('expired', 'observe_current_auth_request', resultCode);
        return outcome('unavailable', 'await_current_code', resultCode);
    } finally {
        code = undefined;
    }
}
