import test from 'node:test';
import {withIdea} from './idea-fixtures.mjs';
import assert from 'node:assert/strict';
import * as account from '../worker/account.mjs';
import {createState,advance,coreCompanies as companies} from '../web/engine.mjs';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync} from 'node:crypto';
import {signApproval} from '../scripts/logic-review.mjs';
import {CODE_DIGEST} from '../worker/logic-review.mjs';
const reviewKeys=generateKeyPairSync('rsa',{modulusLength:2048});
const publicReviewKey=JSON.stringify(reviewKeys.publicKey.export({format:'jwk'}));
async function approvedInput(scope,input){return {...input,reviewProof:await signApproval('/api/'+scope,input,CODE_DIGEST,{approved:true,summary:'Fixture logical review',issues:[]},reviewKeys.privateKey.export({type:'pkcs8',format:'pem'}))};}

// The deployed worker bundles static assets; API tests use the same bundle with empty assets.
const built=await build({entryPoints:[fileURLToPath(new URL('../worker/index.mjs',import.meta.url))],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'test-static-assets',setup(b){b.onResolve({filter:/assets\.generated\.mjs$/},()=>({path:'assets',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export default {}'}));}}]});
const worker=(await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'))).default;

const now=Date.parse('2026-10-04T07:00:00Z'),url='https://example.com/evidence';
const factors=['leading','growth','inflation','policy','liquidity'];
const departments=['screening','technical','fundamental','market'];
function independentResearch(){return Object.fromEntries(departments.map(d=>[d,companies.map(c=>{const nominate=d==='fundamental'&&['005930','000660','AAPL'].includes(c.symbol);return {symbol:c.symbol,stance:nominate?'allow':'watch',score:nominate?80:null,reason:c.name+' 독립 원문 검토 후 '+(nominate?'후보 제안':'관찰'),sourceUrls:[url],...(d==='fundamental'?{businessPass:nominate}:{})};})]));}
function research(){return {asOf:new Date(now).toISOString(),topDown:'시장 조사',bottomUp:'기업 조사',decision:'검토',limitations:'시험',sources:[{title:'시험 출처',url}],departmentResearch:independentResearch(),macroScorecard:factors.map(factor=>({factor,region:'한국',signal:'neutral',observedAt:'2026-10-01',reason:'관측값 확인',sourceUrls:[url]})),trendUnits:[{id:'test',name:'한국 바스켓',category:'theme',riskProfile:'riskOn',regime:'bull',direction:'long',region:'한국',thesis:'투자 논리',catalyst:'촉매',invalidation:'철회 조건',allocationReason:'배분 판단',riskBasis:'손실 한도 검토',targetReturn:.1,lossLimit:.1,maxWeight:.2,horizonMonths:3,members:[{symbol:'005930',weight:.5,reason:'기업 검토'},{symbol:'000660',weight:.5,reason:'기업 검토'}],referenceIndex:{name:'시험 참조지수',asOf:'2026-10-01',constituents:['005930','000660'],sourceUrls:[url]},sourceUrls:[url]}]};}
function check(raw,state=createState()){assert.equal(typeof account.researchCheck,'function');return account.researchCheck(state,raw,now);}

test('research preflight names the exact invalid department source row without leaking submitted URLs',()=>{
 const raw=withIdea(research());raw.departmentResearch.technical[0].sourceUrls=['https://unregistered.example/private-token'];
 const result=check(raw);
 assert.equal(result.complete,false);assert.ok(result.missing.some(m=>m.field==='technical.005930.sourceUrls'&&m.kind==='validation'));
 assert.equal(JSON.stringify(result).includes('private-token'),false);
 raw.departmentResearch.technical[0].sourceUrls=Array(7).fill(url);
 assert.ok(check(raw).missing.some(m=>m.field==='technical.005930.sourceUrls'&&m.reason.includes('6')));
 raw.departmentResearch.technical[0].sourceUrls=[url];assert.equal(check(raw).complete,true);
});

test('research preflight names the row and field behind a department value error',()=>{
 const raw=withIdea(research());raw.departmentResearch.fundamental[0].stance='buy';
 const gap=check(raw).missing.find(m=>m.field==='fundamental.005930.stance');
 assert.ok(gap);assert.equal(gap.kind,'validation');assert.equal(gap.symbol,'005930');assert.match(gap.reason,/allow\|watch\|avoid/);assert.match(gap.reason,/buy/);
 raw.departmentResearch.fundamental[0].stance='allow';raw.departmentResearch.fundamental[0].score=101;
 assert.ok(check(raw).missing.some(m=>m.field==='fundamental.005930.score'));
 raw.departmentResearch.fundamental[0].score=80;assert.equal(check(raw).complete,true);
});
test('complete proposed basket requires five current sourced factors only for its member countries',()=>{
 const result=check(research());assert.equal(result.complete,true);assert.deepEqual(result.missing,[]);assert.deepEqual(result.regions.map(r=>r.region),['한국']);assert.equal(result.regions[0].observations,5);
});
test('no nominations and empty departments cannot be reported as completed research',()=>{
 const raw=research();raw.departmentResearch={};raw.trendUnits=[];const result=check(raw);assert.equal(result.complete,false);assert.equal(result.missing.filter(m=>m.kind==='department').length,companies.length*departments.length);assert.ok(result.missing.some(m=>m.region==='미국'&&m.field==='technical.AAPL'));
});
test('every department needs each known symbol exactly once with reason and registered source',()=>{
 for(const mutate of [raw=>raw.departmentResearch.technical.pop(),raw=>raw.departmentResearch.market[0].reason=' ',raw=>raw.departmentResearch.screening[0].sourceUrls=[],raw=>raw.departmentResearch.fundamental[0].sourceUrls=['https://unregistered.example/'],raw=>raw.departmentResearch.technical[0]=raw.departmentResearch.technical[1]]){
  const raw=research();mutate(raw);const result=check(raw);assert.equal(result.complete,false);assert.ok(result.missing.some(m=>m.kind==='department'&&departments.some(d=>m.field.startsWith(d+'.'))));
 }
});
test('a complete sourced watch decision does not require businessPass for every company',()=>{
 const raw=research();raw.trendUnits=[];raw.macroScorecard=[];for(const rows of Object.values(raw.departmentResearch))for(const row of rows){row.stance='watch';row.businessPass=false;}
 assert.equal(check(raw).complete,true);
});
test('missing liquidity and reference date appear as actionable country-specific fields',()=>{
 const raw=research();raw.macroScorecard.pop();raw.trendUnits[0].referenceIndex.asOf='2025-10-01';const r=check(raw);
 assert.equal(r.complete,false);assert.ok(r.missing.some(m=>m.region==='한국'&&m.kind==='macro'&&m.field==='liquidity'));assert.ok(r.missing.some(m=>m.kind==='referenceIndex'&&m.field==='asOf'));assert.equal(r.regions[0].observations,4);
});
test('without proposals sourced business nominations require their own macro and investment basket',()=>{
 const raw=research();raw.trendUnits=[];const r=check(raw);assert.equal(r.complete,false);assert.deepEqual(r.regions.map(r=>r.region).sort(),['미국','한국']);assert.ok(r.missing.some(m=>m.region==='미국'&&m.field==='leading'));assert.ok(r.missing.some(m=>m.kind==='basket'&&m.field==='trendUnits'));
});
test('a declared region label cannot substitute the member countries macro',()=>{
 const raw=research();raw.trendUnits[0].region='미국';raw.macroScorecard=raw.macroScorecard.map(r=>({...r,region:'미국'}));const r=check(raw);assert.equal(r.complete,false);assert.ok(r.missing.some(m=>m.region==='한국'&&m.kind==='macro'));assert.equal(r.missing.some(m=>m.kind==='basket'&&m.field==='region'),false);
});
test('unknown, stale, future and blank macro evidence do not satisfy readiness',()=>{
 for(const mutate of [r=>r.signal='unknown',r=>r.observedAt='2025-10-01',r=>r.observedAt='2026-10-20',r=>r.reason=' ']){const raw=research();mutate(raw.macroScorecard[0]);assert.equal(check(raw).complete,false);}
 const raw=research();raw.asOf='2026-09-01';assert.ok(check(raw).missing.some(m=>m.kind==='research'&&m.field==='asOf'));
});
test('invalid research returns structured missing fields without reflecting private submitted values',()=>{
 const raw=research();raw.trendUnits[0].members[0].weight=.9;raw.privateToken='never-echo-this';const r=check(raw);assert.equal(r.complete,false);assert.ok(r.missing.some(m=>m.kind==='validation'));assert.ok(!JSON.stringify(r).includes('never-echo-this'));
});
test('an empty unsourced observation cannot be called completed research',()=>{
 const raw=research();raw.sources=[];raw.departmentResearch={};raw.macroScorecard=[];raw.trendUnits=[];const result=check(raw);assert.equal(result.complete,false);assert.ok(result.missing.some(m=>m.field==='sources'));
});
test('incomplete live cycle is reported pending while existing stop monitoring continues',()=>{
 const s=createState();s.mode='live';s.plans=[];s.trades=[];s.holdings=[{symbol:'005930',direction:'long',qty:1,entry:1000,cost:1000,stop:950,target:1100,date:'2026-10-01',strategy:'test',lastCheckedQuoteTime:1}];
 const raw=research();raw.macroScorecard.pop();const snapshot={data:s.data,fx:{KRW:1,USD:1400,JPY:9.5},quotes:Object.fromEntries(companies.map(c=>[c.symbol,{price:900,time:2,currency:c.currency}]))};
 const summary=account.autonomousCycle(s,raw,now,snapshot,{});assert.equal(summary.status,'researchIncomplete');assert.equal(summary.researchReadiness.complete,false);assert.equal(s.analysis.researchReadiness.complete,false);assert.equal(s.holdings.length,0);assert.ok(s.trades.some(t=>t.side==='sell'));assert.ok(!s.trades.some(t=>['buy','short'].includes(t.side)));assert.equal(account.context({state:s,metadata:{},revision:1}).researchReadiness.complete,false);
});
test('invalid newly submitted research cannot interrupt existing risk exits',()=>{
 const s=createState();s.mode='live';s.plans=[];s.trades=[];s.holdings=[{symbol:'005930',direction:'long',qty:1,entry:1000,cost:1000,stop:950,target:1100,date:'2026-10-01',strategy:'test',lastCheckedQuoteTime:1}];
 const raw=research();raw.trendUnits[0].members[0].weight=.9;const snapshot={data:s.data,fx:{KRW:1,USD:1400,JPY:9.5},quotes:Object.fromEntries(companies.map(c=>[c.symbol,{price:900,time:2,currency:c.currency}]))};
 const summary=account.autonomousCycle(s,raw,now,snapshot,{});assert.equal(summary.status,'researchIncomplete');assert.ok(summary.researchReadiness.missing.some(m=>m.kind==='validation'));assert.equal(s.holdings.length,0);assert.ok(s.trades.some(t=>t.side==='sell'));
});

test('research enrichment rechecks business evidence and forms pending plans without executing or consuming a slot',()=>{
 const s=createState();s.mode='live';s.investmentProcessVersion=4;s.plans=[];s.trades=[];s.holdings=[];s.fundamentals={};s.date='2026-10-04';s.marketData={fetchedAt:new Date(now).toISOString()};
 for(const symbol of ['005930','000660'])s.fundamentals[symbol]={pass:false,businessPass:false,fetchedAt:new Date(now).toISOString(),checks:[{name:'재무 수집 30일 이내',pass:true},{name:'동일 기간 필수 계정 확인',pass:true},{name:'최신 바텀업 사업·공시 검토',pass:false}],metrics:{pe:10,roe:.1,revenueGrowth:.1},text:'검증',limitations:'시험'};
 const old={id:'old',symbol:'AAPL',side:'buy',status:'승인',date:s.date,qty:1};s.plans=[old];const current={state:s,metadata:{runCount:3,lastSlot:100,lastRun:new Date(now).toISOString()},revision:4};const before=JSON.stringify({trades:s.trades,holdings:s.holdings,marketData:s.marketData,metadata:current.metadata});
 assert.equal(typeof account.prepareResearch,'function');
 const frozen=JSON.stringify(current);assert.throws(()=>account.prepareResearch(current,withIdea(research()),now),error=>error.status===409);assert.equal(JSON.stringify(current),frozen);
 old.status='만료';const readiness=account.prepareResearch(current,withIdea(research()),now);
 assert.equal(readiness.complete,true);assert.equal(s.fundamentals['005930'].pass,true);assert.equal(s.analysis.researchReadiness.complete,true);assert.ok(s.plans.some(p=>['005930','000660'].includes(p.symbol)&&['대기','보류'].includes(p.status)));assert.deepEqual(old,{id:'old',symbol:'AAPL',side:'buy',status:'만료',date:s.date,qty:1});
 assert.equal(JSON.stringify({trades:s.trades,holdings:s.holdings,marketData:s.marketData,metadata:current.metadata}),before);
 account.prepareResearch(current,withIdea(research()),now+2*86400000);assert.equal(s.fundamentals['005930'].pass,false);assert.equal(s.analysis.researchReadiness.complete,false);
});

function database(){const d=new DatabaseSync(':memory:');for(const path of ['0000_new_millenium_guard.sql','0001_nifty_marrow.sql','0002_steady_ricochet.sql','0003_amused_patch.sql'])d.exec(readFileSync(new URL('../drizzle/'+path,import.meta.url),'utf8'));return {prepare(sql){const stmt=d.prepare(sql);let args=[];return {bind(...a){args=a;return this},async first(){return stmt.get(...args)},async all(){return {results:stmt.all(...args)}},async run(){return {meta:{changes:Number(stmt.run(...args).changes)}}}}}};}
const request=(path,input)=>new Request('https://example.com/api/'+path,input===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
test('context advertises the 30-minute execution review budget',async()=>{
 const response=await worker.fetch(request('context'),{AUTH_PROVIDER:'sites',DB:database()});
 assert.equal(response.status,200);
 assert.equal((await response.json()).logicReview.maxMinutes,30);
});
test('cloud authentication diagnostic verifies its own scope and never writes the account',async()=>{
 const db=database(),before=await account.readAccount(db),candidate={purpose:'Read-only cloud diagnostic',nonce:'fixture-nonce',expectedRevision:before.revision};
 const signed=await approvedInput('logic-review/check',candidate),env={AUTH_PROVIDER:'sites',DB:db,CLOUD_REVIEW_PUBLIC_KEY:publicReviewKey,CLOUD_REVIEW_ENABLED:'false'};
 let response=await worker.fetch(request('logic-review/check',signed),env);assert.equal(response.status,200);assert.equal((await response.json()).approved,true);
 response=await worker.fetch(request('logic-review/check',{...signed,nonce:'changed'}),env);assert.equal((await response.json()).approved,false);
 response=await worker.fetch(request('logic-review/check',{...signed,expectedRevision:99}),env);assert.equal(response.status,409);
 const after=await account.readAccount(db);assert.equal(after.revision,before.revision);assert.deepEqual(after.state,before.state);assert.deepEqual(after.metadata,before.metadata);
});

for(const minute of [5,20])test(`a premarket request arriving ${minute} minutes after opening still monitors and executes risk only`,async t=>{
 const open=Date.parse('2026-10-06T00:00:00Z'),time=open+minute*60000;
 t.mock.method(Date,'now',()=>time);
 const db=database(),initial=await account.readAccount(db),s=initial.state;
 s.mode='live';s.plans=[];s.trades=[];s.holdings=[];
 s.executionPolicy={version:3,activatedAt:new Date(open-86400000).toISOString()};
 for(const symbol of ['005930','000660','035420']){
  const price=s.data[symbol].at(-1).close;
  s.holdings.push({symbol,qty:1,entry:price,cost:price,stop:symbol==='000660'?price*1.1:price*.5,target:price*2,date:s.date,strategy:'test',lastCheckedQuoteTime:open/1000-1});
 }
 s.plans=[{id:'risk-exit',symbol:'005930',side:'sell',qty:1,status:'승인',riskExit:true,eligibleAfter:open/1000-60,reason:'사전 승인 손절'},
  {id:'manual-exit',symbol:'035420',side:'sell',qty:1,status:'승인',eligibleAfter:open/1000-60},
  {id:'pending-entry',symbol:'005380',side:'buy',qty:1,status:'승인',eligibleAfter:open/1000-60}];
 for(const p of s.plans){const price=s.data[p.symbol].at(-1).close;Object.assign(p,{reference:price,stop:price*.5,target:price*2,date:s.date});}
 const saved=await account.writeAccount(db,initial,s,{...initial.metadata,sessionMode:true});
 const quotes=Object.fromEntries(companies.map(c=>{
  const price=s.data[c.symbol].at(-1).close;
  const sessions=c.country==='한국'?[{date:'2026-10-06',openTime:open/1000,closeTime:open/1000+23400,open:price,close:null,complete:false}]:[];
  if(sessions.length)Object.assign(s.data[c.symbol].at(-1),{time:open/1000,open:price});
  return [c.symbol,{price,time:time/1000,currency:c.currency,regularSessions:sessions}];
 }));
 const input={market:'asia',phase:'pre',research:{asOf:new Date(time).toISOString(),screening:[{symbol:'035420',exit:true}]},fundamentals:{},marketSnapshot:{provider:'Yahoo Finance / Python',fetchedAt:new Date(time).toISOString(),data:s.data,fx:{KRW:1,USD:1400,JPY:9.5},quotes},expectedRevision:saved.revision};
 const response=await worker.fetch(request('run',input),{AUTH_PROVIDER:'sites',DB:db,CLAUDE_REVIEW_PUBLIC_KEY:publicReviewKey});
 assert.equal(response.status,200);
 const result=await response.json(),after=await account.readAccount(db);
 assert.equal(result.summary.status,'logicReviewHeld');assert.equal(result.summary.session.phase,'open');assert.equal(result.summary.approved,0);
 assert.equal(after.state.trades.length,1);assert.equal(after.state.trades[0].symbol,'005930');assert.equal(after.state.trades[0].executionBasis,'regularOpen');
 assert.ok(after.state.plans.some(p=>p.symbol==='000660'&&p.riskExit&&p.status==='승인'));
 for(const id of ['manual-exit','pending-entry'])assert.equal(after.state.plans.find(p=>p.id===id).status,'승인');
 const reviewed=await approvedInput('run',{...input,expectedRevision:after.revision});
 const rejected=await worker.fetch(request('run',reviewed),{AUTH_PROVIDER:'sites',DB:db,CLAUDE_REVIEW_PUBLIC_KEY:publicReviewKey});
 assert.equal(rejected.status,400);assert.equal((await account.readAccount(db)).revision,after.revision);
});

for(const minute of [5,20])test(`a premarket ETF request arriving ${minute} minutes after opening processes risk only`,async t=>{
 const open=Date.parse('2026-10-06T13:30:00Z'),time=open+minute*60000,pre=open-60000;
 t.mock.method(Date,'now',()=>time);
 const db=database(),initial=await account.readAccount(db),s=initial.state;
 s.mode='live';s.plans=[];s.trades=[];s.holdings=[];enableRegularExecution(s,open-86400000);
 const snapshots=['IEF','TLT','JEPQ','SGOV'].map(symbol=>({symbol,currency:'USD',provider:'Yahoo Finance / Python',fetchedAt:new Date(time).toISOString(),fx:{rate:1400,time:time/1000,source:'https://finance.yahoo.com/quote/KRW=X/'},quote:{price:50,time:time/1000,regularSessions:[{date:'2026-10-06',openTime:open/1000,closeTime:open/1000+23400,open:50,close:null,complete:false}]},bars:Array.from({length:21},(_,i)=>({time:open/1000-(20-i)*86400,open:50,high:50,low:50,close:50,volume:100000})),sources:[{url:`https://finance.yahoo.com/quote/${symbol}/history/`}]}));
 s.assetAllocation={version:1,positions:Object.fromEntries(snapshots.slice(0,3).map(raw=>{
  const pending=raw.symbol==='IEF'?null:{id:'risk-'+raw.symbol,symbol:raw.symbol,side:'sell',qty:60,reference:50,status:'승인',riskExit:true,signalTimestamp:pre/1000};
  if(pending)stampDecision(pending,pre);
  return [raw.symbol,{symbol:raw.symbol,assetClass:raw.symbol==='JEPQ'?'equity':'bond',qty:60,cost:raw.symbol==='IEF'?5600000:4200000,quote:raw.quote,fx:raw.fx,trades:[],distributions:[],pending,...(raw.symbol==='TLT'?{openedAt:open/1000-91*86400,riskExitAt:pre}:{})}];
 }))};
 s.cash-=14000000;
 const saved=await account.writeAccount(db,initial,s,{...initial.metadata,sessionMode:true});
 const input={market:'us',phase:'pre',snapshots,decision:{asOf:new Date(time).toISOString(),weights:{SGOV:.25},reason:'Fixture allocation',risks:'Fixture risk',sourceUrls:['https://finance.yahoo.com/quote/SGOV/']},expectedRevision:saved.revision};
 const response=await worker.fetch(request('allocation',input),{AUTH_PROVIDER:'sites',DB:db,CLAUDE_REVIEW_PUBLIC_KEY:publicReviewKey});
 assert.equal(response.status,200);
 const result=await response.json(),after=await account.readAccount(db),positions=after.state.assetAllocation.positions;
 assert.equal(result.logicReview.approved,false);assert.equal(after.state.assetAllocation.decision,undefined);
 assert.equal(positions.IEF.qty,60);assert.equal(positions.IEF.pending.side,'sell');assert.equal(positions.IEF.pending.riskExit,true);assert.equal(positions.IEF.riskExitAt,time);
 for(const symbol of ['TLT','JEPQ']){
  assert.equal(positions[symbol].qty,0);assert.equal(positions[symbol].trades.length,1);assert.equal(positions[symbol].trades[0].side,'sell');
  assert.equal(positions[symbol].trades[0].executionBasis,'regularOpen');assert.equal(positions[symbol].trades[0].executionTime,open/1000);
 }
 assert.equal(positions.SGOV.qty,0);assert.equal(positions.SGOV.pending,null);assert.equal(positions.SGOV.status,'logicReviewHeld');assert.equal(positions.SGOV.trades.length,0);
 const reviewed=await approvedInput('allocation',{...input,expectedRevision:after.revision});
 const rejected=await worker.fetch(request('allocation',reviewed),{AUTH_PROVIDER:'sites',DB:db,CLAUDE_REVIEW_PUBLIC_KEY:publicReviewKey});
 assert.equal(rejected.status,400);
 const unchanged=await account.readAccount(db);assert.equal(unchanged.revision,after.revision);assert.deepEqual(unchanged.state,after.state);
});

test('expanded theme requests pass the old 5MB boundary while the new byte cap remains enforced',async()=>{
 const db=database();
 let response=await worker.fetch(new Request('https://example.com/api/research-check',{method:'POST',headers:{'content-type':'application/json'},body:'{}'+' '.repeat(5100000)}),{AUTH_PROVIDER:'sites',DB:db});
 assert.equal(response.status,200);
 response=await worker.fetch(request('research-check',{research:{topDown:'한'.repeat(3400000)}}),{AUTH_PROVIDER:'sites',DB:db});
 assert.equal(response.status,400);
});
function currentResearch(){const raw=research(),stamp=new Date().toISOString();raw.asOf=stamp;raw.macroScorecard=raw.macroScorecard.map(r=>({...r,observedAt:stamp}));raw.trendUnits[0].referenceIndex.asOf=stamp;return withIdea(raw);}
test('GET and POST preflight are read-only; same-slot research preparation cannot execute or increment run count',async()=>{
 const db=database(),initial=await account.readAccount(db);initial.state.mode='live';initial.state.plans=[];initial.state.trades=[];initial.state.holdings=[];
 const metadata={...initial.metadata,lastSlot:account.slotFor(Date.now()),lastRun:new Date().toISOString(),runCount:7};const before=await account.writeAccount(db,initial,initial.state,metadata),raw=currentResearch();
 for(const req of [request('research-check'),request('research-check',{research:raw})])assert.equal((await worker.fetch(req,{AUTH_PROVIDER:'sites',DB:db})).status,200);
 const afterCheck=await account.readAccount(db);assert.equal(afterCheck.revision,before.revision);assert.deepEqual(afterCheck.metadata,before.metadata);
 const response=await worker.fetch(request('research',{research:raw,expectedRevision:before.revision}),{AUTH_PROVIDER:'sites',DB:db}),result=await response.json();assert.equal(response.status,200);assert.equal(result.status,'researchPrepared');assert.equal(result.researchReadiness.complete,true);
 const after=await account.readAccount(db);assert.equal(after.revision,before.revision+1);assert.deepEqual(after.metadata,before.metadata);assert.deepEqual(after.state.trades,before.state.trades);assert.deepEqual(after.state.holdings,before.state.holdings);assert.equal(after.state.cash,before.state.cash);
 assert.equal((await worker.fetch(request('research',{research:raw,expectedRevision:before.revision}),{AUTH_PROVIDER:'sites',DB:db})).status,409);assert.equal((await account.readAccount(db)).revision,after.revision);
});
test('incomplete all-cash API run returns missing fields without saving or consuming its slot',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-08T23:20:00Z')});
 const db=database(),before=await account.readAccount(db),raw=currentResearch();raw.macroScorecard.pop();const snapshot={provider:'Yahoo Finance / Python',fetchedAt:new Date().toISOString(),data:before.state.data,fx:{KRW:1,USD:1400,JPY:9.5},quotes:Object.fromEntries(companies.map(c=>[c.symbol,{price:1000,time:Date.now()/1000,currency:c.currency}]))};
 const response=await worker.fetch(request('run',await approvedInput('run',{research:raw,marketSnapshot:snapshot,expectedRevision:before.revision})),{AUTH_PROVIDER:'sites',DB:db,CLAUDE_REVIEW_PUBLIC_KEY:publicReviewKey});assert.equal(response.status,422);const result=await response.json();assert.equal(result.status,'researchIncomplete');assert.ok(result.researchReadiness.missing.some(m=>m.field==='liquidity'));
 const after=await account.readAccount(db);assert.equal(after.revision,before.revision);assert.equal(after.metadata.lastSlot,null);assert.equal(after.metadata.runCount,0);assert.equal((await account.recentRuns(db)).length,0);
});

test('compatibility run rejects a signed stale account revision before reusing or executing a slot',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-08T23:20:00Z')});
 const db=database(),before=await account.readAccount(db);
 const input=await approvedInput('run',{expectedRevision:before.revision});
 const saved=await account.writeAccount(db,before,before.state,{...before.metadata,lastSlot:account.slotFor(Date.now()),lastRun:new Date().toISOString()});
 const response=await worker.fetch(request('run',input),{AUTH_PROVIDER:'sites',DB:db,CLAUDE_REVIEW_PUBLIC_KEY:publicReviewKey});
 assert.equal(response.status,409);
 const after=await account.readAccount(db);assert.equal(after.revision,saved.revision);assert.deepEqual(after.state,saved.state);
});

test('independent ETF API persists future-session orders, respects pause and revisions, and leaves stock research gates intact',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-08T23:20:00Z')});
 const db=database(),initial=await account.readAccount(db);initial.state.mode='live';initial.state.plans=[];initial.state.trades=[];initial.state.holdings=[];
 let saved=await account.writeAccount(db,initial,initial.state),now=Date.now(),stamp=Math.floor(now/1000),bar={time:stamp,open:100000,close:100000,high:100000,low:100000,volume:100000};
 const snapshot={symbol:'153130',currency:'KRW',fx:{rate:1,time:stamp},provider:'Yahoo Finance / Python',fetchedAt:new Date(now).toISOString(),quote:{price:100000,time:stamp,regularSessions:[]},bars:Array.from({length:21},(_,i)=>({...bar,time:stamp-(20-i)*86400})),sources:[{url:'https://finance.yahoo.com/quote/153130.KS/history/'}]};
 let response=await worker.fetch(request('allocation',await approvedInput('allocation',{snapshots:[snapshot],expectedRevision:saved.revision})),{AUTH_PROVIDER:'sites',DB:db,CLAUDE_REVIEW_PUBLIC_KEY:publicReviewKey});assert.equal(response.status,200);const result=await response.json();assert.equal(result.summary[0].status,'orderApproved');
 const after=await account.readAccount(db);assert.equal(after.state.cash,100000000);assert.equal(after.state.holdings.length,0);assert.equal(after.state.assetAllocation.positions['153130'].trades.length,0);assert.equal(after.metadata.lastSlot,null);assert.equal(account.researchCheck(after.state).complete,false);
 response=await worker.fetch(request('allocation',{snapshots:[snapshot],expectedRevision:saved.revision}),{AUTH_PROVIDER:'sites',DB:db});assert.equal(response.status,409);
 saved=await account.writeAccount(db,after,after.state,{...after.metadata,paused:true});response=await worker.fetch(request('allocation',{snapshots:[snapshot],expectedRevision:saved.revision}),{AUTH_PROVIDER:'sites',DB:db});assert.equal((await response.json()).paused,true);assert.equal((await account.readAccount(db)).revision,saved.revision);
});
test('initial API account uses v5 no-idea watch readiness without saving its account',async()=>{
 const db=database(),before=await account.readAccount(db),raw=currentResearch();raw.investmentIdeas=[];raw.trendUnits=[];raw.departmentResearch={};raw.macroScorecard=[];
 const response=await worker.fetch(request('research-check',{research:raw}),{AUTH_PROVIDER:'sites',DB:db}),result=await response.json();
 assert.equal(response.status,200);assert.equal(result.complete,true);assert.equal(result.stages.ideas,'watch');
 const after=await account.readAccount(db);assert.equal(after.revision,before.revision);assert.deepEqual(after.metadata,before.metadata);assert.deepEqual(after.state.plans,before.state.plans);
});
import {enableRegularExecution,stampDecision} from '../web/execution.mjs';
import {nominationsFor,committeeReviewPanel} from '../web/committee-view.mjs';
test('read migration refreshes display evidence while preserving legacy orders, balances and revision',async()=>{
 const db=database(),a=await account.readAccount(db);a.state.mode='live';a.state.investmentProcessVersion=4;a.state.externalResearch=account.cleanResearch(research());
 const r=a.state.analysis.reports.find(r=>r.symbol==='005930');Object.assign(r,{candidateDepartments:['technical','fundamental'],unitReady:true,managementStatus:'편입안'});
 a.state.plans=[{id:'old',symbol:'005930',side:'buy',status:'승인',date:a.state.date,qty:1,reference:1000,stop:950,target:1100,strategy:'S01',riskReview:{status:'approved',checks:[]}}];
 const saved=await account.writeAccount(db,a,a.state),before=db.prepare('SELECT state FROM paper_account WHERE id=?').bind('main');const persisted=(await before.first()).state;
 const read=await account.readAccount(db),report=read.state.analysis.reports.find(r=>r.symbol==='005930');
 assert.equal(report.unitReady,false);assert.notEqual(report.managementStatus,'편입안');assert.deepEqual(nominationsFor(read.state,report),[]);
 const html=committeeReviewPanel(read.state,'005930',{esc:String,badge:String});assert.match(html,/과거 심사.*재검토/);assert.match(html,/과거 검토 · 원본 컨셉 미연결/);assert.match(html,/과거 운용 판단/);
 assert.equal(read.revision,saved.revision);assert.equal(read.state.cash,saved.state.cash);assert.deepEqual(read.state.plans,saved.state.plans);assert.equal((await before.first()).state,persisted);
});


test('legacy risk orders migrate without replaying the risk condition or mutating persisted balances',async()=>{
 const db=database(),a=await account.readAccount(db),now=Date.parse('2026-10-08T00:20:00Z'),symbol='005930';
 a.state.mode='live';a.state.plans=[];a.state.trades=[];a.state.holdings=[{symbol,direction:'long',qty:1,entry:100000,cost:100000,stop:50000,target:200000,date:'2026-10-01',strategy:'S01',lastCheckedQuoteTime:now/1000-1}];
 enableRegularExecution(a.state,now-86400000);
 const base={symbol,side:'sell',qty:1,reference:100000,stop:50000,target:200000,strategy:'S01',status:'승인',date:'2026-10-07',signalTimestamp:now/1000-86400};
 const reasons=['사전 승인 손절 · 정규장 청산 대기','사전 승인 목표가 · 정규장 청산 대기','증거금 부족: 다음 정규장 가격에서 숏 상환','유닛 손실 한도 전액 도달','유닛 목표수익 도달','유닛 투자기한 도래','유닛 손실 한도 50% 도달: 절반 축소'];
 a.state.plans=reasons.map((reason,i)=>{const p={...base,id:'risk-'+i,reason,...(i>=3?{unitExit:true}:{})};stampDecision(p,now-86400000);return p;});
 a.state.plans.push({...a.state.plans[0],id:'explicit-discretionary',riskExit:false},{...a.state.plans[0],id:'manual',reason:'사용자 청산 요청'},{...a.state.plans[3],id:'thesis',reason:'유닛 투자논리 훼손: 공시 근거'});
 const pending=symbol=>({symbol,side:'sell',qty:1,reference:50,status:'승인',eligibleAfter:now/1000-86400,signalTimestamp:now/1000-86400});
 a.state.assetAllocation={version:1,positions:{JEPQ:{symbol:'JEPQ',assetClass:'equity',qty:1,cost:70000,quote:{price:50},fx:{rate:1400},trades:[],distributions:[],pending:pending('JEPQ')},SGOV:{symbol:'SGOV',assetClass:'bond',qty:1,cost:70000,quote:{price:50},fx:{rate:1400},trades:[],distributions:[],pending:pending('SGOV')}}};
 const saved=await account.writeAccount(db,a,a.state),persisted=(await db.prepare('SELECT state FROM paper_account WHERE id=?').bind('main').first()).state;
 const read=await account.readAccount(db);assert.equal(read.revision,saved.revision);assert.equal(read.state.cash,saved.state.cash);
 for(const p of read.state.plans.slice(0,reasons.length))assert.equal(p.riskExit,true,p.reason);
 assert.equal(read.state.plans.find(p=>p.id==='explicit-discretionary').riskExit,false);
 for(const id of ['manual','thesis'])assert.equal(read.state.plans.find(p=>p.id===id).riskExit,undefined);
 assert.equal(read.state.assetAllocation.positions.JEPQ.pending.riskExit,true);assert.equal(read.state.assetAllocation.positions.SGOV.pending.riskExit,undefined);
 assert.equal((await db.prepare('SELECT state FROM paper_account WHERE id=?').bind('main').first()).state,persisted);
 read.state.plans=read.state.plans.filter(p=>['risk-0','manual'].includes(p.id));
 const open=now/1000-1200,quotes=Object.fromEntries(Object.keys(read.state.data).map(key=>[key,{price:key===symbol?100000:read.state.data[key].at(-1).close,time:now/1000,regularSessions:[{date:'2026-10-08',openTime:open,closeTime:open+23400,open:key===symbol?100000:read.state.data[key].at(-1).close,close:null,complete:false}]}]));
 advance(read.state,{quotes,date:'2026-10-08',now,riskOnly:true});
 assert.equal(read.state.holdings.length,0);assert.equal(read.state.trades[0].side,'sell');assert.equal(read.state.trades[0].executionBasis,'regularOpen');assert.equal(read.state.plans.find(p=>p.id==='manual').status,'승인');
});
test('only the owner can add or remove a must-review stock, with the current revision',async()=>{
 const db=database(),env={AUTH_PROVIDER:'sites',DB:db};
 const call=(method,body,owner=true)=>worker.fetch(new Request('https://example.com/api/manual-candidates',{method,headers:{'content-type':'application/json',...(owner?{'oai-authenticated-user-id':'owner'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
 let response=await call('GET');assert.equal(response.status,200);const {revision}=await response.json();
 assert.equal((await call('POST',{symbol:'035420',expectedRevision:revision},false)).status,403);
 assert.equal((await call('POST',{symbol:'035420',expectedRevision:revision+1})).status,409);
 response=await call('POST',{symbol:'NOTREAL',expectedRevision:revision});assert.equal(response.status,400);assert.match((await response.json()).error,/종목코드만/);
 response=await call('POST',{symbol:'035420',note:'메모',expectedRevision:revision});assert.equal(response.status,200);
 const added=await response.json();assert.deepEqual(added.manualCandidates.map(m=>m.symbol),['035420']);
 response=await call('DELETE',{symbol:'035420',expectedRevision:added.revision});assert.equal(response.status,200);assert.deepEqual((await response.json()).manualCandidates,[]);
});
