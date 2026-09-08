import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {environment} from './helpers.mjs';
import {migrateReferral} from '../../../scripts/migrate-referral-source.mjs';
test('explicit referral migration stores privately and never replaces newer preferences',t=>{
 const e=environment(t),file=path.join(e.dir,'legacy-skill.md');writeFileSync(file,'内推查询固定来源（用户指定）：https://referrals.example.com/current 。');
 assert.equal(migrateReferral({legacySkill:file,home:e.dir}).changes_written,false);assert.equal(e.store.get('settings','preferences',false),null);
 assert.equal(migrateReferral({legacySkill:file,home:e.dir,userRef:'用户要求迁移',apply:true}).state,'migrated_to_private_preferences');
 const original=e.store.get('settings','preferences');writeFileSync(file,'内推查询固定来源（用户指定）：https://referrals.example.com/old 。');
 assert.equal(migrateReferral({legacySkill:file,home:e.dir,userRef:'用户要求迁移',apply:true}).changes_written,false);assert.equal(e.store.get('settings','preferences').referral_source,original.referral_source);
});
