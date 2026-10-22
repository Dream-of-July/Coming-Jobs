/** Disposable Chrome process. Template code is executed only through CDP Runtime.evaluate. */
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const input=JSON.parse(readFileSync(0,'utf8')),profile=mkdtempSync(path.join(os.tmpdir(),'jobos-render-'));
const chrome=spawn(input.executable,['--headless=new','--remote-debugging-pipe','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,
 '--disable-background-networking','--disable-sync','--disable-extensions','--disable-component-update','--disable-default-apps',
 '--host-resolver-rules=MAP * ~NOTFOUND','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>','about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
let next=0,buffer='',session=null;const waiting=new Map();
const stop=()=>{try{chrome.kill('SIGKILL');}catch{}};
const deadline=setTimeout(()=>{stop();process.exit(1);},30000);
process.on('SIGTERM',()=>{stop();process.exit(1);});
const send=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++next;waiting.set(id,{resolve,reject});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})})+'\0');});
chrome.on('error',e=>{for(const x of waiting.values())x.reject(e);});
chrome.stdio[4].on('data',chunk=>{buffer+=chunk.toString();let i;while((i=buffer.indexOf('\0'))>=0){const raw=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!raw)continue;const m=JSON.parse(raw);if(m.id){const x=waiting.get(m.id);waiting.delete(m.id);if(m.error)x?.reject(Error(m.error.message));else x?.resolve(m.result);}else if(m.method==='Fetch.requestPaused')send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId).catch(()=>{});}});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,timeout:12000});if(r.exceptionDetails)throw Error('Template page evaluation failed');return r.result.value;};
try{
 const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);const attached=await send('Target.attachToTarget',{targetId,flatten:true},null);session=attached.sessionId;
 await send('Page.enable');await send('Emulation.setDefaultBackgroundColorOverride',{color:{r:255,g:255,b:255,a:1}});await send('Runtime.enable');await send('Network.enable');
 await send('Network.setBypassServiceWorker',{bypass:true});await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await send('Network.setBlockedURLs',{urls:['http://*','https://*','file://*','ftp://*','ws://*','wss://*']});await send('Fetch.enable',{patterns:[{urlPattern:'http*'},{urlPattern:'file:*'},{urlPattern:'ftp:*'},{urlPattern:'ws*'}]});
 await send('Emulation.setAutoDarkModeOverride',{enabled:false});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:795,height:1200,deviceScaleFactor:1,mobile:false});
 const html=await evaluate(`(() => { const html = (${input.fn}); return String(html(${JSON.stringify(input.data)},${JSON.stringify(input.locale)})); })()`);
 let page=html;for(const a of input.assets)for(const key of [a.path,path.basename(a.path)])page=page.split(key).join(a.url);
 // The template function has already run in the browser. No scripts from its markup execute.
 page='<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data:; connect-src \'none\'; script-src \'none\'; base-uri \'none\'; form-action \'none\'">'+page;
 const {frameTree}=await send('Page.getFrameTree');await send('Page.setDocumentContent',{frameId:frameTree.frame.id,html:page});
 const receipt=await evaluate(`(async()=>{await document.fonts.ready;let compressed_icons=0;for(const img of document.images){try{await img.decode();}catch{}const r=img.getBoundingClientRect();if(img.naturalWidth>r.width*2&&r.width>0&&r.height>0){const c=document.createElement('canvas');c.width=Math.ceil(r.width*2);c.height=Math.ceil(r.height*2);c.getContext('2d').drawImage(img,0,0,c.width,c.height);img.src=c.toDataURL('image/png');await img.decode();compressed_icons++;}}const height=Math.ceil(Math.max(document.body.getBoundingClientRect().bottom,...[...document.body.querySelectorAll('*')].map(e=>e.getBoundingClientRect().bottom))+8);const overflow=[...document.body.querySelectorAll('*')].some(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&(r.right>797||r.left< -1||e.scrollWidth>e.clientWidth+2&&['hidden','clip'].includes(s.overflowX)||e.scrollHeight>e.clientHeight+2&&['hidden','clip'].includes(s.overflowY));});return {text:document.body.innerText,height_px:height,height_pt:height*0.75,width_pt:596,characters:document.body.innerText.length,overflow,images_ok:[...document.images].every(i=>i.complete&&i.naturalWidth>0),compressed_icons,network:'offline',sandbox:'chrome-default'};})()`);
 if(!receipt.height_px||receipt.height_px>20000)throw Error('Render height outside bounds');
 const pdf=await send('Page.printToPDF',{printBackground:true,paperWidth:596/72,paperHeight:receipt.height_px/96,marginTop:0,marginRight:0,marginBottom:0,marginLeft:0,preferCSSPageSize:false});writeFileSync(input.pdf,Buffer.from(pdf.data,'base64'),{mode:0o600});
 const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:795,height:receipt.height_px,scale:1}});writeFileSync(input.screenshot,Buffer.from(screenshot.data,'base64'),{mode:0o600});
 process.stdout.write(JSON.stringify(receipt));
}catch(e){process.stderr.write('Offline renderer did not produce a verified artifact.\n');process.exitCode=1;}
finally{clearTimeout(deadline);stop();await new Promise(r=>chrome.exitCode!==null?r():chrome.once('exit',r));rmSync(profile,{recursive:true,force:true});}
