import {S,B,I,E,A,O,OP} from './core.mjs';
export const applyBatchSchema={oneOf:[OP('targets',{job_ids:A(S(100),50),target_list_id:S(100),numbers:A(I(1,50),50),confirmed:B,user_ref:S(1000)},[])]};
