import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,mkdir,copyFile,writeFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {verifyApproval,requestDigest,CODE_DIGEST,EXECUTION_REVIEW_TTL,validVerdict} from '../worker/logic-review.mjs';
import {signApproval,reviewLoop,runProcess,runtimeReview,REVIEW_SCHEMA} from '../scripts/logic-review.mjs';
import {fromJSONSchema} from 'zod';
import {createState,exposure,advance,unrealized,analyze} from '../web/engine.mjs';
import {monitorUnits} from '../web/trend-units.mjs';

test('Claude-compatible output schema retains strict runtime rejection of approved issues',()=>{
 assert.deepEqual(Object.keys(REVIEW_SCHEMA).filter(k=>['anyOf','oneOf','allOf'].includes(k)),[]);
 assert.equal(/\"(?:maxItems|minLength|maxLength)\"/.test(JSON.stringify(REVIEW_SCHEMA)),false);
 const schema=fromJSONSchema(REVIEW_SCHEMA);
 assert.equal(schema.safeParse({approved:true,summary:'Approved; a nonblocking observation is recorded here.',issues:[]}).success,true);
 assert.equal(schema.safeParse({approved:false,summary:'Held.',issues:['Material issue']}).success,true);
 assert.equal(validVerdict(schema.parse({approved:true,summary:'Approved.',issues:['Nonblocking note']})),false);
});
import {allocateAssets} from '../web/asset-allocation.mjs';
import {stampDecision,enableRegularExecution} from '../web/execution.mjs';
import {autonomousCycle,prepareResearch,prepareUniverse} from '../worker/account.mjs';
import {eligibleIdeaAccount,ideaResearch,testNow} from './idea-fixtures.mjs';
import {CODE_REVIEW_TIMEOUT} from '../scripts/code-review.mjs';

const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'}),publicKey=JSON.stringify(keys.publicKey.export({format:'jwk'}));
const now=Date.parse('2026-10-08T00:20:00Z');
const verdict={approved:true,summary:'전제와 결론이 연결됨',issues:[]};
const payload={expectedRevision:4,market:'asia',phase:'open',marketSnapshot:{fetchedAt:new Date(now).toISOString()}};

test('code repair has a separate 45-minute budget while signed approvals still expire after 15 minutes',async()=>{
 assert.equal(CODE_REVIEW_TIMEOUT,2700000);
 assert.equal(EXECUTION_REVIEW_TTL,1800000);
 const proof=await signApproval('code',payload,CODE_DIGEST,verdict,privateKey,now);
 assert.equal(proof.expiresAt-proof.issuedAt,900000);
 assert.equal((await verifyApproval({...payload,reviewProof:proof},'code',publicKey,CODE_DIGEST,now+900001)).approved,false);
});

test('runtime review holds mismatched local source before calling a model or signer',async()=>{
 await assert.rejects(runtimeReview({scope:'/api/run',candidate:{expectedRevision:1},context:{logicReview:{codeDigest:'old-server-source'}},deadline:Date.now()+5000}),/Local source differs/);
});

test('runtime review requires an explicit execution deadline',async()=>{
 await assert.rejects(runtimeReview({scope:'/api/run',candidate:{expectedRevision:1},context:{logicReview:{codeDigest:'source'}}}),/Execution review deadline required/);
});

test('code review includes committed sources and MCP in the signed source scope',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'committee-review-scope-'));
 try{
  for(const name of ['scripts','worker','tests'])await mkdir(path.join(folder,name));
  for(const name of ['scripts/code-review.mjs','scripts/logic-review.mjs','worker/logic-review.mjs'])await copyFile(new URL('../'+name,import.meta.url),path.join(folder,name));
  await writeFile(path.join(folder,'package.json'),JSON.stringify({type:'module',scripts:{test:'node --version',check:'node --version'}}));
  await writeFile(path.join(folder,'tests/scope_test.py'),'import unittest\nclass Scope(unittest.TestCase):\n def test_fixture(self): self.assertTrue(True)\n');
  await writeFile(path.join(folder,'worker/mcp.mjs'),'export const committedChange = "must be reviewed";');
  execFileSync('git',['init','-q',folder]);execFileSync('git',['add','.'],{cwd:folder});
  execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.com','commit','-qm','committed'],{cwd:folder});
  const module=await import(pathToFileURL(path.join(folder,'scripts/code-review.mjs')));
  const candidate=await module.codeCandidate(Date.now()+10000);
  assert.equal(candidate.files.find(x=>x.file==='worker/mcp.mjs')?.content,'export const committedChange = "must be reviewed";');
  assert.deepEqual(candidate.files.map(x=>x.file),(await module.sourceFiles()).map(([name])=>name));
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('prepared screening exits cannot become discretionary exits in an approved open cycle',()=>{
 const s=eligibleIdeaAccount(),raw=ideaResearch(),symbol='005930',price=s.data[symbol].at(-1).close;
 raw.screening=[{symbol,stance:'watch',topDownScore:50,reason:'청산 제안',sourceUrls:[raw.sources[0].url],exit:true}];
 s.holdings=[{symbol,qty:1,entry:price,cost:price,stop:price*.5,target:price*2,date:s.date,strategy:'test'}];
 prepareResearch({state:s,metadata:{}},raw,testNow);
 autonomousCycle(s,null,testNow,{...s.marketData,data:s.data,fx:s.fx},null,{phase:'open',date:s.date,countries:['한국']},{approved:true});
 assert.equal(s.plans.filter(p=>['sell','cover'].includes(p.side)).length,0);
});

test('stored unit exits and withdrawals require reviewed research in the current request',()=>{
 for(const kind of ['unit','idea'])for(const reviewed of [false,true]){
  const s=eligibleIdeaAccount(),u={...s.externalResearch.trendUnits[0],direction:'long',status:'active',expiresAt:'2026-12-05',capital:200000,realizedPnl:0,reviewLog:[]};
  s.trendUnits=[u];s.holdings=u.members.map(m=>({symbol:m.symbol,unitId:u.id,ideaId:u.ideaId,direction:'long',qty:1,entry:100000,cost:100000,lastCheckedQuoteTime:1}));
  if(kind==='unit'){s.externalResearch.trendUnits[0].action='exit';s.externalResearch.trendUnits[0].exitReason='공시 근거';}
  else{s.externalResearch.investmentIdeas[0].action='withdraw';s.externalResearch.investmentIdeas[0].withdrawalReason='공시 근거';}
  // Quotes equal entry prices, so no price-based risk condition can explain an exit.
  s.data=Object.fromEntries(Object.entries(s.data).map(([symbol,bars])=>[symbol,bars.map(b=>({...b,open:100000,close:100000,high:100000,low:100000}))]));
  s.marketData.quotes=Object.fromEntries(Object.keys(s.data).map(symbol=>[symbol,{price:100000,time:testNow/1000}]));
  monitorUnits(s,{unrealized,now:testNow,researchReviewed:reviewed});
  assert.equal(s.plans.length,reviewed?2:0);
  assert.ok(s.plans.every(p=>p.riskExit===false));
 }
});

test('a reviewed premarket unit exit is created while an unreviewed stored exit is ignored',()=>{
 for(const reviewed of [false,true]){
  const s=eligibleIdeaAccount(),raw=ideaResearch(),u={...raw.trendUnits[0],direction:'long',status:'active',expiresAt:'2026-12-05',capital:200000,realizedPnl:0,reviewLog:[]};
  raw.trendUnits[0].action='exit';raw.trendUnits[0].exitReason='공시로 논리 훼손';
  s.trendUnits=[u];s.holdings=u.members.map(m=>({symbol:m.symbol,unitId:u.id,ideaId:u.ideaId,direction:'long',qty:1,entry:100000,cost:100000,stop:50000,target:200000,lastCheckedQuoteTime:1}));
  s.marketData.quotes=Object.fromEntries(Object.keys(s.data).map(symbol=>[symbol,{price:100000,time:testNow/1000}]));
  prepareResearch({state:s,metadata:{}},raw,testNow);
  enableRegularExecution(s,testNow-86400000);
  autonomousCycle(s,reviewed?raw:null,testNow,{...s.marketData,data:s.data,fx:s.fx},null,{phase:'pre',date:s.date,countries:['한국']},{approved:true});
  const exits=s.plans.filter(p=>['sell','cover'].includes(p.side));
  assert.equal(exits.length,reviewed?2:0);assert.ok(exits.every(p=>p.status==='승인'&&p.riskExit===false));
 }
});

test('only signed, fresh approvals of the exact endpoint, version, revision and payload pass',async()=>{
 const proof=await signApproval('/api/run',payload,CODE_DIGEST,verdict,privateKey,now);
 const check=(input={...payload,reviewProof:proof},path='/api/run',time=now,codeDigest=CODE_DIGEST)=>verifyApproval(input,path,publicKey,codeDigest,time);
 assert.equal((await check()).approved,true);
 assert.equal((await check({...payload,expectedRevision:5,reviewProof:proof})).approved,false);
 assert.equal((await check({...payload,market:'us',reviewProof:proof})).approved,false);
 assert.equal((await check(undefined,'/api/allocation')).approved,false);
 assert.equal((await check(undefined,undefined,now+900001)).approved,false);
 assert.equal((await check(undefined,undefined,now-1)).approved,false);
 assert.equal((await check(undefined,undefined,now,'different-code')).approved,false);
 assert.equal((await check({...payload,reviewProof:{...proof,signature:'00'.repeat(256)}})).approved,false);
 assert.equal((await verifyApproval({...payload,reviewProof:proof},'/api/run',null,CODE_DIGEST,now)).approved,false);
 assert.equal((await check({...payload,reviewProof:{approved:true}})).approved,false);
 assert.equal(await requestDigest({...payload,reviewProof:proof}),await requestDigest(payload));
 await assert.rejects(signApproval('/api/run',payload,CODE_DIGEST,{...verdict,issues:['비약']},privateKey,now));
});

test('logical feedback reaches Codex and only a later explicit clean approval completes the loop',async()=>{
 let candidate={decision:'assertion'},round=0;const repairs=[];
 const result=await reviewLoop(candidate,{review:async()=>++round===1?{approved:false,summary:'근거 누락',issues:['인과관계 설명 필요']}:verdict,repair:async(value,feedback)=>{repairs.push(feedback);return {...value,decision:'evidence'};}});
 assert.equal(result.candidate.decision,'evidence');assert.equal(result.rounds,2);assert.equal(repairs[0].issues[0],'인과관계 설명 필요');
});
test('malformed approvals, persistent rejection and expired deadlines never succeed',async()=>{
 await assert.rejects(reviewLoop({}, {review:async()=>({approved:'true',issues:[]}),repair:async x=>x}));
 let rounds=0;
 await assert.rejects(reviewLoop({round:0}, {review:async()=>{rounds++;return {approved:false,summary:'unsupported',issues:['unsupported']};},repair:async x=>({round:x.round+1})}));assert.equal(rounds,5);
 await assert.rejects(reviewLoop({}, {review:async()=>verdict,repair:async x=>x,deadline:Date.now()-1}));
});
test('unchanged repairs hold without repeating the same Claude review',async()=>{
 for(const candidate of [{decision:'same'},{sourceDigest:'same',evidence:{duration:1}}]){
  let calls=0;
  await assert.rejects(reviewLoop(candidate,{review:async()=>{calls++;return {approved:false,summary:'Missing evidence',issues:['Add evidence']};},repair:async value=>({...value,...(value.sourceDigest?{evidence:{duration:2}}:{})})}),/unchanged/i);
  assert.equal(calls,1);
 }
});
test('model subprocess receives OS login identity but no service credentials or signing key',async()=>{
 process.env.COMMITTEE_REVIEW_KEY='test-private-key-path';process.env.OAI_SITE_TOKEN='test-service-secret';
 try{
  const raw=await runProcess(process.execPath,['-e','console.log(JSON.stringify({key:process.env.COMMITTEE_REVIEW_KEY,token:process.env.OAI_SITE_TOKEN,user:process.env.USER}))'],'',Date.now()+5000);
  const env=JSON.parse(raw);assert.equal(env.key,undefined);assert.equal(env.token,undefined);assert.equal(env.user,process.env.USER);
 }finally{delete process.env.COMMITTEE_REVIEW_KEY;delete process.env.OAI_SITE_TOKEN;}
});

test('Python test evidence includes stderr without contaminating model JSON output',async()=>{
 const args=['-c','import unittest; Fixture=type("Fixture",(unittest.TestCase,),{"test_one":lambda self:self.assertTrue(True)}); result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Fixture)); assert result.wasSuccessful()'];
 const evidence=await runProcess('python3',args,'',Date.now()+5000,process.cwd(),true);
 assert.match(evidence,/Ran 1 test/);assert.match(evidence,/OK/);
 const raw=await runProcess(process.execPath,['-e','console.error("diagnostic"); console.log("{\\"approved\\":false}")'],'',Date.now()+5000);
 assert.deepEqual(JSON.parse(raw),{approved:false});
});
test('Claude limit errors expose an explicit safe reason without raw model output',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'committee-limit-'));
 try{
  const command=path.join(folder,'claude');
  await writeFile(command,'#!/bin/sh\nprintf \'{"is_error":true,"result":"Usage limit; private diagnostic text withheld"}\\n\'\nexit 1\n');await chmod(command,0o700);
  await assert.rejects(runProcess(command,[],'',Date.now()+5000),error=>error.reason==='claudeUsageLimit'&&!error.message.includes('private diagnostic'));
 }finally{await rm(folder,{recursive:true,force:true})}
});
test('Claude failures distinguish authentication, rate limits and incidental limit text without leaking replies',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'committee-diagnostic-'));
 try{
  const command=path.join(folder,'claude');
  for(const [reply,reason,kind] of [
   [{is_error:true,result:'API Error: 401 OAuth token does not have the required scope; private diagnostic',modelUsage:{limit:1}},'claudeAuthenticationUnavailable','missingScope'],
   [{is_error:true,result:'API Error: 429 rate_limit_error; private diagnostic'},'claudeUsageLimit','rateLimit'],
   [{is_error:true,result:'Unrelated failure',modelUsage:{limit:1}},'reviewUnavailable','unknown'],
   [{is_error:true,result:"You've hit your limit · resets 6:30pm (Asia/Seoul)"},'claudeUsageLimit','subscriptionLimit'],
   [{is_error:true,result:"You've hit your session limit · resets 1:40am (Asia/Seoul)"},'claudeUsageLimit','subscriptionLimit'],
   [{is_error:true,result:"You've hit your weekly limit"},'claudeUsageLimit','subscriptionLimit']
  ]){
   await writeFile(command,'#!/usr/bin/env node\nconsole.error('+JSON.stringify(JSON.stringify(reply))+');process.exit(1);\n');await chmod(command,0o700);
   await assert.rejects(runProcess(command,[],'',Date.now()+5000),error=>error.reason===reason&&error.diagnostic?.kind===kind&&!JSON.stringify(error).includes('private diagnostic'));
  }
 }finally{await rm(folder,{recursive:true,force:true})}
});

test('code approval trusts the registered public key, never the key in its receipt file',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'committee-code-approval-'));
 const oldKey=process.env.CLAUDE_REVIEW_PUBLIC_KEY;
 try{
  for(const name of ['scripts','worker','.review'])await mkdir(path.join(folder,name));
  for(const name of ['scripts/code-review.mjs','scripts/logic-review.mjs','worker/logic-review.mjs'])await copyFile(new URL('../'+name,import.meta.url),path.join(folder,name));
  execFileSync('git',['init','-q',folder]);
  const module=await import(pathToFileURL(path.join(folder,'scripts/code-review.mjs')));
  const digest=await module.sourceDigest(),input={sourceDigest:digest,checks:{node:true,python:true,syntax:true}};
  const attacker=generateKeyPairSync('rsa',{modulusLength:2048});
  const attackerProof=await signApproval('code',input,digest,verdict,attacker.privateKey.export({type:'pkcs8',format:'pem'}));
  await writeFile(path.join(folder,'.review/code-approval.json'),JSON.stringify({proof:attackerProof,publicKey:JSON.stringify(attacker.publicKey.export({format:'jwk'}))}));
  process.env.CLAUDE_REVIEW_PUBLIC_KEY=publicKey;
  await assert.rejects(module.requireCodeApproval(),/Claude logical review/);
  const proof=await signApproval('code',input,digest,verdict,privateKey);
  await writeFile(path.join(folder,'.review/code-approval.json'),JSON.stringify({proof}));
  assert.equal(await module.requireCodeApproval(),digest);
  delete process.env.CLAUDE_REVIEW_PUBLIC_KEY;
  await assert.rejects(module.requireCodeApproval(),/Claude logical review/);
 }finally{
  if(oldKey===undefined)delete process.env.CLAUDE_REVIEW_PUBLIC_KEY;else process.env.CLAUDE_REVIEW_PUBLIC_KEY=oldKey;
  await rm(folder,{recursive:true,force:true});
 }
});

test('held stock review cannot approve fresh entries even when deterministic research passes',()=>{
 const s=eligibleIdeaAccount(),raw=ideaResearch();
 const snapshot={...s.marketData,data:s.data,fx:s.fx};
 const result=autonomousCycle(s,raw,testNow,snapshot,null,null,{approved:false,reason:'logicPending'});
 assert.equal(result.logicReview.approved,false);assert.equal(result.status,'logicReviewHeld');
 assert.equal(s.plans.filter(p=>['buy','short'].includes(p.side)&&p.status==='승인').length,0);
 assert.equal(s.trades.filter(t=>['buy','short'].includes(t.side)).length,0);
});

for(const stale of [false,true])test(`unapproved premarket risk submission preserves ${stale?'stale':'fresh'} research evidence byte for byte`,()=>{
 const s=eligibleIdeaAccount(),clock=testNow-1800000,symbol='005930',price=s.marketData.quotes[symbol].price;
 s.externalResearch.screening=[{symbol,stance:'allow',reason:'기존 검토',bottomUpReason:'기존 사업 근거',sourceUrls:['https://example.com/index'],fundamentalPass:true,fundamentalReview:'기존 재무 검토'}];
 s.externalResearch.asOf=new Date(clock-(stale?40*3600000:60000)).toISOString();
 s.externalResearch.investmentIdeas[0].asOf=s.externalResearch.asOf;
 for(const f of Object.values(s.fundamentals))f.fetchedAt=new Date(clock-60000).toISOString();
 analyze(s,clock-60000);s.plans=[];
 assert.equal(s.analysis.quantResearch[0].rankedCount,2);
 enableRegularExecution(s,clock-86400000);
 s.holdings=[{symbol,qty:1,entry:price,cost:price,stop:price*1.1,target:price*2,date:s.date,strategy:'test',lastCheckedQuoteTime:clock/1000-1}];
 const snapshot={...s.marketData,fetchedAt:new Date(clock).toISOString(),data:s.data,fx:s.fx,quotes:Object.fromEntries(Object.entries(s.marketData.quotes).map(([key,q])=>[key,{...q,time:clock/1000}]))};
 const before=[s.fundamentals,s.analysis.quantResearch,s.externalResearch].map(x=>JSON.stringify(x));
 const result=autonomousCycle(s,null,clock,snapshot,null,{phase:'pre',date:s.date,countries:['한국']},{approved:false,reason:'logicPending'});
 for(const [i,value] of [s.fundamentals,s.analysis.quantResearch,s.externalResearch].entries())assert.equal(JSON.stringify(value),before[i],['fundamentals','quantResearch','externalResearch'][i]);
 assert.equal(result.status,'logicReviewHeld');assert.equal(result.approved,0);assert.equal(s.trades.length,0);
 assert.equal(s.plans.filter(p=>['buy','short'].includes(p.side)).length,0);
 assert.ok(s.plans.some(p=>p.symbol===symbol&&p.riskExit===true&&p.status==='승인'),'Stop monitoring still queues the existing risk exit');
});

test('risk-only stock execution leaves discretionary exits pending and executes an existing risk exit',()=>{
 const s=createState();s.mode='live';s.plans=[];s.trades=[];enableRegularExecution(s,now-86400000);
 const symbol='005930',price=s.data[symbol].at(-1).close,open=now/1000-1200;
 s.holdings=[{symbol,qty:1,entry:price,cost:price,stop:price*.5,target:price*2,date:s.date,strategy:'test',lastCheckedQuoteTime:open-1}];
 const p={id:'exit',symbol,qty:1,side:'sell',reference:price,status:'승인',date:s.date,signalTimestamp:open-86400};stampDecision(p,(open-100)*1000);s.plans=[p];
 const quotes=Object.fromEntries(Object.keys(s.data).map(symbol=>[symbol,{price:s.data[symbol].at(-1).close,time:now/1000,regularSessions:[{date:'2026-10-08',openTime:open,closeTime:open+23400,open:s.data[symbol].at(-1).close,close:null,complete:false}]}]));
 advance(s,{quotes,date:'2026-10-08',now,riskOnly:true});assert.equal(s.trades.length,0);assert.equal(p.status,'승인');
 p.riskExit=true;advance(s,{quotes,date:'2026-10-08',now,riskOnly:true});assert.equal(s.trades.at(0).side,'sell');assert.equal(s.holdings.length,0);
});

for(const pending of ['legacy','manual','reviewed'])for(const trigger of ['stop','margin','unit loss','unit soft loss','unit target','unit expiry']){
 test(`risk-only ${trigger} replaces a ${pending} exit and fills at the next regular open`,()=>{
  const s=createState(),symbol='005930',short=trigger==='margin',unit=trigger.startsWith('unit');
  s.mode='live';s.plans=[];s.trades=[];enableRegularExecution(s,now-86400000);
  s.holdings=[{symbol,unitId:unit?'risk-unit':undefined,direction:short?'short':'long',qty:10,entry:100000,cost:1000000,stop:trigger==='stop'?95000:short?200000:50000,target:short?50000:200000,date:s.date,strategy:'test',lastCheckedQuoteTime:now/1000-1}];
  if(short)s.cash=0;
  if(unit)s.trendUnits=[{id:'risk-unit',status:'active',capital:1000000,realizedPnl:0,lossLimit:.1,targetReturn:.1,expiresAt:trigger==='unit expiry'?'2026-10-08':'2026-12-01',reviewLog:[],lastQuoteTimes:{[symbol]:now/1000-1}}];
  const old={id:'old-exit',symbol,qty:10,side:short?'cover':'sell',status:pending==='manual'?'대기':'승인',date:s.date,signalTimestamp:now/1000-86400,...(pending==='reviewed'?{riskExit:false}:{} )};
  stampDecision(old,now-86400000);s.plans=[old,{...old,id:'second-exit',status:'대기',qty:2}];
  const price=trigger==='stop'?90000:trigger==='unit loss'?88000:trigger==='unit soft loss'?94000:trigger==='unit target'?112000:100000;
  const observe=(time,date)=>{
   const open=time/1000-1200;
   const quotes=Object.fromEntries(Object.keys(s.data).map(key=>[key,{price:key===symbol?price:s.data[key].at(-1).close,time:time/1000,regularSessions:[{date,openTime:open,closeTime:open+23400,open:key===symbol?price:s.data[key].at(-1).close,close:null,complete:false}]}]));
   s.marketData={quotes};advance(s,{quotes,date,now:time,riskOnly:true});
  };
  observe(now,'2026-10-08');
  assert.equal(old.status,pending==='reviewed'&&trigger==='unit soft loss'?'승인':'취소');assert.equal(s.plans.find(p=>p.id==='second-exit').status,'취소');
  const exit=s.plans.find(p=>p.status==='승인'&&p.riskExit);assert.ok(exit);assert.match(exit.reason,/손절|증거금|유닛/);
  assert.equal(exit.qty,trigger==='unit soft loss'?5:10);assert.equal(s.trades.length,0);
  observe(now+86400000,'2026-10-09');
  assert.equal(exit.status,'체결');assert.equal(s.trades.length,1);assert.equal(s.trades[0].side,short?'cover':'sell');
  assert.equal(s.trades[0].executionBasis,'regularOpen');assert.equal(s.trades[0].sessionPrice,price);
  assert.equal(s.holdings.length,trigger==='unit soft loss'?1:0);if(s.holdings.length)assert.equal(s.holdings[0].qty,5);
 });
}

for(const direction of ['long','short'])test(`soft unit risk preserves a reviewed full ${direction} exit and executes only the risk quantity`,()=>{
 const s=createState(),symbol='005930',short=direction==='short',price=short?106000:94000;
 s.mode='live';s.plans=[];s.trades=[];enableRegularExecution(s,now-86400000);
 const h={symbol,unitId:'soft-unit',direction,qty:10,entry:100000,cost:1000000,stop:short?200000:50000,target:short?50000:200000,date:s.date,strategy:'test',lastCheckedQuoteTime:now/1000-1,...(short?{borrowAccrued:0,borrowLastAt:now}:{})};s.holdings=[h];
 const u={id:'soft-unit',status:'closing',capital:1000000,realizedPnl:0,lossLimit:.1,targetReturn:.1,expiresAt:'2026-12-01',reviewLog:[],lastQuoteTimes:{[symbol]:now/1000-1}};s.trendUnits=[u];
 const reviewed={id:'reviewed-full',symbol,unitId:u.id,qty:10,side:short?'cover':'sell',status:'승인',date:s.date,reason:'유닛 투자논리 훼손: 검토된 전량 청산',unitExit:true,riskExit:false,signalTimestamp:now/1000-1};stampDecision(reviewed,now);s.plans=[reviewed];
 const observe=(time,riskOnly)=>{
  const quotes=Object.fromEntries(Object.keys(s.data).map(key=>[key,{price:key===symbol?price:s.data[key].at(-1).close,time:time/1000,regularSessions:[{date:new Date(time).toISOString().slice(0,10),openTime:time/1000-1200,closeTime:time/1000+22200,open:key===symbol?price:s.data[key].at(-1).close,close:null,complete:false}]}]));
  s.marketData={quotes};advance(s,{quotes,date:new Date(time).toISOString().slice(0,10),now:time,riskOnly});
 };
 observe(now,true);
 assert.equal(reviewed.status,'승인');assert.equal(reviewed.qty,10);assert.equal(reviewed.riskExit,false);assert.equal(u.status,'closing');
 const risk=s.plans.find(p=>p.riskExit);assert.equal(risk?.qty,5);
 observe(now+86400000,true);assert.equal(risk.status,'체결');assert.equal(s.holdings[0].qty,5);assert.equal(reviewed.status,'승인');assert.equal(s.trades.length,1);
 observe(now+86400000,false);assert.equal(reviewed.status,'체결');assert.equal(s.holdings.length,0);assert.equal(s.trades.length,2);assert.equal(s.trades.reduce((n,t)=>n+t.qty,0),10);
});

test('a signed premarket cycle does not approve manual exits outside its research',()=>{
 const s=eligibleIdeaAccount(),symbol='005930',price=s.data[symbol].at(-1).close;
 s.holdings=[{symbol,qty:1,entry:price,cost:price,stop:price*.5,target:price*2,date:s.date,strategy:'test',lastCheckedQuoteTime:testNow/1000}];
 const manual={id:'manual-exit',symbol,qty:1,side:'sell',status:'대기',date:s.date,reason:'사용자 청산 요청'};s.plans=[manual];
 const result=autonomousCycle(s,null,testNow,{...s.marketData,data:s.data,fx:s.fx},null,{phase:'pre',date:s.date,countries:['한국']},{approved:true});
 assert.equal(manual.status,'대기');assert.equal(result.approved,0);assert.equal(s.trades.length,0);
});

test('a signed premarket cycle approves screening exits from its current research',()=>{
 const s=eligibleIdeaAccount(),raw=ideaResearch(),symbol='005930',price=s.data[symbol].at(-1).close;
 raw.screening=[{symbol,stance:'watch',topDownScore:50,reason:'공시로 논리 훼손',sourceUrls:[raw.sources[0].url],exit:true}];
 s.holdings=[{symbol,qty:1,entry:price,cost:price,stop:price*.5,target:price*2,date:s.date,strategy:'test',lastCheckedQuoteTime:testNow/1000}];
 const result=autonomousCycle(s,raw,testNow,{...s.marketData,data:s.data,fx:s.fx},null,{phase:'pre',date:s.date,countries:['한국']},{approved:true});
 const exit=s.plans.find(p=>p.symbol===symbol&&p.side==='sell');assert.equal(exit?.status,'승인');assert.notEqual(exit.riskExit,true);assert.equal(result.approved,1);
});

function bondSnapshot(time=now,price=100000){const open=Date.parse('2026-10-08T00:00:00Z')/1000+Math.floor((time-now)/86400000)*86400;return {symbol:'153130',quote:{price,time:time/1000,regularSessions:[{date:new Date(open*1000).toISOString().slice(0,10),openTime:open,closeTime:open+23400,open:price,close:time/1000>=open+23400?price:null,complete:time/1000>=open+23400}]},fx:{rate:1,time:time/1000},bars:Array.from({length:61},(_,i)=>({time:open-(60-i)*86400,close:price,volume:100000})),dividends:[],sources:[]};}
test('ETF rejection blocks new orders and open fills without discarding the prior reviewed pending buy',()=>{
 const s=createState();s.mode='live';s.plans=[];enableRegularExecution(s,now-86400000);
 allocateAssets(s,bondSnapshot(),now,exposure(s),0,null,{approved:false});assert.equal(s.assetAllocation.positions['153130'].pending,null);
 allocateAssets(s,bondSnapshot(),now,exposure(s));const p=s.assetAllocation.positions['153130'].pending;assert.equal(p.side,'buy');
 // Approved after today's open, so the first eligible fill is tomorrow's open.
 const next=now+86400000;allocateAssets(s,bondSnapshot(next),next,exposure(s),0,null,{approved:false});assert.equal(s.assetAllocation.positions['153130'].qty,0);assert.equal(s.assetAllocation.positions['153130'].pending.id,p.id);
 allocateAssets(s,bondSnapshot(next),next,exposure(s));assert.ok(s.assetAllocation.positions['153130'].qty>0);assert.equal(s.assetAllocation.positions['153130'].trades[0].executionBasis,'regularOpen');
});
test('ETF risk exits remain approved and executable without Claude approval',()=>{
 const s=createState();s.mode='live';s.plans=[];enableRegularExecution(s,now-86400000);
 allocateAssets(s,bondSnapshot(),now,exposure(s));const a=s.assetAllocation.positions['153130'];a.pending=null;a.qty=10;a.cost=1000000;a.riskExitAt=now-86400000;
 allocateAssets(s,bondSnapshot(),now,exposure(s),0,null,{approved:false});assert.equal(a.pending.side,'sell');assert.equal(a.pending.riskExit,true);
 const next=now+86400000;allocateAssets(s,bondSnapshot(next),next,exposure(s),0,null,{approved:false});assert.equal(a.qty,0);assert.equal(a.trades[0].side,'sell');
});


test('unreviewed preparation cannot replace evidence used by approved entry orders',()=>{
 for(const prepare of ['research','universe']){
  const s=eligibleIdeaAccount(),current={state:s,metadata:{}},raw=ideaResearch();
  s.plans=[{symbol:'005930',side:'buy',status:'승인'}];
  const before=JSON.stringify(current);
  assert.throws(()=>prepare==='research'?prepareResearch(current,raw,testNow):prepareUniverse(current,s.marketData,{},raw,testNow),error=>error.status===409&&/승인 주문/.test(error.message));
  assert.equal(JSON.stringify(current),before);
 }
});

test('live units without preset quote times still trim at half the loss limit and exit at the full limit',()=>{
 const s=createState(),symbol='005930';
 s.mode='live';s.plans=[];s.trades=[];enableRegularExecution(s,now-86400000);
 s.holdings=[{symbol,unitId:'live-unit',direction:'long',qty:10,entry:100000,cost:1000000,stop:50000,target:200000,date:s.date,strategy:'test',lastCheckedQuoteTime:now/1000-1}];
 // recordUnitEntry creates units without lastQuoteTimes; regular execution must still see new quotes as fresh.
 const u={id:'live-unit',status:'active',capital:1000000,realizedPnl:0,lossLimit:.1,targetReturn:.1,expiresAt:'2026-12-01',softTriggered:false,reviewLog:[]};s.trendUnits=[u];
 const observe=(day,price)=>{
  const time=now+day*86400000,date=new Date(time).toISOString().slice(0,10),open=time/1000-1200;
  const quotes=Object.fromEntries(Object.keys(s.data).map(key=>[key,{price:key===symbol?price:s.data[key].at(-1).close,time:time/1000,regularSessions:[{date,openTime:open,closeTime:open+23400,open:key===symbol?price:s.data[key].at(-1).close,close:null,complete:false}]}]));
  s.marketData={quotes};advance(s,{quotes,date,now:time,riskOnly:true});
 };
 observe(0,94000);
 assert.equal(u.softTriggered,true);assert.equal(u.status,'reduced');
 const soft=s.plans.find(p=>p.riskExit&&p.status==='승인');assert.equal(soft?.qty,5);
 observe(1,94000);assert.equal(soft.status,'체결');assert.equal(s.holdings[0].qty,5);
 observe(2,85000);
 assert.equal(u.status,'closing');const hard=s.plans.find(p=>p.riskExit&&p.status==='승인');assert.equal(hard?.qty,5);assert.match(hard.reason,/전액/);
 observe(3,85000);assert.equal(hard.status,'체결');assert.equal(s.holdings.length,0);assert.equal(u.status,'closed');
});
