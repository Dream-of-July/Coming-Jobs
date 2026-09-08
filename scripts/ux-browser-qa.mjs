import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { environment, seedApplication, seedPlan, checkpointArgs } from '../plugins/coming-jobs/tests/helpers.mjs';
import { fillGroup, readControl } from '../plugins/coming-jobs/src/browser.mjs';
import { startSyntheticPortal } from './synthetic-portal.mjs';
const {chromium}=await import(process.env.JOBOS_PLAYWRIGHT || 'playwright');
const out=process.env.JOBOS_QA_OUT || '/tmp/jobos-ux-browser';mkdirSync(out,{recursive:true});
const portal=await startSyntheticPortal(),env=environment();let browser;const checks=[];
try {
 browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(portal.url);
 const s=seedApplication(env),p=seedPlan(env,s,portal.url),grant=env.store.get('application',s.app.id).authorization;
 const facade={getByLabel:page.getByLabel.bind(page),getByRole:page.getByRole.bind(page),locator:page.locator.bind(page),waitForEvent:page.waitForEvent.bind(page),domSnapshot:()=>page.locator('body').innerText()};
 let preserved=0;const tab={url:()=>page.url(),playwright:facade,markHandoff:async()=>preserved++};
 const groups=p.groups.map(g=>({...g,fields:g.fields.map(f=>({...f,locator:{kind:'label',value:{name:'姓名',school:'学校',cv:'简历附件'}[f.key]}}))}));
 const readUpload=async f=>({key:f.key,local_sha256:f.material.sha256,...await page.locator('#upload').evaluate(el=>({upload_complete:el.dataset.complete==='true',file_name:el.dataset.name,file_bytes:Number(el.dataset.bytes||0),file_count:el.dataset.complete==='true'?1:0}))});
 const options={origin:new URL(portal.url).origin,authorization:grant,readUpload,settle:async f=>{if(f.type==='file_upload')await page.waitForFunction(()=>!document.querySelector('#upload').textContent.includes('上传中'));},
 saveBefore:async({group,before})=>env.run('checkpoint',{...checkpointArgs(s,p,[{key:group,before,fields:before}]),portal_url:portal.url}),
 saveAfter:async({group,before,fields,portal_saved})=>env.run('checkpoint',{...checkpointArgs(s,p,[{key:group,before,fields}]),portal_url:portal.url,...(portal_saved===undefined?{}:{portal_saved})})};
 for(const g of groups)await fillGroup(tab,g,options);
 assert.equal(portal.state.uploads,1);assert.equal(portal.state.attachment.sha256,s.material.asset.sha256);checks.push('actual loopback upload bytes match selected synthetic PDF');
 const before=portal.state.uploads;for(const g of groups)await fillGroup(tab,g,options);assert.equal(portal.state.uploads,before);checks.push('unchanged resume does not upload again');
 assert.equal(await page.inputValue('#school'),'synthetic');checks.push('real native selection retained');
 const savePortal=async()=>{await page.getByRole('button',{name:'暂存资料',exact:true}).click();await page.waitForFunction(()=>['已暂存','暂存失败'].includes(document.querySelector('#status').textContent));assert.equal(await page.locator('#status').innerText(),'已暂存');};
 await fillGroup(tab,groups[0],{...options,savePortal});await page.reload();assert.equal(await page.inputValue('#name'),'陈同学');checks.push('portal saved value survives actual page reload');
 portal.state.mode='reject';await assert.rejects(fillGroup(tab,groups[2],options),{code:'upload_not_verified'});checks.push('HTTP rejection cannot pass upload verification');
 portal.state.mode='normal';await page.reload();await fillGroup(tab,groups[2],options);
 portal.state.mode='clear';await assert.rejects(fillGroup(tab,groups[2],{...options,savePortal}),{code:'portal_save_not_verified'});assert(!env.run('review',{application_id:s.app.id,portal_url:portal.url}).ready);checks.push('attachment disappears after save and final review blocks');
 portal.state.mode='save-fail';await page.locator('#status').evaluate(el=>el.textContent='');await assert.rejects(fillGroup(tab,groups[0],{...options,savePortal}));checks.push('server save failure preserves local progress');
 await page.screenshot({path:path.join(out,'failure-state.png'),fullPage:true});
 assert.equal(portal.state.submits,0);assert(preserved>0);checks.push('zero final submit actions');
 writeFileSync(path.join(out,'report.json'),JSON.stringify({environment:'Chromium and real loopback HTTP; synthetic only',checks,passed:checks.length,uploads:portal.state.uploads,submits:portal.state.submits},null,2));console.log(JSON.stringify({passed:checks.length,out}));
}finally{await browser?.close();await portal.close();env.store.close();rmSync(env.dir,{recursive:true,force:true});}
