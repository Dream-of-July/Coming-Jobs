/** Synthetic loopback-only integration fixture. Never connects to a recruiter. */
import http from 'node:http';
import { createHash } from 'node:crypto';
export async function startSyntheticPortal() {
 const state={uploads:0,writes:0,saves:0,submits:0,mode:'normal',saved:{},attachment:null};
 const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coming Jobs 合成门户验证</title><style>body{font:17px/1.6 system-ui;max-width:800px;margin:50px auto;padding:20px}label{display:block;margin-top:16px}input,select,textarea,button{font:inherit;padding:8px}button{margin:20px 10px 0 0}output{display:block;color:#075d54}aside{padding:16px;background:#e7f2ef}</style><h1>Coming Jobs 合成门户</h1><aside>只用于本地体验验证，所有资料均为虚构，不向招聘公司发送数据。</aside><label for="name">姓名</label><input id="name"><label for="school">学校</label><select id="school"><option value="">请选择</option><option value="synthetic">合成大学</option></select><label for="summary">介绍</label><textarea id="summary"></textarea><label for="cv">简历附件</label><input id="cv" type="file" accept="application/pdf"><output id="upload" aria-live="polite">未上传</output><button id="save">暂存资料</button><button id="submit">最终提交（演练）</button><output id="status" aria-live="polite"></output><script>
 const $=s=>document.getElementById(s);
 for(const key of ['name','school','summary']) $(key).addEventListener('change',()=>fetch('/event',{method:'POST',body:key}));
 $('cv').onchange=async()=>{const file=$('cv').files[0];if(!file)return;$('upload').textContent='上传中';$('upload').dataset.complete='false';const r=await fetch('/upload',{method:'POST',headers:{'X-Filename':encodeURIComponent(file.name)},body:file});const result=await r.json();$('upload').textContent=result.ok?result.name+' · 上传完成':'附件拒收';$('upload').dataset.complete=String(result.ok);$('upload').dataset.name=result.name??'';$('upload').dataset.bytes=String(result.bytes??0);};
 $('save').onclick=async()=>{$('status').textContent='暂存中';const data={name:$('name').value,school:$('school').value,summary:$('summary').value};const r=await fetch('/save',{method:'POST',body:JSON.stringify(data)});const result=await r.json();if(result.clear){$('summary').value='';$('upload').dataset.complete='false';$('upload').textContent='附件已消失';}$('status').textContent=result.ok?'已暂存':'暂存失败';};
 $('submit').onclick=async()=>{await fetch('/submit',{method:'POST'});$('status').textContent='合成提交，禁止用于真实投递验证';};
 fetch('/saved').then(r=>r.json()).then(v=>{for(const k of ['name','school','summary'])if(v[k]!==undefined)$(k).value=v[k];});
 </script></html>`;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  const chunks=[];for await(const chunk of req){chunks.push(chunk);if(chunks.reduce((n,x)=>n+x.length,0)>1024*1024){res.writeHead(413);res.end();return;}}
  const body=Buffer.concat(chunks);res.setHeader('Content-Type','application/json');
  if(req.url==='/event'){state.writes++;res.end('{}');}
  else if(req.url==='/upload'){
   state.uploads++;await new Promise(resolve=>setTimeout(resolve,80));
   if(state.mode==='reject'){res.writeHead(415);res.end(JSON.stringify({ok:false}));return;}
   state.attachment={name:decodeURIComponent(req.headers['x-filename']??'unknown'),bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};res.end(JSON.stringify({ok:true,...state.attachment}));
  }else if(req.url==='/save'){
   state.saves++;if(state.mode==='save-fail'){res.writeHead(500);res.end(JSON.stringify({ok:false}));return;}
   state.saved=JSON.parse(body.toString());if(state.mode==='clear'){state.saved.summary='';state.attachment=null;}
   res.end(JSON.stringify({ok:true,clear:state.mode==='clear'}));
  }else if(req.url==='/saved')res.end(JSON.stringify(state.saved));
  else if(req.url==='/submit'){state.submits++;res.end('{}');}
  else{res.writeHead(404);res.end('{}');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}/`,state,server,close:()=>new Promise(resolve=>server.close(resolve))};
}
