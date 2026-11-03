import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {signApproval} from '../scripts/logic-review.mjs';

test('repeat code verification reuses only a valid approval of unchanged source without calling Claude',async()=>{
 const parent=await mkdtemp(path.join(tmpdir(),'committee-code-reuse-')),folder=path.join(parent,'repo');
 const names=['PATH','CLAUDE_REVIEW_PUBLIC_KEY','COMMITTEE_REVIEW_KEY'],previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try{
  for(const name of ['scripts','worker','tests','.review','docs/superpowers/specs'])await mkdir(path.join(folder,name),{recursive:true});
  for(const name of ['scripts/code-review.mjs','scripts/logic-review.mjs','worker/logic-review.mjs'])await copyFile(new URL('../'+name,import.meta.url),path.join(folder,name));
  await writeFile(path.join(folder,'package.json'),JSON.stringify({type:'module',scripts:{test:'node --version',check:'node --version'}}));
  await writeFile(path.join(folder,'.gitignore'),'__pycache__/\n');
  await writeFile(path.join(folder,'tests/fixture_test.py'),'import unittest\nclass Fixture(unittest.TestCase):\n def test_ok(self): self.assertTrue(True)\n');
  for(const name of ['2026-10-08-claude-logic-review.md','2026-10-10-cloud-investment-design.md'])await writeFile(path.join(folder,'docs/superpowers/specs',name),'Fixture requirements');
  await writeFile(path.join(folder,'scripts/build.mjs'),'import fs from "node:fs";fs.appendFileSync(".review/builds","built\\n");');
  const log=path.join(parent,'calls'),bin=path.join(parent,'bin');await mkdir(bin);
  await writeFile(path.join(bin,'claude'),`#!${process.execPath}\nimport fs from 'node:fs';process.stdin.resume();process.stdin.on('end',()=>{fs.appendFileSync(${JSON.stringify(log)},'called\\n');console.log('Usage limit');process.exitCode=1;});`,{mode:0o700});
  const keys=generateKeyPairSync('rsa',{modulusLength:2048}),key=keys.privateKey.export({type:'pkcs8',format:'pem'});
  const keyPath=path.join(parent,'fixture.pem');await writeFile(keyPath,key,{mode:0o600});
  process.env.CLAUDE_REVIEW_PUBLIC_KEY=JSON.stringify(keys.publicKey.export({format:'jwk'}));process.env.COMMITTEE_REVIEW_KEY=keyPath;process.env.PATH=bin+path.delimiter+previous.PATH;
  execFileSync('git',['init','-q',folder]);
  const module=await import(pathToFileURL(path.join(folder,'scripts/code-review.mjs'))),digest=await module.sourceDigest();
  const input={sourceDigest:digest,checks:{node:true,python:true,syntax:true}},verdict={approved:true,summary:'Fixture only',issues:[]};
  const save=async now=>writeFile(path.join(folder,'.review/code-approval.json'),JSON.stringify({proof:await signApproval('code',input,digest,verdict,key,now)}));
  await save(Date.now());await module.reviewCode();
  assert.equal(await readFile(path.join(folder,'.review/builds'),'utf8'),'built\n');
  await assert.rejects(readFile(log),error=>error.code==='ENOENT');
  await save(Date.now()-900001);await assert.rejects(module.reviewCode(),error=>error.reason==='claudeUsageLimit');
  await save(Date.now());await writeFile(path.join(folder,'worker/changed.mjs'),'export const changed=true;');
  await assert.rejects(module.reviewCode(),error=>error.reason==='claudeUsageLimit');
  assert.equal(await readFile(log,'utf8'),'called\ncalled\n');
  assert.equal(await readFile(path.join(folder,'.review/builds'),'utf8'),'built\n');
 }finally{
  for(const [name,value]of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value}
  await rm(parent,{recursive:true,force:true});
 }
});
