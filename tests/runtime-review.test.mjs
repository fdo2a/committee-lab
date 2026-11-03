import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import * as runtime from '../scripts/logic-review.mjs';
import {sourceDigest} from '../scripts/code-review.mjs';
import {requestDigest,verifyApproval} from '../worker/logic-review.mjs';
import {generateKeyPairSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {context} from '../worker/account.mjs';
import {createState} from '../web/engine.mjs';
import {ideaResearch} from './idea-fixtures.mjs';

function realisticInput(count=36){
 const symbols=Array.from({length:count},(_,i)=>String(i+1).padStart(6,'0'));
 const bars=Array.from({length:500},(_,i)=>({time:1700000000+i*86400,open:123456.12345678,high:124567.23456789,low:122345.34567891,close:123567.45678912,volume:1234567.56789123}));
 const quote={price:123567.45678912,time:bars.at(-1).time,currency:'KRW',source:'Yahoo Finance / Python',regularSessions:[{date:'2025-03-27',openTime:bars.at(-1).time,closeTime:bars.at(-1).time+23400,open:bars.at(-1).open,close:null,complete:false}]};
 const research=ideaResearch();
 const candidate={expectedRevision:4,market:'asia',phase:'pre',marketSnapshot:{provider:'Yahoo Finance / Python',fetchedAt:'2026-10-09T00:00:00Z',activeSymbols:symbols,data:Object.fromEntries(symbols.map(s=>[s,structuredClone(bars)])),quotes:Object.fromEntries(symbols.map(s=>[s,structuredClone(quote)])),fx:{KRW:1,USD:1400,JPY:9},sources:symbols.map(s=>({title:s,url:`https://finance.yahoo.com/quote/${s}.KS/history/`}))},research,fundamentals:Object.fromEntries(symbols.map(s=>[s,{source:'public disclosure',revenueGrowth:20,roe:15,operatingCashFlow:1000000}]))};
 const current=JSON.parse(JSON.stringify(context({state:createState(),metadata:{},revision:4})));
 current.lastResearch=research;current.unrelatedHistory='x'.repeat(500000);
 return {scope:'/api/run',candidate,context:current};
}

test('36 symbols with 500 daily bars reach both runtime models as bounded summaries',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'committee-runtime-input-'));
 const oldPath=process.env.PATH,oldKey=process.env.COMMITTEE_REVIEW_KEY;
 try{
  const fixture=realisticInput();
  assert.ok(Buffer.byteLength(JSON.stringify(fixture.candidate))>2000000);
  fixture.context.logicReview={codeDigest:await sourceDigest()};
  fixture.deadline=Date.now()+20000;
  const log=path.join(folder,'inputs.jsonl');
  await writeFile(path.join(folder,'claude'),`#!${process.execPath}\nimport fs from 'node:fs';\nlet raw='';for await(const c of process.stdin)raw+=c;fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({model:'claude',raw})+'\\n');\nconst n=fs.readFileSync(${JSON.stringify(log)},'utf8').trim().split('\\n').filter(x=>JSON.parse(x).model==='claude').length;\nconsole.log(JSON.stringify({session_id:'fixture-session',structured_output:{approved:n>1,summary:'fixture logical verdict',issues:n>1?[]:['explain premise']}}));\n`,{mode:0o700});
  await writeFile(path.join(folder,'codex'),`#!${process.execPath}\nimport fs from 'node:fs';\nlet raw='';for await(const c of process.stdin)raw+=c;fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({model:'codex',raw})+'\\n');\nconst input=JSON.parse(raw);const out=process.argv[process.argv.indexOf('--output-last-message')+1];fs.writeFileSync(out,JSON.stringify({research:{...input.candidate.research,marketReview:input.candidate.research.marketReview+' · explained premise'},decision:null}));\n`,{mode:0o700});
  process.env.PATH=folder+path.delimiter+oldPath;
  // Stop at the existing signer boundary, without reading any private key.
  process.env.COMMITTEE_REVIEW_KEY=path.resolve('.review/forbidden-fixture-key');
  await assert.rejects(runtime.runtimeReview(fixture),/Signing key must be outside the project/);
  const inputs=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(inputs.map(x=>x.model),['claude','codex','claude']);
  for(const [round,{raw}]of inputs.entries()){
   assert.ok(Buffer.byteLength(raw)<=runtime.MAX_RUNTIME_INPUT_BYTES,'runtime model input must be bounded');
   const input=JSON.parse(raw);
   assert.equal(input.candidate.marketSnapshot.symbols['000001'].latestClose,123567.45678912);
   assert.equal(input.candidate.marketSnapshot.symbols['000001'].barCount,500);
   assert.equal(input.candidate.marketSnapshot.symbols['000001'].quote.time,fixture.candidate.marketSnapshot.quotes['000001'].time);
   assert.deepEqual(input.candidate.marketSnapshot.symbols['000001'].quote.regularSessions,fixture.candidate.marketSnapshot.quotes['000001'].regularSessions);
   assert.equal(input.candidate.marketSnapshot.data,undefined);
   assert.equal(input.context.unrelatedHistory,undefined);
   assert.deepEqual(input.candidate.research,round===2?{...fixture.candidate.research,marketReview:fixture.candidate.research.marketReview+' · explained premise'}:fixture.candidate.research);
   assert.deepEqual(input.candidate.fundamentals,fixture.candidate.fundamentals);
  }
  const expanded=realisticInput(72);expanded.context.logicReview=fixture.context.logicReview;expanded.deadline=Date.now()+20000;
  const raw=JSON.stringify(expanded);assert.ok(Buffer.byteLength(raw)>5000000);
  const cli=spawnSync(process.execPath,['scripts/logic-review.mjs'],{input:raw,encoding:'utf8',env:process.env,timeout:25000});
  assert.equal(cli.status,2,'The fixture stops at the signer boundary: '+cli.stderr);
  const next=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(next.length,inputs.length+1,'Expanded theme histories must reach the reviewer through the real stdin path');
  assert.equal(Object.keys(JSON.parse(next.at(-1).raw).candidate.marketSnapshot.symbols).length,72);
 }finally{
  process.env.PATH=oldPath;
  if(oldKey===undefined)delete process.env.COMMITTEE_REVIEW_KEY;else process.env.COMMITTEE_REVIEW_KEY=oldKey;
  await rm(folder,{recursive:true,force:true});
 }
});

test('runtime summary binds all original bars and the full request before signing',async()=>{
 const fixture=realisticInput();
 const reviewed=await runtime.runtimeReviewInput(fixture.scope,fixture.candidate,fixture.context);
 await runtime.assertRuntimeReviewInput(fixture.scope,fixture.candidate,fixture.context,reviewed);
 const changed=structuredClone(fixture.candidate);changed.marketSnapshot.data['000001'][0].close++;
 await assert.rejects(runtime.assertRuntimeReviewInput(fixture.scope,changed,fixture.context,reviewed),/Runtime review input changed/);
 const forged=structuredClone(reviewed);forged.candidate.marketSnapshot.symbols['000001'].latestClose++;
 await assert.rejects(runtime.assertRuntimeReviewInput(fixture.scope,fixture.candidate,fixture.context,forged),/Runtime review input changed/);
 assert.equal(reviewed.context.requestDigest,await requestDigest(fixture.candidate));
 const keys=generateKeyPairSync('rsa',{modulusLength:2048});
 const proof=await runtime.signApproval(fixture.scope,fixture.candidate,'fixture-code',{approved:true,summary:'fixture',issues:[]},keys.privateKey.export({format:'pem',type:'pkcs8'}));
 const publicKey=JSON.stringify(keys.publicKey.export({format:'jwk'}));
 assert.equal((await verifyApproval({...fixture.candidate,reviewProof:proof},fixture.scope,publicKey,'fixture-code')).approved,true);
 assert.equal((await verifyApproval({...changed,reviewProof:proof},fixture.scope,publicKey,'fixture-code')).approved,false);
});

test('weekly reporting archives are hash-bound while current premises and cycle outcomes remain readable',async()=>{
 const fixture=realisticInput(72);
 fixture.context.lastCycle={status:'logicReviewHeld',executions:[{symbol:'000001',side:'sell'}],portfolioUnitRisk:{pass:false},strategySnapshot:{capturedAt:'2026-10-08T00:00:00Z',ideas:[{id:'historical',archive:'x'.repeat(180000)}]}};
 const input=await runtime.runtimeReviewInput(fixture.scope,fixture.candidate,fixture.context);
 assert.ok(Buffer.byteLength(JSON.stringify(input))<=runtime.MAX_RUNTIME_INPUT_BYTES);
 assert.equal(input.context.lastCycle.strategySnapshot.ideaCount,1);
 assert.equal(input.context.lastCycle.strategySnapshot.capturedAt,fixture.context.lastCycle.strategySnapshot.capturedAt);
 assert.equal(input.context.lastCycle.strategySnapshot.ideas,undefined);
 assert.equal(input.context.lastCycle.status,'logicReviewHeld');
 assert.deepEqual(input.context.lastCycle.executions,fixture.context.lastCycle.executions);
 assert.deepEqual(input.context.lastCycle.portfolioUnitRisk,fixture.context.lastCycle.portfolioUnitRisk);
 assert.deepEqual(input.candidate.research,fixture.candidate.research);
 assert.deepEqual(input.context.investmentProcess,fixture.context.investmentProcess);
 const changed=structuredClone(fixture.context);changed.lastCycle.strategySnapshot.ideas[0].archive+='changed';
 await assert.rejects(runtime.assertRuntimeReviewInput(fixture.scope,fixture.candidate,changed,input),/Runtime review input changed/);
});

test('ETF price histories are summarized without dropping the allocation decision',async()=>{
 const fixture=realisticInput(),snapshot=fixture.candidate.marketSnapshot;
 const candidate={expectedRevision:4,market:'asia',phase:'pre',snapshots:[{symbol:'ETF',provider:snapshot.provider,fetchedAt:snapshot.fetchedAt,bars:snapshot.data['000001'],quote:snapshot.quotes['000001'],fx:{rate:1,time:123},sources:snapshot.sources,dividends:[{time:123,amount:1}]}],failures:[],decision:{asOf:'2026-10-09',weights:{ETF:.1},reason:'public evidence',risks:'rate risk',sourceUrls:['https://example.com']}};
 const input=await runtime.runtimeReviewInput('/api/allocation',candidate,fixture.context);
 assert.equal(input.candidate.snapshots[0].bars,undefined);
 assert.equal(input.candidate.snapshots[0].barCount,500);
 assert.deepEqual(input.candidate.decision,candidate.decision);
 const changed=structuredClone(candidate);changed.snapshots[0].bars[0].volume++;
 await assert.rejects(runtime.assertRuntimeReviewInput('/api/allocation',changed,fixture.context,input),/Runtime review input changed/);
});

test('oversized runtime research and repair feedback hold instead of truncating evidence',async()=>{
 const fixture=realisticInput();fixture.candidate.research.thesis='한'.repeat(160000);
 await assert.rejects(runtime.runtimeReviewInput(fixture.scope,fixture.candidate,fixture.context),/Runtime review input exceeds/);
 assert.throws(()=>runtime.boundedRuntimeInput({feedback:{issues:['x'.repeat(runtime.MAX_RUNTIME_INPUT_BYTES)]}}),/Runtime review input exceeds/);
});
