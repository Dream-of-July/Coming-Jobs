import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {environment} from './helpers.mjs';

test('renderer reports safe launch diagnostics promptly without raw browser or template data',t=>{
 const e=environment(t),executable=path.join(e.dir,'fake-chrome');writeFileSync(executable,'#!/bin/sh\nprintf "No usable sandbox SYNTHETIC_PRIVATE_DIAGNOSTIC_CANARY\\n" >&2\nexit 1\n',{mode:0o700});
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../src/render-worker.mjs',import.meta.url))],{input:JSON.stringify({executable,fn:'function html(d,locale){return "SYNTHETIC_TEMPLATE_CANARY";}',data:{},assets:[],locale:'zh-cn',pdf:path.join(e.dir,'out.pdf'),screenshot:path.join(e.dir,'out.png')}),encoding:'utf8',timeout:3000});
 assert.equal(result.status,1);const diagnostic=JSON.parse(result.stderr);assert.equal(diagnostic.reason,'sandbox_unavailable');assert.equal(diagnostic.stage,'browser_start');assert(!result.stderr.includes('CANARY'));assert.equal(result.stdout,'');
});
