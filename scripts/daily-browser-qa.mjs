import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { environment } from '../plugins/coming-jobs/tests/helpers.mjs';
import { dailySetup, addCompany, drive } from '../plugins/coming-jobs/tests/daily-helpers.mjs';
const {chromium}=await import(process.env.JOBOS_PLAYWRIGHT || 'playwright');
const out=path.resolve(process.argv[2]??'/tmp/jobos-daily-browser');mkdirSync(out,{recursive:true});
const e=environment();let browser;const checks=[];
try {
 dailySetup(e);const fixtures=Array.from({length:5},(_,i)=>addCompany(e,'合成公司'+String.fromCharCode(65+i),3));
 const d=drive(e,fixtures),html=readFileSync(d.report.presentation.file,'utf8');
 writeFileSync(path.join(out,'daily-synthetic.html'),html);
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.setContent(html);const panel=page.getByRole('region',{name:'每日推荐'});assert.equal(await panel.locator('article').count(),5);checks.push('five company cards with actual persisted report data');
 assert.equal(await panel.getByRole('link').count(),20);checks.push('official company and role links are present');
 assert.equal(await panel.getByRole('button').count(),0);checks.push('chat actions are explained without inert buttons');
 await panel.screenshot({path:path.join(out,'daily-desktop.png')});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push('mobile page has no horizontal overflow');
 await panel.screenshot({path:path.join(out,'daily-mobile.png')});
 const source=e.store.all('daily_source')[0];e.store.put('daily_source',source.id,{...source,state:'blocked'});
 const partial=e.run('daily',{operation:'report',run_id:d.run.id});await page.setContent(readFileSync(partial.presentation.file,'utf8'));
 assert.equal(await page.getByRole('region',{name:'每日推荐'}).locator('article').count(),4);await page.getByText('尚未进入推荐的公司与原因').click();assert.match(await page.locator('body').innerText(),/完整岗位审阅尚未完成/);checks.push('incomplete company removed and actionable reason visible');
 await page.getByRole('region',{name:'每日推荐'}).screenshot({path:path.join(out,'daily-partial.png')});
 console.log(JSON.stringify({evidence:'local_playwright_synthetic',checks}));writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({evidence:'local_playwright_synthetic',checks},null,2));
} finally {await browser?.close();e.store.close();rmSync(e.dir,{recursive:true,force:true});}
