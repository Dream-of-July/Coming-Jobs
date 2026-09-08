/** Copy this fixed function into the current CUA REPL after reading host docs.
 * Pass only a persisted checkpoint(prepare) result. No dynamic imports/eval.
 * Dynamic controls and attachments use separately observed host operations.
 */
export async function executeOrdinaryBatch(tab, batch) {
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
            if (!['free_text','url','checkbox'].includes(field.type)) throw new Error('separate_control_required');
            if (new URL(await tab.url()).origin !== batch.scope.origin || Date.parse(batch.grant.expires_at) <= Date.now()) throw new Error('boundary_changed');
            if (field.locator?.kind !== 'label') throw new Error('observed_label_required');
            const locator = tab.playwright.getByLabel(field.locator.value,{exact:true});
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
            observations.push({key:field.key,value,read_state:'known'});
            if (value !== field.value) throw new Error('readback_mismatch');
            active = null;
        }
        return {batch_id:batch.id,observations,state:'complete'};
    } catch {
        if (active && !observations.some(o => o.key === active)) observations.push({key:active,read_state:'unreadable'});
        return {batch_id:batch.id,observations,state:'unknown',next:'readonly_recovery'};
    }
}
