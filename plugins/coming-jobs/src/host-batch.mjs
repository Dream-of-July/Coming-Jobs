/** Copy this fixed function into the current host runtime after reading its docs.
 * Pass only a persisted checkpoint(prepare) result. No dynamic imports/eval.
 * All DOM evaluation is read-only; mutations use documented locator methods.
 * Dynamic controls and attachments use separately observed host operations.
 */
export async function executeOrdinaryBatch(tab, batch, { settle } = {}) {
    const observations = [], visited = [];
    let active, finalRead = false;
    const fail = code => { throw new Error(code); };
    const locate = field => {
        const spec = field.locator, p = tab.playwright;
        const method = { label: 'getByLabel', role: 'getByRole', placeholder: 'getByPlaceholder', testid: 'getByTestId', css: 'locator' }[spec?.kind];
        if (!spec?.value || typeof p?.[method] !== 'function') fail('observed_locator_required');
        return spec.kind === 'role' ? p[method](spec.value, { name: spec.name, exact: true })
            : ['css', 'testid'].includes(spec.kind) ? p[method](spec.value) : p[method](spec.value, { exact: true });
    };
    const boundary = async () => {
        const expiry = Date.parse(batch.grant?.expires_at);
        if (!Number.isFinite(expiry) || expiry <= Date.now() || typeof tab.url !== 'function'
            || new URL(await tab.url()).origin !== batch.scope?.origin
            || batch.grant.origin && batch.grant.origin !== batch.scope.origin) fail('boundary_changed');
    };
    // A single read function supports a legacy one-label host call and the final
    // multi-field read. ARIA labels have the same precedence as semantic locators.
    const readLabels = input => {
        const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
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
            if (matches.length !== 1) return { key: field.key, match_count: matches.length, read_state: 'unreadable' };
            const el = matches[0];
            if (el.type === 'password' || el.getAttribute('autocomplete') === 'one-time-code') return { key: field.key, match_count: 1, read_state: 'unreadable' };
            return { key: field.key, value: el.type === 'checkbox' ? el.checked : el.value, maxLength: el.maxLength,
                disabled: el.disabled, readOnly: el.readOnly, match_count: 1 };
        };
        return typeof input === 'string' ? read({ label: input }) : input.map(read);
    };
    const record = (field, state) => ({ key: field.key, ...(state?.value === undefined ? {} : { value: state.value }),
        read_state: state?.read_state === 'unreadable' || state?.value === undefined || state.match_count !== undefined && state.match_count !== 1 ? 'unreadable' : 'known' });
    const read = async (field, locator = locate(field)) => {
        if (typeof locator?.count !== 'function' || await locator.count() !== 1) fail('unique_match_required');
        let state;
        if (typeof locator.evaluate === 'function') state = await locator.evaluate(el => {
            if (el.type === 'password' || el.getAttribute('autocomplete') === 'one-time-code') return { read_state: 'unreadable' };
            return { value: el.type === 'checkbox' ? el.checked : el.value, maxLength: el.maxLength, disabled: el.disabled, readOnly: el.readOnly };
        });
        else {
            if (field.locator.kind !== 'label' || typeof tab.playwright.evaluate !== 'function') fail('read_adapter_required');
            state = await tab.playwright.evaluate(readLabels, field.locator.value);
        }
        if (record(field, state).read_state !== 'known') fail('field_unreadable');
        return state;
    };
    const readMany = async fields => {
        if (fields.length && fields.every(field => field.locator.kind === 'label') && typeof tab.playwright.evaluate === 'function') {
            const states = await tab.playwright.evaluate(readLabels, fields.map(field => ({ key: field.key, label: field.locator.value })));
            if (Array.isArray(states)) {
                if (states.length !== fields.length || new Set(states.map(state => state?.key)).size !== fields.length
                    || states.some(state => !fields.some(field => field.key === state?.key))) fail('readback_mismatch');
                const result = [];
                for (const field of fields) {
                    let state = record(field, states.find(state => state.key === field.key));
                    // Native locators may reach a shadow tree or control absent
                    // from a main-document scan. Re-read only that field.
                    if (state.read_state === 'unreadable') {
                        try { state = record(field, await read(field)); } catch { /* Preserve unreadable. */ }
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
            catch { result.push({ key: field.key, read_state: 'unreadable' }); }
        }
        return result;
    };
    try {
        if (batch?.state !== 'pending' || !batch.id || !Array.isArray(batch.targets) || !batch.targets.length || batch.targets.length > 8
            || !Array.isArray(batch.before) || new Set(batch.targets.map(field => field.key)).size !== batch.targets.length) fail('invalid_batch');
        for (const field of batch.targets) {
            active = field.key;
            visited.push(field);
            if (field.manual || !['free_text', 'url', 'checkbox'].includes(field.type)) fail('separate_control_required');
            await boundary();
            const locator = locate(field), before = await read(field, locator);
            const originals = batch.before.filter(observation => observation.key === field.key);
            if (originals.length !== 1 || originals[0].value === undefined || originals[0].read_state === 'unreadable') fail('before_required');
            if (before.value !== originals[0].value && before.value !== field.value) fail('user_edit');
            if (typeof field.value === 'string' && before.maxLength >= 0 && field.value.length > before.maxLength) fail('length_limit');
            if (before.value !== field.value) {
                if (before.disabled || before.readOnly) fail('control_not_editable');
                const method = field.type === 'checkbox' ? 'setChecked' : 'fill';
                if (typeof locator[method] !== 'function') fail('write_adapter_required');
                await locator[method](field.value);
                if (settle) await settle(field); // Bounded host readiness read; never a write retry.
            }
            active = null;
        }
        await boundary();
        observations.push(...await readMany(batch.targets));
        finalRead = true;
        if (batch.targets.some(field => !observations.some(state => state.key === field.key && state.read_state === 'known' && state.value === field.value))) fail('readback_mismatch');
        return { batch_id: batch.id, observations, state: 'complete' };
    } catch {
        if (!finalRead && visited.length) {
            // An interrupted write may have taken effect. Recover by reading only;
            // no control is written a second time, even after a transport error.
            try { await boundary(); observations.push(...await readMany(visited)); }
            catch { for (const field of visited) observations.push({ key: field.key, read_state: 'unreadable' }); }
        }
        if (active && !observations.some(state => state.key === active)) observations.push({ key: active, read_state: 'unreadable' });
        return { batch_id: batch?.id, observations, state: 'unknown', next: 'readonly_recovery' };
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
 * Both callbacks are read-only and must enforce their host's bounded read timeout.
 *
 * The helper never requests/resends a code, clicks a challenge or submit button,
 * persists data, or repeats a code write. A pending status after entry is not a
 * successful login. A known login-only confirmation can be handled by the host
 * under the same authorization; application submission is a separate boundary.
 */
export async function executeVerificationCode(tab, request, { authorization, receiveCode, readStatus,
    now = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)), pollIntervalMs = 250, maxWaitMs = 15000 } = {}) {
    const outcome = (state, next) => ({ state, next });
    let code, writeStarted = false;
    try {
        if (typeof now !== 'function' || typeof wait !== 'function' || typeof receiveCode !== 'function' || typeof readStatus !== 'function'
            || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 25 || pollIntervalMs > 1000
            || !Number.isInteger(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > 60000)
            return outcome('blocked', 'host_auth_adapter_required');
        const startedAt = now(), requestedAt = Date.parse(request?.requested_at), expiresAt = Date.parse(request?.expires_at), grantExpiresAt = Date.parse(authorization?.expires_at);
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
        // Snapshot scope before invoking a callback; callback mutation cannot
        // widen the authorized origin/account/channel or extend the deadline.
        const scope = { purpose: 'login', request_id: request.request_id, origin: request.origin, account: request.account,
            channel: request.channel, requested_at: request.requested_at, expires_at: request.expires_at };
        const boundary = async () => {
            const time = now();
            if (!Number.isFinite(time) || time < startedAt || time >= grantExpiresAt) return outcome('blocked', 'resolve_auth_scope');
            if (time >= expiresAt) return outcome('expired', 'observe_current_auth_request');
            if (new URL(await tab.url()).origin !== scope.origin) return outcome('blocked', 'observe_current_auth_request');
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
        let status = statusOutcome(await readStatus({ ...scope }));
        if (status) return status;
        const spec = request.locator, p = tab.playwright;
        const method = { label: 'getByLabel', role: 'getByRole', placeholder: 'getByPlaceholder', testid: 'getByTestId', css: 'locator' }[spec?.kind];
        if (!spec?.value || typeof p?.[method] !== 'function') return outcome('blocked', 'host_auth_adapter_required');
        const locator = spec.kind === 'role' ? p[method](spec.value, { name: spec.name, exact: true })
            : ['css', 'testid'].includes(spec.kind) ? p[method](spec.value) : p[method](spec.value, { exact: true });
        if (typeof locator?.count !== 'function' || typeof locator.fill !== 'function' || await locator.count() !== 1)
            return outcome('blocked', 'observe_current_auth_request');
        const deadline = Math.min(startedAt + maxWaitMs, expiresAt, grantExpiresAt), maxPolls = Math.ceil(maxWaitMs / pollIntervalMs);
        for (let attempt = 0; attempt <= maxPolls; attempt++) {
            blocked = await boundary();
            if (blocked) return blocked;
            if (attempt) {
                status = statusOutcome(await readStatus({ ...scope }));
                if (status) return status;
            }
            // Always read immediately before considering a wait. Stale messages
            // are ignored; they never cause a resend or a second write.
            let message = await receiveCode({ ...scope });
            blocked = await boundary();
            if (blocked) return blocked;
            const receivedAt = Date.parse(message?.received_at);
            if (message && message.request_id === scope.request_id && message.origin === scope.origin
                && message.account === scope.account && message.channel === scope.channel
                && Number.isFinite(receivedAt) && receivedAt >= requestedAt && receivedAt <= now() && receivedAt < expiresAt
                && typeof message.code === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(message.code)) {
                code = message.code;
                message = null;
                writeStarted = true;
                await locator.fill(code);
                code = undefined;
                blocked = await boundary();
                if (blocked) return outcome('unknown', 'readonly_auth_status');
                return statusOutcome(await readStatus({ ...scope }), true);
            }
            message = null;
            const remaining = deadline - now();
            if (remaining <= 0 || attempt === maxPolls) return outcome('unavailable', 'await_current_code');
            await wait(Math.min(pollIntervalMs, remaining));
        }
        return outcome('unavailable', 'await_current_code');
    } catch {
        // Host errors may echo a filled value. Never return their message, stack,
        // request, or raw readback. An attempted write must be checked read-only.
        return writeStarted ? outcome('unknown', 'readonly_auth_status') : outcome('unavailable', 'await_current_code');
    } finally {
        code = undefined;
    }
}
