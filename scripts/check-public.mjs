#!/usr/bin/env node
/** Repository-only release hygiene; never opens a candidate workspace. */
import {readdirSync, readFileSync, lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skip=new Set(['.git','node_modules','dist','output','.venv','__pycache__']);
const findings=[];let count=0;
function walk(dir){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(skip.has(entry.name))continue;
  const file=path.join(dir,entry.name),rel=path.relative(root,file);
  if(lstatSync(file).isSymbolicLink()){findings.push([rel,'symlink']);continue;}
  if(entry.isDirectory()){walk(file);continue;}
  count++;
  if(/\.(?:sqlite(?:3)?(?:-wal|-shm)?|db|pdf|docx|zip|bundle|log)$/i.test(entry.name)||/^\.env(?:\.|$)|^auth\.json$|^install-result\.json$/.test(entry.name))findings.push([rel,'private_or_generated_file']);
  if(/\.(?:png|jpg|jpeg|ico)$/.test(entry.name))continue;
  const text=readFileSync(file,'utf8');
  if(/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(text))findings.push([rel,'host_specific_home']);
  if(/\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))findings.push([rel,'credential_pattern']);
  if(/https?:\/\/[^\s"'<>]+[?&](?:access_token|auth_token|session_token)=[A-Za-z0-9_-]{12,}/i.test(text))findings.push([rel,'private_link']);
 }
}
walk(root);
console.log(JSON.stringify({files_checked:count,findings:findings.map(([file,rule])=>({file,rule})),note:'Pattern checks complement human review; they are not a proof that arbitrary text is non-private.'},null,2));
if(findings.length)process.exitCode=1;
