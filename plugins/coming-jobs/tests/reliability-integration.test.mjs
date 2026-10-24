import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, seedApplication } from './helpers.mjs';
import { call } from '../src/service.mjs';
import { hash } from '../src/core.mjs';
import { executeOrdinaryBatch } from '../src/host-batch.mjs';

function integratedPlan(e, s, extra, observed) {
  return { application_id:s.app.id, portal_url:'https://jobs.example.com/application',page_fingerprint:'integrated-v1',
    groups:[{key:'details',label:'Details',required:true,fields:[extra]},{key:'resume',label:'Resume',required:true,
      fields:[{key:'cv',label:'Resume',type:'file_upload',required:true,value:s.material.id}]}],observed_fields:[observed] };
}

test('observed coverage accepts only an explicit source transform of its resolved fact', t => {
  const e=environment(t),s=seedApplication(e);
  const [fact]=e.run('remember',{mode:'user_statement',facts:[{key:'graduation.year',value:2027,purposes:['form']}],confirmed:true,user_ref:'Synthetic source'}).saved;
  const field={key:'graduation.year',label:'Graduation year',type:'free_text',required:true,value:'2027',source:{fact_id:fact.id,transform:'year'}};
  const observed={key:field.key,label:field.label,type:field.type,required:true};
  const result=e.run('plan',integratedPlan(e,s,field,observed));
  assert.equal(result.field_coverage.state,'covered');
  assert.equal(result.plan.groups[0].fields[0].value,'2027');
  const invalid=call(e.store,'jobos1_plan',integratedPlan(e,s,{...field,value:'2028'},observed));
  assert.equal(invalid.error?.code,'field_value_mismatch');
  const array=e.run('remember',{mode:'user_statement',facts:[{key:'graduation.year',value:['2027','2028'],purposes:['form']}],confirmed:true,user_ref:'Synthetic changed source'}).saved[0];
  const raw=call(e.store,'jobos1_plan',integratedPlan(e,s,{...field,value:['2027','2028'],source:{fact_id:array.id,transform:'identity'}},observed));
  assert.equal(raw.error?.code,'invalid_field_value');
  const arrayYear=call(e.store,'jobos1_plan',integratedPlan(e,s,{...field,source:{fact_id:array.id,transform:'year'}},observed));
  assert.equal(arrayYear.error?.code,'field_transform');
});

test('ordinary privacy agreements remain covered while legal declarations stay user owned',t=>{
  const e=environment(t),s=seedApplication(e),text='Synthetic ordinary privacy notice';
  const agreement={key:'privacy',label:'Privacy notice',type:'agreement',required:true,value:true,text_hash:hash(text),agreement_title:'Privacy notice',excerpt:text};
  const observed={key:agreement.key,label:agreement.label,type:'agreement',required:true};
  assert.equal(e.run('plan',integratedPlan(e,s,agreement,observed)).field_coverage.state,'covered');
  assert.deepEqual(e.run('form_profile',{application_id:s.app.id,fields:[observed]}).missing_required_fields,[]);
  const legal={...agreement,key:'legal',label:'Legal declaration'};
  assert.equal(call(e.store,'jobos1_plan',integratedPlan(e,s,legal,{...observed,key:'legal',label:'Legal declaration'})).error?.code,'manual_field_required');
});

test('the ordinary host helper routes agreements to a separately observed action',async()=>{
  let checked=false,writes=0;
  const element={type:'checkbox',checked:false,maxLength:-1,disabled:false,readOnly:false,getAttribute:()=>null};
  const locator={count:async()=>1,evaluate:async fn=>fn({...element,checked}),setChecked:async value=>{checked=value;writes++;}};
  const origin='https://jobs.example.com';
  const result=await executeOrdinaryBatch({url:async()=>origin,playwright:{getByRole:()=>locator}},
    {id:'synthetic-agreement',state:'pending',scope:{origin},grant:{origin,expires_at:new Date(Date.now()+60000).toISOString()},
      before:[{key:'privacy',value:false,read_state:'known'}],targets:[{key:'privacy',type:'agreement',value:true,locator:{kind:'role',value:'checkbox',name:'Privacy notice'}}]});
  assert.equal(result.state,'unknown');assert.equal(result.code,'agreement_requires_observation');assert.equal(result.next,'observe_agreement');assert.equal(writes,0);
});
