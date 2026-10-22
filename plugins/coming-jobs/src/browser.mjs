/** Adapts only a Tab supplied by the current host; never launches, logs in or submits. */
import { assert, equal, Fault } from './core.mjs';
import { fieldDigest } from './authorization.mjs';
export function browserCapabilities(tab) {
    const p = tab.playwright;
    return { dom: !!p, snapshot: typeof p?.domSnapshot === 'function', filechooser: typeof p?.waitForEvent === 'function',
        preserve: typeof tab.markHandoff === 'function', url: typeof tab.url === 'function',
        note: 'Only detected interfaces; AX, visual and upload adapters require current host documentation.' };
}
function locate(tab, spec) {
    assert(spec?.value, 'locator_required', '需要来自当前页面观察的唯一定位器。');
    const p = tab.playwright;
    assert(p, 'host_adapter_required', '当前宿主没有 DOM 接口，使用已记录的 AX 或视觉适配。');
    const method = { label: 'getByLabel', role: 'getByRole', placeholder: 'getByPlaceholder', testid: 'getByTestId', css: 'locator' }[spec.kind];
    assert(method && typeof p[method] === 'function', 'host_method_unavailable', '当前宿主不支持此定位方式，请用当前页面支持的定位器。');
    return p[method](spec.value, spec.kind === 'role' ? { name: spec.name, exact: true } : { exact: true });
}
async function invoke(locator, method, value) {
    assert(typeof locator?.[method] === 'function', 'host_method_unavailable', '当前宿主不支持此控件操作，使用已核验的宿主适配。');
    return locator[method](value);
}
export function assertExternalFilename(file) {
    const name = String(file ?? '').split(/[\\/]/).pop().normalize('NFKC');
    assert(name && !/(审核稿|草稿|待确认|draft|review[ _-]*copy)/i.test(name), 'external_filename_required', '请使用不含审核稿、草稿等内部标记的正式文件名，保留已审核文件字节。');
    return name;
}
export async function readControl(tab, field) {
    const locator = locate(tab, field.locator);
    assert(await invoke(locator, 'count') === 1, 'ambiguous_locator', '字段没有唯一匹配，请更新页面观察。');
    const state = await invoke(locator, 'evaluate', el => ({ value: el.type === 'checkbox' ? el.checked : el.value ?? el.textContent?.trim(),
        selected: el.tagName === 'SELECT' ? el.selectedOptions.length > 0 : el.getAttribute('aria-selected') === 'true',
        option_id: el.tagName === 'SELECT' ? el.selectedOptions[0]?.value : null,
        options: el.tagName === 'SELECT' ? [...el.options].map(o => ({ id: o.value, label: o.label, selected: o.selected })) : [] }));
    if (field.type === 'portal_select' && state.options?.length) state.value = state.options.find(o => o.selected)?.label ?? state.value;
    if (field.selected_locator) {
        const chosen = locate(tab, field.selected_locator);
        if (await invoke(chosen, 'count') === 1) state.selected = await invoke(chosen, 'isVisible');
    }
    return { key: field.key, ...state, read_state: state.value == null ? 'unreadable' : 'known' };
}
export function toObservation(record) {
    return Object.fromEntries(Object.entries(record).filter(([key, value]) => value !== undefined && value !== null && ['key', 'value', 'selected', 'option_id', 'upload_complete', 'local_sha256', 'file_name', 'file_bytes', 'file_count', 'read_state', 'portal_saved', 'file_selected', 'parse_complete', 'attachment_associated'].includes(key)));
}
export async function preserveTab(tab) {
    if (typeof tab.markHandoff === 'function') {
        await tab.markHandoff();
        return { preserved: true, method: 'markHandoff', scope: 'current_turn' };
    }
    return { preserved: false, method: 'unsupported', next: '宿主无页面保留接口；保留本地草稿并在继续时重观察，不能保证网页已保存。' };
}
export async function fillGroup(tab, group, { authorization, origin, saveBefore, saveAfter, readUpload, readField,
    writeField, refreshField, settle, savePortal, priorObservations } = {}) {
    assert(authorization && authorization.origin === origin && Date.parse(authorization.expires_at) > Date.now(), 'approval_required', '需要本次有效授权。');
    assert(typeof saveBefore === 'function' && typeof saveAfter === 'function', 'durable_draft_required', '执行前后必须连接草稿保存回调。');
    const observed = [], before = [];
    let saved = false, failure, activeField;
    const refreshed = new Set();
    async function boundary(f) {
        const actualUrl = typeof tab.url === 'function' ? await tab.url() : null;
        assert(actualUrl && new URL(actualUrl).origin === origin, 'origin_changed', '当前浏览器接收方不匹配。');
        assert(Date.parse(authorization.expires_at) > Date.now(), 'lease_expired', '执行占用已到期，保留进度后复用适用授权续期。');
        if (f && authorization.field_grants) assert(authorization.field_grants[f.key] === fieldDigest(f), 'approval_required', '此字段内容变化，现有授权不适用。');
    }
    const readOnce = async f => {
        const value = f.type === 'file_upload' ? await readUpload(f) : await (readField ?? (x => readControl(tab, x)))(f);
        assert(value?.key === f.key, 'observation_mismatch', '回读必须对应当前字段。');
        return value;
    };
    const read = async f => {
        try { return await readOnce(f); }
        catch (e) {
            if (!refreshField || refreshed.has(f.key) || !['ambiguous_locator', 'host_method_unavailable'].includes(e.code)) throw e;
            refreshed.add(f.key);
            // Only locators may change, even if a host callback mutates its input.
            // Recovery is read-only and is never a reason to repeat a write.
            const fresh = await refreshField(structuredClone(f));
            Object.assign(f, { locator: fresh?.locator, selected_locator: fresh?.selected_locator });
            await boundary(f);
            return readOnce(f);
        }
    };
    const retained = (f, state) => f.type === 'file_upload'
        ? state.upload_complete && state.file_name === assertExternalFilename(f.local_file)
        : equal(state.value, f.value) && (f.type !== 'portal_select' || state.selected);
    const persist = async () => saveAfter({ group: group.key, before: before.map(toObservation), fields: observed.map(toObservation) });
    try {
        await boundary();
        for (const f of group.fields) {
            if (f.manual || f.type === 'sensitive_user_owned') continue;
            await boundary(f);
            if (f.type === 'file_upload') {
                assertExternalFilename(f.local_file);
                assert(typeof readUpload === 'function', 'upload_adapter_required', '附件需要真实门户回读，不能用控件数量冒充校验。');
            }
            const current = await read(f);
            assert(current.read_state !== 'unreadable', 'field_unreadable', '尚未读到字段值；先使用当前宿主的视觉或表单读取，不当作空值。');
            const prior = priorObservations?.find(x => x.key === f.key);
            if (prior && !equal(toObservation(prior), toObservation(current)) && !equal(current.value, f.value))
                throw new Fault('user_edit_conflict', '页面存在新的修改，保留该区域并先完成其他区域。');
            before.push(current);
        }
        await saveBefore({ group: group.key, before: before.map(toObservation), target: group.fields });
        saved = true;
        for (const f of group.fields) {
            if (f.manual || f.type === 'sensitive_user_owned') continue;
            activeField = f;
            await boundary(f);
            const initial = before.find(v => v.key === f.key);
            const old = await read(f);
            assert(old.read_state !== 'unreadable', 'field_unreadable', '写入前尚未读到字段值。');
            if (!equal(toObservation(initial), toObservation(old)) && !retained(f, old)) {
                observed.push(old);
                throw new Fault('user_edit_conflict', '页面存在新的修改，保留该区域并先完成其他区域。');
            }
            if (f.type !== 'file_upload' && equal(old?.value, f.value) && (f.type !== 'portal_select' || old.selected)) {
                observed.push(old); await persist(); continue;
            }
            if (f.type === 'file_upload' && old.local_sha256 === f.material.sha256 && old.upload_complete && old.file_name === assertExternalFilename(f.local_file)) {
                observed.push(old); await persist(); continue;
            }
            if (writeField) await writeField(f);
            else {
                const locator = locate(tab, f.locator);
                assert(await invoke(locator, 'count') === 1, 'ambiguous_locator', '动态页面字段已变化，保留已完成部分后重新观察。');
                if (f.type === 'portal_select') {
                    if (old.options?.length) {
                        const choices = old.options.filter(o => f.option_id ? o.id === f.option_id : o.label === f.value);
                        assert(choices.length === 1, 'ambiguous_option', '门户选项不唯一，不能仅输入文字。');
                        await invoke(locator, 'selectOption', { value: choices[0].id });
                    } else {
                        await invoke(locator, 'click');
                        assert(typeof tab.playwright.domSnapshot === 'function', 'host_method_unavailable', '动态选择需要新页面观察。');
                        await tab.playwright.domSnapshot();
                        const option = locate(tab, { kind: 'role', value: 'option', name: String(f.value) });
                        assert(await invoke(option, 'count') === 1, 'ambiguous_option', '下拉候选项不唯一。');
                        await invoke(option, 'click');
                    }
                } else if (f.type === 'checkbox') await invoke(locator, 'setChecked', Boolean(f.value));
                else if (f.type === 'file_upload') {
                    assert(browserCapabilities(tab).filechooser, 'host_method_unavailable', '当前宿主需要专用上传适配。');
                    const chooserPromise = tab.playwright.waitForEvent('filechooser', { timeoutMs: 10000 });
                    chooserPromise.catch(() => {});
                    await invoke(locator, 'click');
                    await invoke(await chooserPromise, 'setFiles', f.local_file);
                } else await invoke(locator, 'fill', String(f.value));
            }
            if (settle) await settle(f); // Host-documented bounded readiness wait, never retry the write.
            await boundary(f);
            const state = await read(f);
            observed.push(state);
            await persist();
            if (f.type === 'file_upload') assert(state.upload_complete && state.file_name === assertExternalFilename(f.local_file), 'upload_not_verified', '附件尚未上传完成或正式名称不符。');
            else assert(equal(state.value, f.value) && (f.type !== 'portal_select' || state.selected), 'value_not_retained', '页面实际值尚未保持目标状态。');
        }
        const fields = group.fields.filter(f => !f.manual && f.type !== 'sensitive_user_owned');
        if (savePortal || fields.length > 1) {
            await boundary();
            if (savePortal) { await savePortal(); await boundary(); }
            const prior = observed.map(toObservation);
            // Later controls or portal saves may reset earlier values. Completion
            // must describe the final group, not a series of earlier successes.
            for (const f of fields) {
                activeField = f;
                let state;
                try { state = await read(f); }
                catch (e) {
                    const index = observed.findIndex(o => o.key === f.key);
                    if (index >= 0) observed[index] = { key: f.key, read_state: 'unreadable' };
                    throw e;
                }
                const index = observed.findIndex(o => o.key === f.key);
                if (index < 0) observed.push(state); else observed[index] = state;
            }
            if (savePortal) await saveAfter({ group: group.key, before: before.map(toObservation), fields: observed.map(toObservation), portal_saved: true });
            else if (!equal(prior, observed.map(toObservation))) await persist();
            for (const f of fields) {
                const state = observed.find(x => x.key === f.key);
                assert(retained(f, state), savePortal ? 'portal_save_not_verified' : 'value_not_retained', savePortal ? '暂存后内容缺失或变化，不能宣称已保存。' : '后续控件改变了已填内容，需先回读并恢复，不能重复执行整组。');
            }
        }
        return { key: group.key, fields: observed.map(toObservation), portal_saved: !!savePortal };
    } catch (e) {
        failure = e;
        if (saved) {
            // A thrown write may have taken effect: preserve its unknown state, never repeat it.
            if (activeField && !observed.some(x => x.key === activeField.key)) observed.push({ key: activeField.key, read_state: 'unreadable' });
            try { await persist(); } catch { e.persistence_failed = true; }
        }
        throw e;
    } finally {
        try { await preserveTab(tab); }
        catch (e) { if (failure) failure.preservation_failed = true; else throw e; }
    }
}
