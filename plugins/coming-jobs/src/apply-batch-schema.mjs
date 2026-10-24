import {S,B,I,E,A,O,OP} from './core.mjs';
import {APPLY_DEFER_REASONS,APPLY_QUEUE_LIMITS} from './apply-queue.mjs';
const batch={batch_id:S(100)},approval={confirmed:B,user_ref:S(1000)},session={session_id:S(100)};
export const applyBatchSchema={oneOf:[
 OP('targets',{job_ids:A(S(100),50),target_list_id:S(100),numbers:A(I(1,50),50),...approval},[]),
 OP('start',{application_ids:A(S(100),10),target_list_id:S(100),numbers:A(I(1,50),10),...session},['session_id']),
 OP('sheet',{...batch,application_id:S(100)},['batch_id']),
 OP('approve',{...batch,application_id:S(100),sheet_code:S(20),sheet_issued_at:S(80),reply:S(2000),numbers:A(I(1,10),10),...session,...approval},['batch_id','sheet_code','sheet_issued_at','reply','session_id','confirmed','user_ref']),
 OP('next',{...batch,...session}),OP('resume',{...batch,...session}),
 OP('defer',{...batch,application_id:S(100),...session,claim_id:S(100),reason:E(...APPLY_DEFER_REASONS),error_code:S(80),retry_after_ms:I(APPLY_QUEUE_LIMITS.retry_min_ms,APPLY_QUEUE_LIMITS.retry_max_ms)},['batch_id','application_id','session_id','claim_id','reason']),
 OP('retry',{...batch,application_id:S(100),...session}),
 OP('human_queue',{...batch,steps:A(O({application_id:S(100),kind:E('login','otp','captcha','qr','password','registration','upload','agreement','declaration','host_access','unknown'),field_key:S(150),origin:S(500),prompt:S(1500)},['kind','prompt']),50)},['batch_id','steps']),
 OP('human_done',{...batch,human_step_ids:A(S(100),50),completed:B,user_ref:S(1000)},['batch_id','human_step_ids','completed','user_ref']),
 OP('human_verify',{...batch,human_step_id:S(100),observed_complete:B,verification_ref:S(1000)},['batch_id','human_step_id','observed_complete','verification_ref']),
 OP('status',batch),OP('revoke',{...batch,...approval}),
 OP('void',{...batch,application_id:S(100),...approval},['batch_id','confirmed','user_ref']),
 OP('clear_submit',{...batch,application_id:S(100),...session,background:B,caller:E('foreground','scheduled')},['batch_id','application_id','session_id']),
 OP('abort_submit',{...batch,application_id:S(100),...session,portal_url:S(3000),job_id:S(200),draft_not_submitted:B,observation_ref:S(1000),observed_at:S(80)},['batch_id','application_id','session_id','portal_url','job_id','draft_not_submitted','observation_ref','observed_at'])
]};
