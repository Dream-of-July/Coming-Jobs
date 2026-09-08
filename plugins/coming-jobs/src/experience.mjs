import { assert, hash, now, publicUrl, noSecrets, iso } from './core.mjs';
// Only enumerated strategies and opaque structure digests enter the experience store.
// Candidate values, selectors, coordinates and user answers belong to other stores.
export function experience(store, a) {
    noSecrets(a);
    if (a.operation === 'metrics') return { lessons: store.all('experience').map(({id,state,scope,uses}) => ({id,state,scope,uses})), real_efficiency: 'not_established' };
    if (a.operation === 'register') {
        const origin = new URL(publicUrl(a.scope.origin)).origin;
        assert(origin === a.scope.origin, 'origin_only', '经验只保存门户 origin，不保存个人页面链接。');
        assert(/^[a-f0-9]{64}$/.test(a.scope.structure), 'structure_digest', '页面结构使用摘要。');
        const scope = { ...a.scope, origin };
        const key = hash([scope, a.strategy]);
        return store.get('experience', key, false) ?? store.put('experience', key, { scope, strategy: a.strategy, state: 'candidate', uses: 0, created_at: now() });
    }
    if (a.operation === 'lookup') return { candidates: store.all('experience').filter(e => hash(e.scope) === hash(a.scope) && ['validated', 'usable'].includes(e.state)), requires_current_readonly_match: true };
    const e = store.get('experience', a.experience_id);
    if (a.operation === 'disable') return store.put('experience', e.id, { ...e, state: 'invalidated', invalidated_at: now() });
    if (a.operation === 'validate') {
        assert(e.state === 'candidate', 'invalid_transition', '仅候选经验可以进行合成验证。');
        assert(a.replay_passed && a.protection_passed && /^[a-f0-9]{64}$/.test(a.replay_digest), 'replay_required', '必须通过合成回放及用户修改保护。');
        return store.put('experience', e.id, { ...e, state: 'validated', replay_digest: a.replay_digest });
    }
    assert(['validated', 'usable'].includes(e.state), 'invalid_transition', '经验尚未通过验证或已经失效。');
    assert(Math.abs(Date.now() - Date.parse(iso(a.observed_at))) < 300000, 'stale_match', '复用前需要五分钟内的当前页面只读匹配。');
    const matches = hash(e.scope) === hash(a.scope) && a.unique_match && a.readback_match;
    return store.put('experience', e.id, { ...e, state: matches ? 'usable' : 'invalidated', uses: e.uses + Number(matches), matched_at: now(), targeted_observation_required: !matches });
}
