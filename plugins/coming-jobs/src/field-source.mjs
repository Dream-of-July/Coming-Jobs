import {assert,equal} from './core.mjs';
export function sourceValue(fact,source){
 let v=fact.value;const transform=source.transform??'identity';
 if(transform==='trim'){assert(typeof v==='string','field_transform','trim 需要文本事实。');v=v.trim();}
 if(transform==='date'){assert(typeof v==='string'&&Number.isFinite(Date.parse(v)),'field_transform','日期事实无效。');v=new Date(v).toISOString().slice(0,10);}
 if(transform==='year'){assert(typeof v==='string'||Number.isInteger(v),'field_transform','年份转换需要单个文本或整数事实。');const match=String(v).match(/\b(?:19|20|21)\d{2}\b/);assert(match,'field_transform','事实没有明确年份。');v=match[0];}
 if(transform==='phone_digits'){assert(typeof v==='string','field_transform','电话号码需要文本事实。');v=v.replace(/[^0-9]/g,'');assert(v.length>=5&&v.length<=15,'field_transform','电话号码位数不合法。');}
 if(transform==='option_map'){const rows=(source.mapping??[]).filter(r=>equal(r.from,v));assert(rows.length===1,'field_transform','选项映射必须唯一匹配事实值。');v=rows[0].to;}
 return v;
}
