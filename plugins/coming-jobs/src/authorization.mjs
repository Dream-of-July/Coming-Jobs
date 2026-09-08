import { hash } from './core.mjs';

// Content consent is separate from a short-lived, single-writer execution lease.
// Locators and display filenames are not content; recipient, semantics and bytes are.
export function fieldDigest(field) {
    const digest = hash([field.key, field.label, field.type, field.material ? { sha256: field.material.sha256, bytes: field.material.bytes } : field.value,
        field.option_id ?? null, field.evidence_versions ?? []]);
    return field.attachment_mode || field.restore_keys ? hash([digest, field.attachment_mode, field.restore_keys, field.restore_confirmed, field.restore_ref]) : digest;
}
export function consentScope(app, origin) {
    return hash([app.id, app.job_snapshot.content_hash, origin]);
}
export function coveredFields(app, plan) {
    const grant = app.authorization;
    if (!grant) return [];
    if (grant.scope_hash === consentScope(app, plan.origin))
        return plan.groups.flatMap(g => g.fields).filter(f => !f.manual && grant.field_grants?.[f.key] === fieldDigest(f)).map(f => f.key);
    // Legacy grants retain their original expiry and exact plan boundary.
    if (!grant.scope_hash && grant.plan_hash === plan.content_hash && Date.parse(grant.expires_at) > Date.now())
        return plan.groups.flatMap(g => g.fields).filter(f => !f.manual).map(f => f.key);
    return [];
}
export function authorizationState(app, plan) {
    const covered = coveredFields(app, plan);
    const missing = plan.groups.flatMap(g => g.fields).filter(f => !f.manual && !covered.includes(f.key)).map(f => f.key);
    return { covered_fields: covered, missing_fields: missing, content_authorized: missing.length === 0,
        lease_active: !!app.authorization && Date.parse(app.authorization.expires_at) > Date.now() };
}
