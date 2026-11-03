import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {readAccount,writeAccount,autonomousCycle,sessionFor,runScheduled} from '../worker/account.mjs';
import {registerHooks} from 'node:module';
const assetsHook=registerHooks({resolve(specifier,context,next){return specifier==='./assets.generated.mjs'?{url:'data:text/javascript,export default {}',shortCircuit:true}:next(specifier,context)}});
const {default:worker}=await import('../worker/index.mjs');assetsHook.deregister();
import {createState,coreCompanies} from '../web/engine.mjs';
import {ideaResearch,eligibleIdeaAccount,testNow} from './idea-fixtures.mjs';
import {enableRegularExecution} from '../web/execution.mjs';
import {queueReview,getCloudJob,getCloudRetry,claimCloudJob,finishCloudJob,verifyRuntimeApproval} from '../worker/cloud-review.mjs';
import {signApproval} from '../scripts/logic-review.mjs';
import {CODE_DIGEST} from '../worker/logic-review.mjs';

const now=Date.parse('2026-10-08T00:20:00Z'),keys=generateKeyPairSync('rsa',{modulusLength:2048});
const publicKey=JSON.stringify(keys.publicKey.export({format:'jwk'})),privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'});
const verdict={approved:true,summary:'Fixture only',issues:[]},rejected={approved:false,summary:'Evidence missing',issues:['Read primary evidence']};
function database(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 return {sqlite,async batch(statements){return Promise.all(statements.map(s=>s.run()))},prepare(sql){const s=sqlite.prepare(sql);let a=[];return {bind(...v){assert.ok(v.every(x=>typeof x!=='string'||Buffer.byteLength(x)<2000000),'D1 value limit');a=v;return this},async first(){return s.get(...a)},async all(){return {results:s.all(...a)}},async run(){return {meta:{changes:Number(s.run(...a).changes)}}}}}};
}
async function fixture(){const DB=database(),a=await readAccount(DB);return {env:{AUTH_PROVIDER:'sites',CLOUD_REVIEW_REF:'cloud-investment',DB,CLOUD_REVIEW_ENABLED:'true',CLOUD_REVIEW_REPOSITORY:'owner/private',CLOUD_REVIEW_DISPATCH_TOKEN:'not-for-model',CLOUD_REVIEW_PUBLIC_KEY:publicKey},input:{scope:'/api/run',candidate:{market:'asia',phase:'open',marketSnapshot:{fetchedAt:new Date(now).toISOString(),data:{},quotes:{}},expectedRevision:a.revision},reviewStartedAt:now,reviewDeadline:now+1800000}};}
const dispatch=async()=>new Response(null,{status:204});

test('operator exception requires an explicit request, binds one market/date, and expires without a Claude receipt',async()=>{
 const {env,input}=await fixture(),clock=Date.parse('2026-10-07T23:10:00Z');
 env.OPERATOR_REVIEW_EXCEPTION=JSON.stringify({id:'user-once-20261010',issuedAt:clock-1000,expiresAt:clock+6*86400000});
 const candidate={...input.candidate,market:'asia',phase:'pre',operatorException:'user-once-20261010'};
 try{
  assert.equal((await verifyRuntimeApproval(input.candidate,'/api/run',env,clock)).approved,false);
  const approval=await verifyRuntimeApproval(candidate,'/api/run',env,clock);
  assert.equal(approval.approved,true);assert.equal(approval.reviewer,'operator-exception');assert.equal(approval.reason,'userAuthorizedException');assert.equal(approval.exception.market,'asia');assert.equal(approval.exception.date,'2026-10-08');
  assert.equal(approval.exception.expiresAt,Date.parse('2026-10-08T15:00:00Z'));
  assert.equal('reviewProof' in approval,false);
  const a=await readAccount(env.DB);a.metadata.operatorReviewException=approval.exception;await writeAccount(env.DB,a,a.state);
  assert.equal((await verifyRuntimeApproval({...candidate,expectedRevision:a.revision+1,phase:'open'},'/api/allocation',env,now)).approved,true);
  assert.equal((await verifyRuntimeApproval({...candidate,expectedRevision:a.revision+1,market:'us'},'/api/run',env,Date.parse('2026-10-08T12:40:00Z'))).approved,false);
  assert.equal((await verifyRuntimeApproval({...candidate,expectedRevision:a.revision+1},'/api/run',env,Date.parse('2026-10-08T23:10:00Z'))).approved,false);
  assert.equal((await verifyRuntimeApproval({...candidate,operatorException:'another-id'},'/api/run',env,clock)).approved,false);
  assert.equal((await verifyRuntimeApproval({...candidate,expectedRevision:99},'/api/run',env,clock)).approved,false);
  assert.equal((await verifyRuntimeApproval({...candidate,reviewProof:{}},'/api/run',env,clock)).approved,false);
 }finally{env.DB.sqlite.close()}
});

test('operator exception cannot begin outside preopen or bypass a pause or a malformed configuration',async()=>{
 const clock=Date.parse('2026-10-07T23:10:00Z');
 for(const malformed of [null,{id:'user-once',issuedAt:clock+1,expiresAt:clock+1000},{id:'user-once',issuedAt:clock,expiresAt:clock+8*86400000}]){
  const {env,input}=await fixture();env.OPERATOR_REVIEW_EXCEPTION=JSON.stringify(malformed);
  try{assert.equal((await verifyRuntimeApproval({...input.candidate,phase:'pre',operatorException:'user-once'},'/api/run',env,clock)).approved,false)}finally{env.DB.sqlite.close()}
 }
 const {env,input}=await fixture();env.OPERATOR_REVIEW_EXCEPTION=JSON.stringify({id:'user-once',issuedAt:clock,expiresAt:clock+86400000});
 try{
  assert.equal((await verifyRuntimeApproval({...input.candidate,operatorException:'user-once'},'/api/run',env,now)).approved,false);
  const a=await readAccount(env.DB);a.metadata.paused=true;await writeAccount(env.DB,a,a.state);
  assert.equal((await verifyRuntimeApproval({...input.candidate,phase:'pre',expectedRevision:a.revision+1,operatorException:'user-once'},'/api/run',env,clock)).approved,false);
 }finally{env.DB.sqlite.close()}
});

test('operator exception persists only with a validated allocation write and restores approval per completed scope',async()=>{
 const {env}=await fixture(),clock=Date.parse('2026-10-07T23:10:00Z'),originalNow=Date.now;
 env.OPERATOR_REVIEW_EXCEPTION=JSON.stringify({id:'user-once-20261010',issuedAt:clock-1000,expiresAt:clock+86400000});Date.now=()=>clock;
 const snapshot={symbol:'153130',provider:'Yahoo Finance / Python',fetchedAt:new Date(clock).toISOString(),currency:'KRW',fx:{rate:1,time:clock/1000},quote:{price:100000,time:clock/1000,regularSessions:[]},bars:Array.from({length:21},(_,i)=>({time:clock/1000-(21-i)*86400,open:100000,high:100000,low:100000,close:100000,volume:100000})),sources:[{url:'https://finance.yahoo.com/quote/153130.KS/history/'}]};
 const post=c=>worker.fetch(new Request('https://fixture.invalid/api/allocation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c)}),env);
 try{
  const initial=await readAccount(env.DB);initial.state.mode='live';await writeAccount(env.DB,initial,initial.state);
  const a=await readAccount(env.DB),candidate={market:'asia',phase:'pre',snapshots:[snapshot],expectedRevision:a.revision,operatorException:'user-once-20261010'};
  assert.equal((await post({...candidate,snapshots:[{...snapshot,fetchedAt:new Date(clock-1800001).toISOString()}]})).status,400);
  assert.equal((await readAccount(env.DB)).metadata.operatorReviewException,undefined);
  const response=await post(candidate),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.logicReview.reviewer,'operator-exception');assert.equal(result.assetAllocation.positions['153130'].pending?.side,'buy');
  const saved=await readAccount(env.DB);assert.equal(saved.metadata.operatorReviewException.market,'asia');assert.equal(saved.metadata.operatorReviewException.date,'2026-10-08');assert.equal((await post(candidate)).status,409);
  const contextResult=await (await worker.fetch(new Request('https://fixture.invalid/api/context'),env)).json();assert.equal(contextResult.logicReview.required,true);assert.equal(contextResult.logicReview.operatorException.status,'active');
  saved.metadata.operatorReviewException.completedScopes=['/api/allocation'];await writeAccount(env.DB,saved,saved.state);
  const current=await readAccount(env.DB);
  assert.equal((await verifyRuntimeApproval({...candidate,expectedRevision:current.revision},'/api/allocation',env,clock)).approved,false);
  assert.equal((await verifyRuntimeApproval({...candidate,expectedRevision:current.revision},'/api/run',env,clock)).approved,true);
  current.metadata.operatorReviewException.completedScopes.push('/api/run');await writeAccount(env.DB,current,current.state);
  const finalContext=await (await worker.fetch(new Request('https://fixture.invalid/api/context'),env)).json();assert.equal(finalContext.logicReview.operatorException.status,'completed');
  assert.equal((await verifyRuntimeApproval({...candidate,expectedRevision:current.revision+1},'/api/run',env,clock)).approved,false);
 }finally{Date.now=originalNow;env.DB.sqlite.close()}
});

test('operator-authorized stock session creates entries at preopen, fills verified opens exactly once and completes at the close',async()=>{
 const {env}=await fixture(),pre=testNow-3600000,open=testNow,close=open+23400000,clock=open+1200000,closeClock=close+1800000,originalNow=Date.now;
 env.OPERATOR_REVIEW_EXCEPTION=JSON.stringify({id:'user-once-20261010',issuedAt:pre-1000,expiresAt:pre+86400000});
 try{
  Date.now=()=>pre;
  const s=eligibleIdeaAccount(),research=ideaResearch();research.asOf=new Date(pre).toISOString();research.investmentIdeas[0].asOf=research.asOf;enableRegularExecution(s,pre-1000);
  const quotes=Object.fromEntries(Object.entries(s.marketData.quotes).map(([symbol,q])=>[symbol,{...q,time:pre/1000-86400,regularSessions:[]}]));
  const snapshot={provider:'Yahoo Finance / Python',data:s.data,fx:s.fx,quotes,fetchedAt:new Date(pre).toISOString()};
  const finance=Object.fromEntries(['005930','000660'].map(symbol=>[symbol,{periodEnd:'2026-03-31',periodType:'12M',currency:'KRW',fetchedAt:research.asOf,sources:[{url:'https://finance.yahoo.com/quote/005930.KS/financials/'}],metrics:{revenue:1200,priorRevenue:1000,netIncome:100,equity:1000,eps:10000,debt:100,operatingCashFlow:120}}]));
  await writeAccount(env.DB,await readAccount(env.DB),s);
  const a=await readAccount(env.DB),candidate={market:'asia',phase:'pre',expectedRevision:a.revision,operatorException:'user-once-20261010'};
  const approval=await verifyRuntimeApproval(candidate,'/api/run',env,pre);
  const prepared=await runScheduled(env.DB,research,pre,snapshot,finance,sessionFor('asia','pre',pre),approval,a.revision);
  assert.ok(prepared.summary.approved>0);assert.equal(prepared.metadata.operatorReviewException.date,'2026-10-05');assert.equal(prepared.state.trades.length,0);
  Date.now=()=>clock;
  const current=await readAccount(env.DB),collect=(at,complete)=>({...snapshot,fetchedAt:new Date(at).toISOString(),data:Object.fromEntries(Object.entries(snapshot.data).map(([symbol,bars])=>[symbol,bars.map((b,i)=>i===bars.length-1?{...b,time:open/1000}:b)])),quotes:Object.fromEntries(Object.entries(quotes).map(([symbol,q])=>[symbol,{...q,time:at/1000,regularSessions:coreCompanies.find(c=>c.symbol===symbol).country==='미국'?[]:[{date:'2026-10-05',openTime:open/1000,closeTime:close/1000,open:q.price,close:complete?q.price:null,complete}]}]))});
  const payload={market:'asia',phase:'open',marketSnapshot:collect(clock,false),expectedRevision:current.revision,operatorException:'user-once-20261010'};
  const post=input=>worker.fetch(new Request('https://fixture.invalid/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),env);
  const response=await post(payload),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.ok(result.summary.newExecutions>0);assert.equal(result.summary.logicReview.reviewer,'operator-exception');assert.ok(result.state.trades.every(t=>t.executionBasis==='regularOpen'));
  const again=await (await post({...payload,expectedRevision:result.revision})).json();assert.equal(again.reused,true);assert.equal(again.state.trades.length,result.state.trades.length);
  Date.now=()=>closeClock;
  const closed=await (await post({market:'asia',phase:'close',marketSnapshot:collect(closeClock,true),expectedRevision:result.revision,operatorException:'user-once-20261010'})).json();
  assert.equal(closed.summary.newExecutions,0);assert.equal(closed.state.trades.length,result.state.trades.length);assert.ok(closed.metadata.operatorReviewException.completedScopes.includes('/api/run'));
 }finally{Date.now=originalNow;env.DB.sqlite.close()}
});

test('same-phase collection opens a new window only after expiry, without reusing old evidence or proofs',async()=>{
 const {env,input}=await fixture();
 input.reviewDeadline=now+60000;
 try{
  const first=await queueReview(env,input,now,dispatch);
  await claimCloudJob(env,first.id,{claimId:'claim'},now);
  const proof=await signApproval(input.scope,input.candidate,CODE_DIGEST,verdict,privateKey,now,{cloudJobId:first.id});
  await finishCloudJob(env,first.id,{claimId:'claim',verdict,reviewProof:proof},now);
  const renewed=clock=>({...input,reviewStartedAt:clock,reviewDeadline:clock+1800000,candidate:{...input.candidate,marketSnapshot:{...input.candidate.marketSnapshot,fetchedAt:new Date(clock).toISOString()}}});
  await assert.rejects(queueReview(env,renewed(now+1000),now+1000,dispatch),e=>e.reason==='reviewWindowChanged');
  await assert.rejects(queueReview(env,renewed(input.reviewDeadline-1),input.reviewDeadline,dispatch),e=>e.reason==='reviewWindowChanged');
  await assert.rejects(queueReview(env,{...renewed(input.reviewDeadline),reviewDeadline:now+120000,candidate:input.candidate},input.reviewDeadline,dispatch),e=>e.reason==='reviewWindowChanged');
  const calls=await Promise.all([queueReview(env,renewed(input.reviewDeadline),input.reviewDeadline,dispatch),queueReview(env,renewed(input.reviewDeadline),input.reviewDeadline,dispatch)]);
  assert.equal(calls[0].id,calls[1].id);assert.notEqual(calls[0].windowId,first.windowId);assert.equal(calls[0].round,1);
  assert.equal((await verifyRuntimeApproval({...input.candidate,reviewProof:proof},input.scope,env,input.reviewDeadline)).approved,false);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM review_evidence WHERE job_id=?').get(first.id).count,0);
  const claim=await claimCloudJob(env,calls[0].id,{claimId:'fresh'},input.reviewDeadline);
  assert.deepEqual(claim.candidate,renewed(input.reviewDeadline).candidate);
 }finally{env.DB.sqlite.close()}
});

test('dispatch and runner errors allow immutable same-window repairs within the shared five-round limit',async()=>{
 const {env,input}=await fixture();
 try{
  let job=await queueReview(env,input,now,async()=>{throw Error('temporary dispatch failure')});
  assert.equal(job.reason,'dispatchUnavailable');
  for(let round=1;round<=5;round++){
   const retry=await getCloudRetry(env,job.id,now+1000);
   const next={...input,windowId:job.windowId,previousJobId:job.id,candidate:{...retry.candidate,research:{decision:'source-backed repair '+round}}};
   await assert.rejects(queueReview(env,{...next,candidate:{...next.candidate,marketSnapshot:{...input.candidate.marketSnapshot,data:{changed:true}}}},now+1000,dispatch),e=>e.reason==='collectedEvidenceChanged');
   await assert.rejects(queueReview(env,{...next,reviewDeadline:input.reviewDeadline-1},now+1000,dispatch),e=>e.reason==='reviewWindowChanged');
   if(round===5){await assert.rejects(queueReview(env,next,now+1000,dispatch),e=>e.reason==='reviewRoundLimit');break}
   const windowId=job.windowId;job=await queueReview(env,next,now+1000,dispatch);
   assert.equal(job.windowId,windowId);assert.equal(job.reviewDeadline,input.reviewDeadline);assert.equal(job.round,round+1);
   await claimCloudJob(env,job.id,{claimId:'claim'},now+1000);
   await finishCloudJob(env,job.id,{claimId:'claim',reason:['reviewUnavailable','claudeUsageLimit','claudeAuthenticationUnavailable','reviewUnavailable'][round-1]},now+1000);
  }
  await assert.rejects(getCloudRetry(env,job.id,input.reviewDeadline),e=>e.reason==='reviewCannotBeRetried');
 }finally{env.DB.sqlite.close()}
});

test('failed evidence storage can be repaired from the original candidate without changing collected evidence',async()=>{
 const {env,input}=await fixture(),batch=env.DB.batch;
 try{
  env.DB.batch=async()=>{throw Error('temporary storage failure')};
  const job=await queueReview(env,input,now,dispatch);assert.equal(job.reason,'evidenceStoreUnavailable');
  env.DB.batch=batch;
  await assert.rejects(getCloudRetry(env,job.id,now),e=>e.reason==='reviewCannotBeRetried');
  const next={...input,previousJobId:job.id,candidate:{...input.candidate,research:{decision:'original evidence supplemented'}}};
  await assert.rejects(queueReview(env,{...next,candidate:{...next.candidate,marketSnapshot:{...input.candidate.marketSnapshot,data:{changed:true}}}},now,dispatch),e=>e.reason==='collectedEvidenceChanged');
  const repaired=await queueReview(env,next,now,dispatch);assert.equal(repaired.round,2);assert.equal(repaired.windowId,job.windowId);
 }finally{env.DB.sqlite.close()}
});

test('cloud open run skips until a verified open exists, then fills preapproved orders only once',async()=>{
 const {env}=await fixture(),pre=testNow-3600000,open=testNow,close=open+23400000,firstOpen=open+1200000,secondOpen=firstOpen+1800000;
 const originalNow=Date.now;
 try{
  Date.now=()=>pre;
  const s=eligibleIdeaAccount(),research=ideaResearch();research.asOf=new Date(pre).toISOString();research.investmentIdeas[0].asOf=research.asOf;
  enableRegularExecution(s,pre-1000);
  const quotes=Object.fromEntries(Object.entries(s.marketData.quotes).map(([symbol,q])=>[symbol,{...q,time:pre/1000-86400,regularSessions:[]}]));
  const snapshot={provider:'Yahoo Finance / Python',data:s.data,fx:s.fx,quotes,fetchedAt:new Date(pre).toISOString()};
  const finance=Object.fromEntries(['005930','000660'].map(symbol=>[symbol,{periodEnd:'2026-03-31',periodType:'12M',currency:'KRW',fetchedAt:research.asOf,sources:[{url:'https://finance.yahoo.com/quote/005930.KS/financials/'}],metrics:{revenue:1200,priorRevenue:1000,netIncome:100,equity:1000,eps:10000,debt:100,operatingCashFlow:120}}]));
  assert.ok(autonomousCycle(s,research,pre,snapshot,finance,sessionFor('asia','pre',pre)).approved>0);
  await writeAccount(env.DB,await readAccount(env.DB),s);
  const approved=s.plans.filter(p=>p.status==='승인').map(p=>p.id);
  const at=(clock,complete)=>({...snapshot,fetchedAt:new Date(clock).toISOString(),data:Object.fromEntries(Object.entries(snapshot.data).map(([symbol,bars])=>[symbol,bars.map((b,i)=>i===bars.length-1?{...b,time:open/1000}:b)])),quotes:Object.fromEntries(Object.entries(quotes).map(([symbol,q])=>[symbol,{...q,time:clock/1000,regularSessions:coreCompanies.find(c=>c.symbol===symbol).country==='미국'||!complete?[]:[{date:'2026-10-05',openTime:open/1000,closeTime:close/1000,open:q.price,close:null,complete:false}]}]))});
  let first;
  for(const [clock,complete] of [[firstOpen,false],[secondOpen,true]]){
   Date.now=()=>clock;
   const a=await readAccount(env.DB),candidate={market:'asia',phase:'open',marketSnapshot:at(clock,complete),expectedRevision:a.revision};
   const job=await queueReview(env,{scope:'/api/run',candidate,reviewStartedAt:clock,reviewDeadline:clock+1800000},clock,dispatch);
   if(first){assert.notEqual(job.windowId,first.windowId);assert.equal(job.round,1)}else first=job;
   await claimCloudJob(env,job.id,{claimId:'claim'},clock);
   const proof=await signApproval('/api/run',candidate,CODE_DIGEST,verdict,privateKey,clock,{cloudJobId:job.id});
   await finishCloudJob(env,job.id,{claimId:'claim',verdict,reviewProof:proof},clock);
   const response=await worker.fetch(new Request('https://fixture.invalid/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...candidate,reviewProof:proof})}),env);
   const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
   if(!complete){assert.equal(result.skipped,true);assert.equal(result.reason,'noVerifiedRegularSession');const saved=await readAccount(env.DB);assert.equal(saved.state.trades.length,0);assert.ok(approved.every(id=>saved.state.plans.some(p=>p.id===id&&p.status==='승인')))}
   else{assert.ok(result.summary.newExecutions>0);assert.equal(result.summary.status,'complete');assert.ok(approved.every(id=>result.state.plans.some(p=>p.id===id&&p.status==='체결')))}
  }
  const a=await readAccount(env.DB),before=a.state.trades.length;
  const repeat=await worker.fetch(new Request('https://fixture.invalid/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({market:'asia',phase:'open',marketSnapshot:at(secondOpen,true),expectedRevision:a.revision})}),env);
  const result=await repeat.json();assert.equal(repeat.status,200);assert.equal(result.reused,true);assert.equal(result.state.trades.length,before);
 }finally{Date.now=originalNow;env.DB.sqlite.close()}
});

test('preopen review cannot renew prices already stale or future at the original review start',async()=>{
 const clock=Date.parse('2026-10-07T23:10:00Z');
 for(const scope of ['/api/run','/api/allocation'])for(const age of [1800001,-1]){
  const {env,input}=await fixture(),fetchedAt=new Date(clock-age).toISOString();let calls=0;
  const candidate={market:'asia',phase:'pre',expectedRevision:input.candidate.expectedRevision,...(scope==='/api/run'?{marketSnapshot:{fetchedAt}}:{snapshots:[{fetchedAt}]})};
  try{
   await assert.rejects(queueReview(env,{scope,candidate,reviewStartedAt:clock,reviewDeadline:clock+1800000},clock,async()=>{calls++;return dispatch()}),e=>e.reason==='priceEvidenceStale');
   assert.equal(calls,0);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM review_window').get().count,0);
  }finally{env.DB.sqlite.close()}
 }
});

test('execution queues cannot advertise a window beyond the oldest collected price expiry',async()=>{
 for(const phase of ['open','close'])for(const scope of ['/api/run','/api/allocation']){
  const {env,input}=await fixture(),clock=phase==='open'?now:Date.parse('2026-10-08T07:20:00Z');
  const collected=clock-8*60000,fetchedAt=new Date(collected).toISOString();let dispatched=0;
  const candidate={market:'asia',phase,expectedRevision:input.candidate.expectedRevision,...(scope==='/api/run'?{marketSnapshot:{fetchedAt}}:{snapshots:[{fetchedAt:new Date(clock).toISOString()},{fetchedAt}]})};
  const queued={scope,candidate,reviewStartedAt:clock,reviewDeadline:clock+1800000},send=async()=>{dispatched++;return dispatch()};
  try{
   await assert.rejects(queueReview(env,queued,clock,send),e=>e.reason==='invalidReviewWindow');
   const malformed={...queued,candidate:{...candidate,...(scope==='/api/run'?{marketSnapshot:{fetchedAt:'missing'}}:{snapshots:[]})}};
   await assert.rejects(queueReview(env,malformed,clock,send),e=>e.reason==='priceEvidenceStale');
   assert.equal(dispatched,0);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM review_window').get().count,0);
   const job=await queueReview(env,{...queued,reviewDeadline:collected+1800000},clock,send);
   assert.equal(job.reviewDeadline,collected+1800000);
   const expired=await getCloudJob(env,job.id,collected+1800000);assert.equal(expired.status,'expired');
  }finally{env.DB.sqlite.close()}
 }
});

test('queue deduplication/claim/result never alter account and verified cloud receipts bind the job',async()=>{
 const {env,input}=await fixture();let calls=0;const before=env.DB.sqlite.prepare('SELECT * FROM paper_account').get();
 const send=async(url,options)=>{calls++;assert.equal(options.redirect,'manual');assert.deepEqual(JSON.parse(options.body),{ref:'cloud-investment',inputs:{job_id:JSON.parse(options.body).inputs.job_id}});return dispatch()};
 try{
  const first=await queueReview(env,input,now,send),again=await queueReview(env,input,now,send);assert.equal(first.status,'pending');assert.equal(first.id,again.id);assert.equal(calls,1);
  const claim=await claimCloudJob(env,first.id,{claimId:'fixture-claim'},now);assert.equal(claim.context.revision,input.candidate.expectedRevision);
  assert.equal((await claimCloudJob(env,first.id,{claimId:'other'},now)).claimed,false);
  const proof=await signApproval(input.scope,input.candidate,CODE_DIGEST,verdict,privateKey,now,{cloudJobId:first.id});
  await finishCloudJob(env,first.id,{claimId:'fixture-claim',verdict,reviewProof:proof},now);
  assert.equal((await getCloudJob(env,first.id,now)).status,'approved');
  assert.deepEqual((await getCloudRetry(env,first.id,now)).candidate,input.candidate);
  await assert.rejects(queueReview(env,{...input,previousJobId:first.id},now,send),e=>e.reason==='reviewCandidateUnchanged');
  assert.equal((await verifyRuntimeApproval({...input.candidate,reviewProof:proof},input.scope,env,now)).approved,true);
  assert.equal((await verifyRuntimeApproval({...input.candidate,expectedRevision:2,reviewProof:proof},input.scope,env,now)).approved,false);
  await assert.rejects(finishCloudJob(env,first.id,{claimId:'fixture-claim',verdict,reviewProof:proof},now),e=>e.status===409);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM paper_account').get(),before);
  assert.equal((await getCloudJob(env,first.id,now+900001)).status,'expired');
  assert.equal((await verifyRuntimeApproval({...input.candidate,reviewProof:proof},input.scope,env,input.reviewDeadline)).approved,false);
 }finally{env.DB.sqlite.close()}
});

test('dispatch responses other than 204 hold the job without altering the account',async()=>{
 for(const status of [200,202,301,302,303,307,308,401,500]){
  const {env,input}=await fixture(),before=env.DB.sqlite.prepare('SELECT * FROM paper_account').get();
  try{
   const job=await queueReview(env,input,now,async()=>new Response(null,{status}));
   assert.equal(job.status,'error');assert.equal(job.reason,'dispatchUnavailable');
   assert.equal((await claimCloudJob(env,job.id,{claimId:'claim'},now)).claimed,false);
   assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM paper_account').get(),before);
  }finally{env.DB.sqlite.close()}
 }
});

test('repairs preserve prices, original deadline and five-round ceiling',async()=>{
 const {env,input}=await fixture();
 try{
  let job=await queueReview(env,input,now,dispatch);
  for(let round=1;round<=5;round++){
   await claimCloudJob(env,job.id,{claimId:'claim'},now);
   await finishCloudJob(env,job.id,{claimId:'claim',verdict:rejected},now);
   const next={...input,windowId:job.windowId,previousJobId:job.id,candidate:{...input.candidate,research:{decision:'revision '+round}}};
   await assert.rejects(queueReview(env,{...next,reviewDeadline:input.reviewDeadline+1},now,dispatch));
   await assert.rejects(queueReview(env,{...next,candidate:{...next.candidate,marketSnapshot:{...input.candidate.marketSnapshot,data:{changed:true}}}},now,dispatch),e=>e.reason==='collectedEvidenceChanged');
   if(round<5)job=await queueReview(env,next,now,dispatch);else await assert.rejects(queueReview(env,next,now,dispatch),/round/i);
  }
  await assert.rejects(queueReview(env,{...input,reviewStartedAt:now+1,reviewDeadline:now+1800001},now+2,dispatch));
 }finally{env.DB.sqlite.close()}
});

test('wrong scope, forged approval, stale revision, malformed verdict and dispatch failure hold',async()=>{
 const {env,input}=await fixture();
 try{
  await assert.rejects(queueReview(env,{...input,scope:'/api/pause'},now,dispatch));
  await assert.rejects(queueReview(env,{...input,candidate:{...input.candidate,expectedRevision:99}},now,dispatch),e=>e.status===409);
  const job=await queueReview(env,input,now,dispatch);await claimCloudJob(env,job.id,{claimId:'claim'},now);
  await assert.rejects(finishCloudJob(env,job.id,{claimId:'claim',verdict:{...verdict,issues:['contradiction']}},now));
  await assert.rejects(finishCloudJob(env,job.id,{claimId:'claim',verdict,reviewProof:{approved:true}},now));
  const fake={...input,scope:'/api/allocation',candidate:{market:'asia',phase:'open',expectedRevision:input.candidate.expectedRevision,snapshots:[{fetchedAt:new Date(now).toISOString()}]}};
  const failed=await queueReview(env,fake,now,async()=>{throw Error('redirect or secret')});assert.equal(failed.status,'error');assert.equal(failed.reason,'dispatchUnavailable');
  assert.ok(!JSON.stringify(await getCloudJob(env,job.id,now)).includes('not-for-model'));
 }finally{env.DB.sqlite.close()}
});
test('expired evidence is erased; a stale revision keeps original evidence only for a same-window new review',async()=>{
 const {env,input}=await fixture();
 try{
  const job=await queueReview(env,input,now,dispatch);await claimCloudJob(env,job.id,{claimId:'claim'},now);await finishCloudJob(env,job.id,{claimId:'claim',verdict:rejected},now);
  env.DB.sqlite.exec('UPDATE paper_account SET revision=revision+1');
  const retry=await getCloudRetry(env,job.id,now+1000);assert.equal(retry.status,'expired');assert.deepEqual(retry.candidate,input.candidate);
  const next=await queueReview(env,{...input,windowId:job.windowId,previousJobId:job.id,candidate:{...input.candidate,expectedRevision:input.candidate.expectedRevision+1,research:{reason:'Read source'}}},now+1000,dispatch);
  assert.equal(next.round,2);assert.equal(next.reviewDeadline,input.reviewDeadline);
  const end=await getCloudJob(env,next.id,input.reviewDeadline);assert.equal(end.status,'expired');assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM review_evidence WHERE job_id=?').get(next.id).count,0);
  await assert.rejects(getCloudRetry(env,next.id,input.reviewDeadline));
 }finally{env.DB.sqlite.close()}
});
test('large full-candidate evidence exceeds2MB but preserves UTF-8 and hashes across bounded D1 rows',async()=>{
 const {env,input}=await fixture();
 try{
  const bars=Array.from({length:25000},(_,i)=>({time:now/1000-i*86400,open:12345,high:12400,low:12000,close:12350,volume:100000,note:'원문🌍'}));
  const large={...input,candidate:{...input.candidate,marketSnapshot:{...input.candidate.marketSnapshot,data:{AAPL:bars},quotes:{}}}};
  assert.ok(Buffer.byteLength(JSON.stringify(large))>2000000);
  const job=await queueReview(env,large,now,dispatch),claim=await claimCloudJob(env,job.id,{claimId:'claim'},now);
  assert.deepEqual(claim.candidate,large.candidate);assert.ok(env.DB.sqlite.prepare('SELECT chunk_count FROM review_job WHERE id=?').get(job.id).chunk_count>1);
 }finally{env.DB.sqlite.close()}
});
test('simultaneous duplicate requests dispatch once and consume one round; phase-end extensions fail',async()=>{
 const {env,input}=await fixture();let calls=0;
 try{
  const send=async()=>{calls++;return dispatch()};
  const [first,second]=await Promise.all([queueReview(env,input,now,send),queueReview(env,input,now,send)]);
  assert.equal(first.id,second.id);assert.equal(calls,1);assert.equal(env.DB.sqlite.prepare('SELECT rounds FROM review_window').get().rounds,1);
  await claimCloudJob(env,first.id,{claimId:'claim'},now);await finishCloudJob(env,first.id,{claimId:'claim',reason:'claudeUsageLimit'},now);
  assert.equal((await getCloudJob(env,first.id,now)).reason,'claudeUsageLimit');
  const pre=Date.parse('2026-10-08T23:55:00Z');
  await assert.rejects(queueReview(env,{...input,candidate:{...input.candidate,phase:'pre'},reviewStartedAt:pre,reviewDeadline:pre+1800000},pre,send),/MarketPhase/);
 }finally{env.DB.sqlite.close()}
});

test('cloud queue requires an explicit session and five rounds are shared by both scopes and revision retries',async()=>{
 const {env,input}=await fixture();
 try{
  await assert.rejects(queueReview(env,{...input,candidate:{expectedRevision:input.candidate.expectedRevision}},now,dispatch),e=>e.reason==='sessionPhaseRequired');
  let prior={};
  for(let i=0;i<5;i++){
   const scope=i%2?'/api/allocation':'/api/run';
   const candidate=scope==='/api/run'?{...input.candidate,expectedRevision:input.candidate.expectedRevision+i}:{market:'asia',phase:'open',snapshots:[{fetchedAt:new Date(now).toISOString()}],expectedRevision:input.candidate.expectedRevision+i};
   const job=await queueReview(env,{...input,scope,candidate,...(prior[scope]?{previousJobId:prior[scope]}:{})},now,dispatch);
   assert.equal(job.round,i+1);prior[scope]=job.id;
   await claimCloudJob(env,job.id,{claimId:'claim'},now);await finishCloudJob(env,job.id,{claimId:'claim',verdict:rejected},now);
   env.DB.sqlite.exec('UPDATE paper_account SET revision=revision+1');
  }
  await assert.rejects(queueReview(env,{...input,previousJobId:prior['/api/run'],candidate:{...input.candidate,expectedRevision:input.candidate.expectedRevision+5}},now,dispatch),e=>e.reason==='reviewRoundLimit');
 }finally{env.DB.sqlite.close()}
});

test('approved preopen stock/ETF evidence survives a 26-minute review with prices fresh at review start; unreviewed and execution prices stay strict',async()=>{
 const {env}=await fixture(),clock=Date.parse('2026-10-07T23:10:00Z'),submitted=clock+26*60000,collected=clock-25*60000;
 const originalNow=Date.now;Date.now=()=>clock;
 const research=ideaResearch();research.asOf=new Date(clock).toISOString();research.investmentIdeas[0].asOf=research.asOf;
 const s=createState(),marketSnapshot={provider:'Yahoo Finance / Python',fetchedAt:new Date(collected).toISOString(),data:s.data,fx:{KRW:1,USD:1400,JPY:9.5},quotes:Object.fromEntries(coreCompanies.map(c=>[c.symbol,{price:100,time:collected/1000,currency:c.currency,regularSessions:[]}]))};
 const snapshots=[{symbol:'153130',provider:'Yahoo Finance / Python',fetchedAt:new Date(collected).toISOString(),currency:'KRW',fx:{rate:1,time:collected/1000},quote:{price:100000,time:collected/1000,regularSessions:[]},bars:Array.from({length:21},(_,i)=>({time:collected/1000-(21-i)*86400,open:100000,high:100000,low:100000,close:100000,volume:100000})),sources:[{url:'https://finance.yahoo.com/quote/153130.KS/history/'}]}];
 const post=(scope,candidate)=>worker.fetch(new Request('https://fixture.invalid'+scope,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(candidate)}),env);
 try{
  const initial=await readAccount(env.DB);initial.state.mode='live';await writeAccount(env.DB,initial,initial.state);
  for(const scope of ['/api/allocation','/api/run']){
   Date.now=()=>clock;
   const a=await readAccount(env.DB),candidate={market:'asia',phase:'pre',expectedRevision:a.revision,...(scope==='/api/run'?{marketSnapshot,research}:{snapshots})};
   const job=await queueReview(env,{scope,candidate,reviewStartedAt:clock,reviewDeadline:clock+1800000},clock,dispatch);
   await claimCloudJob(env,job.id,{claimId:'claim'},submitted);
   const proof=await signApproval(scope,candidate,CODE_DIGEST,verdict,privateKey,submitted,{cloudJobId:job.id});
   await finishCloudJob(env,job.id,{claimId:'claim',verdict,reviewProof:proof},submitted);
   Date.now=()=>submitted;
   assert.equal((await post(scope,candidate)).status,400,'Unsigned stale evidence must fail');
   const response=await post(scope,{...candidate,reviewProof:proof});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
   assert.equal((await response.json()).logicReview?.approved??(await readAccount(env.DB)).state.lastCycle.logicReview.approved,true);
  }
  Date.now=()=>Date.parse('2026-10-08T07:00:00Z');
  const a=await readAccount(env.DB),candidate={market:'asia',phase:'close',snapshots,expectedRevision:a.revision};
  const close=Date.now(),before=env.DB.sqlite.prepare('SELECT * FROM paper_account').get();
  await assert.rejects(queueReview(env,{scope:'/api/allocation',candidate,reviewStartedAt:close,reviewDeadline:close+1800000},close,dispatch),e=>e.reason==='priceEvidenceStale');
  assert.equal((await post('/api/allocation',candidate)).status,400);assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM paper_account').get(),before);
 }finally{Date.now=originalNow;env.DB.sqlite.close()}
});

test('a preopen stock review judges the candidate research readiness and quant ranking, not the stored research',async()=>{
 const {env,input}=await fixture(),clock=Date.parse('2026-10-07T23:10:00Z'),research=ideaResearch();
 const candidate={market:'asia',phase:'pre',expectedRevision:input.candidate.expectedRevision,marketSnapshot:{fetchedAt:new Date(clock).toISOString()},research};
 try{
  const job=await queueReview(env,{scope:'/api/run',candidate,reviewStartedAt:clock,reviewDeadline:clock+1800000},clock,dispatch);
  const {context}=await claimCloudJob(env,job.id,{claimId:'fixture-claim'},clock);
  const ideaIds=research.investmentIdeas.filter(i=>i.action==='review').map(i=>i.id);
  assert.ok(ideaIds.length>0);
  assert.deepEqual(context.researchReadiness.coverage.map(c=>c.ideaId),ideaIds);
  assert.deepEqual(context.investmentProcess.quantResearch.map(q=>q.ideaId),ideaIds);
 }finally{env.DB.sqlite.close()}
});
