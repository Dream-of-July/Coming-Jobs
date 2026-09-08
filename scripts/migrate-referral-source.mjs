#!/usr/bin/env node
/** Explicit one-file migration; never scans chat history or replaces a saved preference. */
import { realpathSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Store } from '../plugins/coming-jobs/src/store.mjs';
import { call } from '../plugins/coming-jobs/src/service.mjs';
import { publicUrl, assert } from '../plugins/coming-jobs/src/core.mjs';
export function migrateReferral({ legacySkill, home, userRef, apply = false }) {
    assert(legacySkill && home, 'migration_scope_required', '需要明确旧版 Skill 文件和私有工作区路径。');
    const text = readFileSync(legacySkill, 'utf8');
    const matches = [...text.matchAll(/内推查询固定来源（用户指定）：(https:\/\/[^\s]+)\s/g)].map(m => publicUrl(m[1]));
    assert(matches.length === 1, 'migration_source_unknown', '旧文件没有唯一的用户指定内推来源；保留原配置。');
    if (!apply) return { state:'ready', source_count:1, changes_written:false };
    assert(userRef?.trim(), 'migration_authority_required', '迁移需要用户授权依据。');
    const store = new Store(home);
    try {
        const old = store.get('settings', 'preferences', false);
        if (old?.referral_source) return { state:'existing_preference_preserved', changes_written:false };
        // Backup stays in the private workspace, not the plugin or the release package.
        store.writeExport(`preferences-before-ux-${Date.now()}.json`, { preferences:old });
        const result = call(store, 'jobos1_profile', { operation:'preferences', preferences:{referral_source:matches[0]}, confirmed:true, user_ref:userRef });
        assert(result.ok, result.error?.code ?? 'migration_failed', result.error?.message ?? '迁移未完成。');
        return { state:'migrated_to_private_preferences', changes_written:true, personal_source_logged:false };
    } finally { store.close(); }
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args=process.argv.slice(2), option=k=>args[args.indexOf(k)+1];
    try { console.log(JSON.stringify(migrateReferral({legacySkill:args.includes('--legacy-skill')?option('--legacy-skill'):null,home:args.includes('--home')?option('--home'):null,userRef:args.includes('--user-ref')?option('--user-ref'):null,apply:args.includes('--apply')}))); }
    catch { console.error('内推来源迁移未完成：检查明确文件与授权，原偏好不自动覆盖。');process.exitCode=1; }
}
