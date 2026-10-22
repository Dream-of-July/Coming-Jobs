/** Fixed read-only script. Native host tools perform all mutations. */
export const READBACK_SCRIPT=`(() => {
 const controls=[...document.querySelectorAll('input,select,textarea,[role="combobox"],[role="checkbox"]')].filter(e=>e.type!=='hidden');
 return {origin:location.origin,pathname:location.pathname,controls:controls.map(e=>({
  key:e.getAttribute('name')||e.id||e.getAttribute('aria-label')||'',
  label:e.labels?.[0]?.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'',
  type:e.type||e.getAttribute('role')||e.tagName.toLowerCase(),required:e.required||e.getAttribute('aria-required')==='true',
  value:e.type==='file'?undefined:e.type==='password'||/验证码|动态码|otp|password|verification|security.?code/i.test([e.getAttribute('name'),e.getAttribute('aria-label'),e.labels?.[0]?.innerText].join(' '))?undefined:e.type==='checkbox'?e.checked:e.value,
  selected:e.tagName==='SELECT'?e.selectedIndex>=0:undefined,
  files:e.type==='file'?[...e.files].map(f=>({name:f.name,bytes:f.size})):undefined,
  read_state:'known'
 }))};
})()`;
export function claudeProcedure(plan,spec=null){
 const fields=plan.groups.flatMap(g=>g.fields).filter(f=>!spec||spec.field_keys.includes(f.key));
 const actions=[],manual=[];
 for(const f of fields){
  if(f.manual||f.type==='file_upload'){manual.push({key:f.key,kind:f.manual?'human_owned':'file_upload',path:f.local_file??null});continue;}
  const target=f.locator??{kind:'label',value:f.label??f.key};
  if(['date_picker','portal_select'].includes(f.type))actions.push({tool:'find',target,key:f.key},{tool:'click',target,key:f.key,native_selection:true,value:f.value});
  else actions.push({tool:'form_input',target,key:f.key,value:f.value});
 }
 const batches=[];for(let i=0;i<actions.length;i+=8)batches.push({tool:'browser_batch',actions:actions.slice(i,i+8),after:'Read actual values with READBACK_SCRIPT; never infer success from action return.'});
 return {host:'claude',origin:plan.origin,resolve_refs:'Use find results to resolve native element refs before actions. Never fabricate refs.',batches,manual,readback_script:READBACK_SCRIPT,javascript_scope:'read_only',submit:'Only after clear_submit; action_summary must contain company and approval-sheet code.'};
}
