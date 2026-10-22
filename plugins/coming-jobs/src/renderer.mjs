import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assert,consent,hash,now,assertExternalFilename} from './core.mjs';
import {browserExecutable} from './materials.mjs';
export const normalizeText=text=>String(text).normalize('NFKC').replace(/\s+/gu,'');
export function extractTemplate(source){
 const start=source.search(/function\s+html\s*\(\s*d\s*,\s*locale\s*\)\s*\{/),end=source.indexOf('const files',start);
 assert(start>=0&&end>start&&/^const\s+files\s*=\s*\{\s*\}\s*;?/.test(source.slice(end)),'template_markers','template 函数必须位于 html(d,locale) 与 const files={} 标记之间。');
 return source.slice(start,end).trim();
}
export function pathValues(data,p){
 const keys=p.split('.');assert(keys.length&&keys.every(k=>k&& !['__proto__','prototype','constructor'].includes(k)),'template_path','无效模板字段路径。');
 function get(v,i){if(i===keys.length)return [v];if(keys[i]==='*')return (Array.isArray(v)?v:Object.values(v??{})).flatMap(x=>get(x,i+1));return v!=null&&Object.hasOwn(v,keys[i])?get(v[keys[i]],i+1):[];}
 return get(data,0).flatMap(v=>Array.isArray(v)?v:[v]).filter(v=>typeof v==='string'||typeof v==='number').map(String);
}
export const expectedText=(data,paths)=>paths.flatMap(p=>pathValues(data,p)).join('\n');
function confined(file,root){const f=realpathSync(file);if(root){const r=realpathSync(root);assert(f===r||f.startsWith(r+path.sep),'scope_violation','模板文件不在授权目录。');}return f;}
export function pinRenderer(store,a){
 consent(a.confirmed,a.user_ref);const script=confined(a.render_script,a.allowed_root),bytes=readFileSync(script);assert(bytes.length<2*1024*1024,'template_too_large','模板脚本过大。');
 const fn=extractTemplate(bytes.toString('utf8'));assert(a.text_paths?.length,'template_order_required','需要批准模板实际文本顺序。');
 const assets=(a.asset_paths??[]).map(file=>{const p=confined(file,a.allowed_root),bytes=readFileSync(p);assert(bytes.length<=20*1024*1024&&/\.(png|jpe?g|webp|svg)$/i.test(p),'template_asset','仅支持有界本地图像资源。');return {path:p,sha256:hash(bytes)};});
 return {script,script_hash:hash(bytes),function_hash:hash(fn),assets,text_paths:a.text_paths,pin_ref:a.user_ref,pinned_at:now()};
}
export function pinnedInputs(config){
 const bytes=readFileSync(config.script);assert(hash(bytes)===config.script_hash,'renderer_pin_changed','模板脚本已变化，需要重新批准固定哈希。');
 const fn=extractTemplate(bytes.toString('utf8'));assert(hash(fn)===config.function_hash,'renderer_pin_changed','模板函数已变化。');
 const assets=config.assets.map(a=>{const bytes=readFileSync(a.path);assert(hash(bytes)===a.sha256,'renderer_pin_changed','模板图片已变化，需要重新批准。');const ext=path.extname(a.path).slice(1).toLowerCase(),mime=ext==='svg'?'image/svg+xml':ext==='jpg'?'image/jpeg':'image/'+ext;return {...a,url:`data:${mime};base64,${bytes.toString('base64')}`};});
 return {fn,assets};
}
export function validateRender(receipt,expected,pdf){
 assert(normalizeText(receipt.text)===normalizeText(expected),'render_text_mismatch','渲染页面文本与批准模板顺序不一致。');
 assert(receipt.images_ok&&!receipt.overflow,'render_layout','渲染存在溢出或图片加载失败。');
 assert(pdf.length<=2*1024*1024&&pdf.subarray(0,5).toString()==='%PDF-','render_pdf_size','PDF 无效或超过 2 MB。');
 return true;
}
/** Only transports source text to a sandboxed Chrome page. Node never evaluates it. */
export function renderMaterial(store,m){
 const baseline=store.get('settings','template_baseline');const config=baseline.renderer;const inputs=pinnedInputs(config);
 assert(m.template_baseline_hash===baseline.content_hash,'stale_baseline','组装引用的基线已变化。');
 const data=m.template_data,expected=expectedText(data,config.text_paths),cacheKey=hash([hash(readFileSync(new URL('./render-worker.mjs',import.meta.url))),config.script_hash,config.function_hash,config.assets,data,expected]);
 const cached=store.get('render_receipt',cacheKey,false);
 if(cached){try{store.assetPath(cached.asset);if(existsSync(cached.screenshot)&&hash(readFileSync(cached.screenshot))===cached.screenshot_hash)return {...cached,cache_hit:true};}catch{/* Missing or damaged derived artifacts are cache misses. */}}
 const executable=browserExecutable();assert(executable,'browser_unavailable','未找到 Chrome 或 Chromium，无法离线渲染。');
 const dir=path.join(store.home,'renders',cacheKey);mkdirSync(dir,{recursive:true,mode:0o700});
 const pdf=path.join(dir,assertExternalFilename(m.external_name??'resume.pdf')),screenshot=path.join(dir,'preview.png');
 const input={executable,fn:inputs.fn,assets:inputs.assets,data,locale:'zh-cn',pdf,screenshot};
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('./render-worker.mjs',import.meta.url))],{input:JSON.stringify(input),encoding:'utf8',timeout:40000,maxBuffer:1024*1024});
 assert(result.status===0,'renderer_failed','离线 Chrome 渲染失败。', '检查 Chrome 是否可启动、模板能否离线加载；保留当前草稿。', {exit:result.status});
 let receipt;try{receipt=JSON.parse(result.stdout);}catch{assert(false,'renderer_failed','渲染回执不是完整 JSON。');}
 const pdfBytes=readFileSync(pdf);validateRender(receipt,expected,pdfBytes);
 const asset=store.asset(pdf,dir);const out={...receipt,cache_key:cacheKey,asset,screenshot,screenshot_hash:hash(readFileSync(screenshot)),script_hash:config.script_hash,function_hash:config.function_hash,asset_hashes:config.assets.map(a=>a.sha256),input_hash:hash(data),text_hash:hash(receipt.text),approved_source_hash:baseline.content_hash,passed:true,generated_at:now()};
 return store.transaction(()=>store.put('render_receipt',cacheKey,out));
}
