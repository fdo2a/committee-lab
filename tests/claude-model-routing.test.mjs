import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {claudeReviewer} from '../scripts/logic-review.mjs';

test('code and investment review use Sonnet 5.5 medium across local and cloud sessions',async()=>{
 const code=await readFile(new URL('../scripts/code-review.mjs',import.meta.url),'utf8');
 assert.equal(code.includes('claude-opus-5-5'),false);
 const folder=await mkdtemp(path.join(tmpdir(),'committee-model-routing-')),previousPath=process.env.PATH;
 try{
  const executable=path.join(folder,'claude');
  await writeFile(executable,`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({session_id:'fixture-session',structured_output:{approved:false,summary:JSON.stringify(process.argv.slice(2)),issues:['Fixture only, no approval']}})));\n`);
  await chmod(executable,0o700);process.env.PATH=folder+path.delimiter+previousPath;
  for(const {cloud,model,want} of [{cloud:false,want:'claude-sonnet-5-5'},{cloud:true,want:'claude-sonnet-5-5'},{cloud:false,model:'claude-sonnet-5-5',want:'claude-sonnet-5-5'}]){
   const review=claudeReviewer({role:'Fixture'},cloud,model);
   for(let round=0;round<2;round++){
    const verdict=await review({fixture:true},Date.now()+5000),args=JSON.parse(verdict.summary);
    assert.equal(args[args.indexOf('--model')+1],want);
    assert.equal(args[args.indexOf('--effort')+1],'medium');
    assert.equal(args.includes('--resume'),round===1&&!cloud);
    assert.equal(args.includes('--setting-sources'),cloud);
    if(cloud)assert.equal(args[args.indexOf('--setting-sources')+1],'');
    assert.equal(verdict.approved,false);
   }
  }
 }finally{
  if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;
  await rm(folder,{recursive:true,force:true});
 }
});
test('investment decision reviews use DECISION_RULES while code review and the cloud self-check keep REVIEW_RULES',async()=>{
 const {REVIEW_RULES,DECISION_RULES}=await import('../scripts/logic-review.mjs');
 assert.notEqual(DECISION_RULES,REVIEW_RULES);assert.match(DECISION_RULES,/enter when an idea is reasonable/);assert.match(REVIEW_RULES,/missing necessary evidence is an issue/);
 const [logic,cloud,code]=await Promise.all(['logic-review','cloud-review','code-review'].map(f=>readFile(new URL(`../scripts/${f}.mjs`,import.meta.url),'utf8')));
 assert.match(logic,/runtimeReview[\s\S]*claudeReviewer\(input\.context,false,undefined,DECISION_RULES\)/);
 assert.match(cloud,/reviewCloudJob[^\n]*claudeReviewer\(input\.context,true,undefined,DECISION_RULES\)/);
 assert.doesNotMatch(cloud.match(/cloudSelfCheck[^\n]*/)[0],/DECISION_RULES/);assert.doesNotMatch(code,/DECISION_RULES/);
 const folder=await mkdtemp(path.join(tmpdir(),'committee-rules-')),previousPath=process.env.PATH;
 try{
  const executable=path.join(folder,'claude');
  await writeFile(executable,`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({session_id:'s',structured_output:{approved:false,summary:JSON.stringify(process.argv.slice(2)),issues:['x']}})));\n`);
  await chmod(executable,0o700);process.env.PATH=folder+path.delimiter+previousPath;
  for(const [rules,want] of [[undefined,REVIEW_RULES],[DECISION_RULES,DECISION_RULES]]){
   const args=JSON.parse((await claudeReviewer({role:'Fixture'},true,undefined,rules)({fixture:true},Date.now()+5000)).summary);
   assert.equal(args[args.indexOf('--system-prompt')+1],want);
  }
 }finally{
  if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;
  await rm(folder,{recursive:true,force:true});
 }
});
