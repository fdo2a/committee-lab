import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  readAccount,
  writeAccount,
  runScheduled,
  reviewPolicy,
  cleanResearch,
  slotFor,
  nextRun,
} from "../worker/account.mjs";
import { createState, advance, exposure } from "../web/engine.mjs";
import {enableRegularExecution,stampDecision} from '../web/execution.mjs';
import {allocateAssets} from '../web/asset-allocation.mjs';
import {readyState} from './fixtures.mjs';
function database() {
  const d = new DatabaseSync(":memory:");
  // Live states exceed the 1MB inline limit, so the parts table from 0003 must exist here too.
  for(const name of ['0000_new_millenium_guard.sql','0001_nifty_marrow.sql','0002_steady_ricochet.sql','0003_amused_patch.sql'])d.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  return {
    prepare(sql) {
      let args = [];
      const stmt = d.prepare(sql);
      return {
        bind(...a) {
          args = a;
          return this;
        },
        async first() {
          return stmt.get(...args);
        },
        async all(){return {results:stmt.all(...args)}} ,
        async run() {
          return { meta: { changes: Number(stmt.run(...args).changes) } };
        },
      };
    },
  };
}
for(const reason of ['사전 승인 손절 · 정규장 청산 대기','사전 승인 목표가 · 정규장 청산 대기','증거금 부족: 다음 정규장 가격에서 숏 상환','유닛 손실 한도 전액 도달','유닛 목표수익 도달','유닛 투자기한 도래','유닛 손실 한도 50% 도달: 절반 축소']){
 test(`stored legacy risk exit fills without a recurring trigger: ${reason}`,async()=>{
  const db=database(),a=await readAccount(db),s=a.state,now=Date.parse('2026-10-08T00:20:00Z'),symbol='005930',short=reason.startsWith('증거금'),unit=reason.startsWith('유닛'),qty=reason.includes('절반')?5:10;
  s.mode='live';s.plans=[];s.trades=[];enableRegularExecution(s,now-86400000);
  s.holdings=[{symbol,unitId:unit?'legacy-unit':undefined,direction:short?'short':'long',qty:10,entry:100000,cost:1000000,stop:short?200000:50000,target:short?50000:200000,date:s.date,strategy:'test',lastCheckedQuoteTime:now/1000,...(short?{borrowAccrued:0,borrowLastAt:now}:{})}];
  if(unit)s.trendUnits=[{id:'legacy-unit',status:'closing',capital:1000000,realizedPnl:0,lossLimit:.1,targetReturn:.1,expiresAt:'2026-12-01',reviewLog:[],lastQuoteTimes:{[symbol]:now/1000}}];
  const p={id:'legacy-exit',symbol,unitId:unit?'legacy-unit':undefined,qty,side:short?'cover':'sell',reference:100000,stop:s.holdings[0].stop,target:s.holdings[0].target,status:'승인',date:s.date,reason,unitExit:unit,signalTimestamp:now/1000-86400};stampDecision(p,now-86400000);s.plans=[p];
  await writeAccount(db,a,s);const loaded=await readAccount(db),exit=loaded.state.plans[0];
  assert.equal(exit.riskExit,true);assert.equal(exit.id,p.id);assert.equal(exit.eligibleAfter,p.eligibleAfter);assert.equal(exit.qty,qty);
  const quotes=Object.fromEntries(Object.keys(s.data).map(key=>[key,{price:key===symbol?100000:s.data[key].at(-1).close,time:now/1000,regularSessions:[{date:'2026-10-08',openTime:now/1000-1200,closeTime:now/1000+22200,open:key===symbol?100000:s.data[key].at(-1).close,close:null,complete:false}]}]));
  advance(loaded.state,{quotes,date:'2026-10-08',now,riskOnly:true});
  assert.equal(exit.status,'체결');assert.equal(loaded.state.trades.length,1);assert.equal(loaded.state.trades[0].qty,qty);assert.equal(loaded.state.trades[0].executionBasis,'regularOpen');
  await writeAccount(db,loaded,loaded.state);assert.equal((await readAccount(db)).state.plans[0].riskExit,true);
 });
}

test('legacy migration does not authorize discretionary exits, entries or unapproved risk exits',async()=>{
 const db=database(),a=await readAccount(db),base={symbol:'005930',qty:1,side:'sell',reference:100000,stop:50000,target:200000,status:'승인',date:a.state.date};
 const cases=[{reason:'사용자 청산 요청'},{unitExit:true,reason:'유닛 투자논리 훼손: 손절 검토'},{unitExit:true,reason:'알 수 없는 유닛 청산'},{reason:'사전 승인 손절 · 정규장 청산 대기',riskExit:false},{reason:'사전 승인 손절 · 정규장 청산 대기',status:'대기'},{reason:'사전 승인 손절 · 정규장 청산 대기',status:'보류'},{reason:'사전 승인 손절 · 정규장 청산 대기',side:'buy'}];
 a.state.plans=cases.map((p,i)=>({...base,id:'guard-'+i,...p}));await writeAccount(db,a,a.state);
 assert.deepEqual((await readAccount(db)).state.plans,a.state.plans);
});

test('legacy retired ETF exit is migrated and fills in risk-only execution',async()=>{
 const db=database(),a=await readAccount(db),s=a.state,now=Date.parse('2026-10-08T14:00:00Z'),symbol='JEPQ',open=now/1000-1800;
 s.mode='live';enableRegularExecution(s,now-86400000);
 const p={id:'legacy-etf',symbol,side:'sell',qty:10,reference:50,status:'승인',signalTimestamp:now/1000-86400};stampDecision(p,now-86400000);
 s.assetAllocation={version:1,positions:{[symbol]:{symbol,assetClass:'equity',qty:10,cost:700000,quote:{price:50},fx:{rate:1400},pending:p,trades:[],distributions:[]}}};
 await writeAccount(db,a,s);const loaded=await readAccount(db),position=loaded.state.assetAllocation.positions[symbol];assert.equal(position.pending.riskExit,true);assert.equal(position.pending.eligibleAfter,p.eligibleAfter);
 const snapshot={symbol,quote:{price:50,time:now/1000,regularSessions:[{date:'2026-10-08',openTime:open,closeTime:open+23400,open:50,close:null,complete:false}]},fx:{rate:1400,time:now/1000},bars:Array.from({length:61},(_,i)=>({time:open-(60-i)*86400,close:50,volume:100000})),dividends:[],sources:[]};
 allocateAssets(loaded.state,snapshot,now,exposure(loaded.state),0,{phase:'open',date:'2026-10-08'},{approved:false});
 assert.equal(position.qty,0);assert.equal(position.trades[0].qty,10);assert.equal(position.trades[0].executionBasis,'regularOpen');
});

test('server storage preserves a short liability in the existing shared account',async()=>{
 const db=database(),a=await readAccount(db),s=a.state,price=s.data['005930'].at(-1).close;
 s.cash+=price*(1-0.00015);s.holdings=[{symbol:'005930',direction:'short',qty:1,entry:price,cost:price*(1-0.00015),stop:price*1.04,target:price*.92,strategy:'SH21',date:s.date,borrowAccrued:0,borrowLastAt:Date.UTC(2026,9,4)}];
 await writeAccount(db,a,s);const read=await readAccount(db);assert.equal(read.state.holdings[0].direction,'short');assert.equal(read.state.cash,s.cash);assert.equal(read.state.holdings[0].borrowAccrued,0);
});
test("an unattended cycle approves eligible paper plans, fills, and persists results", async () => {
  const db = database(),
    before = await readAccount(db);
  before.state=readyState();await writeAccount(db,before,before.state);
  const after = await runScheduled(db, undefined, Date.UTC(2026, 9, 4, 7));
  assert.ok(after.summary.approved > 0);
  assert.ok(after.summary.newExecutions > 0);
  assert.equal(after.metadata.runCount, 1);
  const read = await readAccount(db);
  assert.equal(read.state.date, after.state.date);
  assert.equal(read.revision, after.revision);
  assert.equal(before.state.trades.length, 0);
});
test("same four-hour slot is idempotent even with simultaneous runners", async () => {
  const db = database();
  await readAccount(db);
  const [a, b] = await Promise.all([
    runScheduled(db, undefined, Date.UTC(2026, 9, 4, 7)),
    runScheduled(db, undefined, Date.UTC(2026, 9, 4, 7)),
  ]);
  assert.ok(a.reused || b.reused);
  const final = await readAccount(db);
  assert.equal(final.metadata.runCount, 1);
  assert.equal(final.state.day, 1);
  await runScheduled(db, undefined, Date.UTC(2026, 9, 4, 13));
  assert.equal((await readAccount(db)).metadata.runCount, 2);
});
test("pause prevents trades and a stale browser cannot overwrite a completed cycle", async () => {
  const db = database(),
    initial = await readAccount(db);
  const paused = await writeAccount(db, initial, initial.state, {
    ...initial.metadata,
    paused: true,
  });
  const result = await runScheduled(db, undefined, Date.UTC(2026, 9, 4, 7));
  assert.equal(result.paused, true);
  assert.equal(result.state.day, 0);
  await assert.rejects(
    () => writeAccount(db, initial, initial.state),
    (e) => e.status === 409,
  );
  assert.equal(paused.revision, (await readAccount(db)).revision);
});
test("review reduces risk after consecutive losses and never exceeds baseline", () => {
  const s = createState();
  s.trades = [
    { side: "sell", pnl: -100 },
    { side: "sell", pnl: -10 },
    { side: "sell", pnl: -20 },
  ];
  assert.equal(reviewPolicy(s).riskScale, 0.5);
  s.trades = Array.from({ length: 5 }, () => ({ side: "sell", pnl: 100 }));
  assert.equal(reviewPolicy(s).riskScale, 1);
});
test("research input retains top-down and bottom-up evidence and rejects unsafe source URLs", () => {
  const input = {
    asOf: "2026-10-04",
    topDown: "시장 국면",
    bottomUp: "기업 검토",
    decision: "관찰",
    limitations: "가격 API 미연결",
    sources: [{ title: "공시", url: "https://www.sec.gov/" }],
    screening: [
      {
        symbol: "AAPL",
        stance: "watch",
        topDownScore: 60,
        bottomUpScore: 70,
        reason: "추가 확인 필요",
      },
    ],
  };
  assert.equal(cleanResearch(input).screening[0].bottomUpScore, 70);
  assert.throws(() =>
    cleanResearch({
      ...input,
      sources: [{ title: "x", url: "javascript:alert(1)" }],
    }),
  );
  assert.throws(() =>
    cleanResearch({
      ...input,
      screening: [{ ...input.screening[0], topDownScore: 200 }],
    }),
  );
  assert.equal(
    slotFor(Date.UTC(2026, 9, 4, 8, 59)),
    slotFor(Date.UTC(2026, 9, 4, 7)),
  );
  assert.equal(nextRun(Date.UTC(2026, 9, 4, 7)), "2026-10-04T15:00:00.000Z");
});

test('four-hour slots use Seoul boundaries and permit the next slot without duplicate executions',async()=>{
 const before=Date.parse('2026-10-05T15:59:59+09:00'),after=Date.parse('2026-10-05T16:00:00+09:00');
 assert.equal(slotFor(after),slotFor(before)+1);
 assert.equal(nextRun(before),'2026-10-05T07:00:00.000Z');
 assert.equal(nextRun(after),'2026-10-05T11:00:00.000Z');
 const db=database();
 await runScheduled(db,undefined,before);
 assert.equal((await runScheduled(db,undefined,before)).reused,true);
 const result=await runScheduled(db,undefined,after);
 assert.equal(result.metadata.runCount,2);
});

test('changing from six to four hours maps the last actual run and preserves account history',async()=>{
 const db=database(),a=await readAccount(db);
 const lastRun='2026-10-04T16:10:00+09:00';
 await writeAccount(db,a,a.state,{...a.metadata,intervalHours:6,lastRun,lastSlot:Math.floor((Date.parse(lastRun)+9*3600000)/21600000),runCount:5});
 const migrated=await readAccount(db);
 assert.equal(migrated.metadata.lastSlot,slotFor(Date.parse(lastRun)));
 assert.equal(migrated.metadata.intervalHours,4);
 assert.equal(migrated.metadata.runCount,5);
 const reused=await runScheduled(db,undefined,Date.parse('2026-10-04T19:59:00+09:00'));
 assert.equal(reused.reused,true);
 assert.equal(reused.revision,migrated.revision);
 const next=await runScheduled(db,undefined,Date.parse('2026-10-04T20:00:00+09:00'));
 assert.equal(next.metadata.runCount,6);
});

test('screening uses only business and industry evidence; technical score changes independently',async()=>{
  const {analyze}=await import('../web/engine.mjs');
  const s=createState();s.mode='live';s.plans=[];
  s.externalResearch=cleanResearch({asOf:'2026-10-04',topDown:'산업 수요',bottomUp:'사업 경쟁력',decision:'관찰',limitations:'재무 검증 대기',sources:[{title:'IR',url:'https://www.apple.com/'}],screening:[{symbol:'AAPL',stance:'allow',topDownScore:80,bottomUpScore:60,reason:'제품 수요',topDownReason:'산업 수요 증가',bottomUpReason:'제품 경쟁력',fundamentalPass:false}]});
  analyze(s);const before=s.analysis.reports.find(x=>x.symbol==='AAPL');
  assert.equal(before.score,80);assert.equal(before.fundamentalPass,false);
  assert.equal(s.plans.some(x=>x.symbol==='AAPL'),false);
  for(const b of s.data.AAPL.slice(-20))for(const k of ['open','high','low','close'])b[k]*=2;
  analyze(s);const after=s.analysis.reports.find(x=>x.symbol==='AAPL');
  assert.equal(after.score,80);assert.notEqual(before.technicalScore,after.technicalScore);
});

test('live quotes never fill a signal at the same or older timestamp',async()=>{
  const {advance,equity,activeCompanies,fxOf}=await import('../web/engine.mjs');
  const s=createState();s.mode='live';s.plans=[];
  const quotes=Object.fromEntries(activeCompanies(s).map(c=>[c.symbol,{price:s.data[c.symbol].at(-1).close,time:1000,currency:c.currency}]));
  s.fx={KRW:1,USD:1500,JPY:10};s.marketData={quotes};
  const symbol='AAPL',p=quotes[symbol].price*fxOf(symbol,s);
  s.externalResearch={screening:[{symbol,stance:'allow',fundamentalPass:true}]};
  s.fundamentals={[symbol]:{pass:true}};
  s.plans=[{id:'P900',symbol,date:s.date,qty:1,stop:p*.95,target:p*1.1,reference:p,side:'buy',strategy:'test',status:'승인',signalTimestamp:1000}];
  advance(s,{quotes,date:s.date});assert.equal(s.trades.length,0);
  quotes[symbol]={...quotes[symbol],time:1001};
  advance(s,{quotes,date:s.date});assert.equal(s.trades.filter(x=>x.side==='buy').length,1);
  const h=s.holdings.find(x=>x.symbol===symbol);assert.ok(h);
  quotes[symbol]={...quotes[symbol],price:quotes[symbol].price*1.02};
  assert.equal(equity(s),s.cash+h.qty*quotes[symbol].price*1500);
});

test('invalid or stale price collection timestamps are rejected',async()=>{
  const {validateMarket}=await import('../worker/market-data.mjs');
  assert.throws(()=>validateMarket({provider:'Yahoo Finance / Python',fetchedAt:'invalid'}));
  assert.throws(()=>validateMarket({provider:'Yahoo Finance / Python',fetchedAt:new Date(Date.now()-31*60000).toISOString()}));
});

import {fundamentalReview} from '../worker/fundamentals.mjs';
import {learningReview} from '../worker/department-reviews.mjs';
import {coreCompanies as companies,analyze} from '../web/engine.mjs';
import {recentRuns} from '../worker/account.mjs';
const financeFixture=(currency,now)=>({periodEnd:'2026-03-31',periodType:'12M',currency,fetchedAt:new Date(now).toISOString(),sources:[{title:'재무 시험 자료',url:'https://finance.yahoo.com/quote/AAPL/financials/'}],metrics:{revenue:1000,priorRevenue:950,netIncome:100,operatingCashFlow:120,freeCashFlow:80,equity:1000,debt:300,eps:10}});
test('fundamentals reject missing figures, wrong currency, stale data and expensive EPS even when research says allow',()=>{
 const now=Date.UTC(2026,9,4,7),f=financeFixture('USD',now),q={price:100};
 assert.equal(fundamentalReview('AAPL',f,q,now).pass,true);
 for(const invalid of [{...f,currency:'JPY'},{...f,fetchedAt:'2026-09-01'},{...f,metrics:{...f.metrics,eps:null}},{...f,metrics:{...f.metrics,debt:5000}}])assert.equal(fundamentalReview('AAPL',invalid,q,now).pass,false);
 // Missing debt passes on its own; leverage above 4x and PER above 60x still fail.
 assert.equal(fundamentalReview('AAPL',{...f,metrics:{...f.metrics,debt:null}},q,now).pass,true);
 assert.equal(fundamentalReview('AAPL',{...f,metrics:{...f.metrics,debt:4000}},q,now).pass,true);
 assert.equal(fundamentalReview('AAPL',f,{price:600},now).pass,true);
 assert.equal(fundamentalReview('AAPL',f,{price:600.01},now).pass,false);
});
test('live cycle persists seven department outputs, overrides claimed approval with numeric validation, and is idempotent',async()=>{
 const db=database(),now=Date.UTC(2026,9,5,7),s=createState();
 const quotes=Object.fromEntries(companies.map(c=>[c.symbol,{price:100,time:1791090000,currency:c.currency}]));
 const snapshot={data:s.data,quotes,fx:{KRW:1,USD:1400,JPY:9.5},fetchedAt:new Date(now).toISOString(),provider:'test fixture',sources:[]};
 const research={asOf:new Date(now).toISOString(),topDown:'산업 조사 시험',bottomUp:'기업 검증 시험',decision:'조건 검사',limitations:'합성 시험 자료',sources:[{title:'IR fixture',url:'https://www.apple.com/'}],screening:[{symbol:'AAPL',stance:'allow',topDownScore:80,reason:'탑다운 근거',bottomUpReason:'사업 확인',bottomUpPass:true,fundamentalPass:true,sourceUrls:['https://www.apple.com/']}]};
 const result=await runScheduled(db,research,now,snapshot,{AAPL:{...financeFixture('USD',now),metrics:{...financeFixture('USD',now).metrics,eps:null}}});
 assert.equal(result.state.departments.length,7);assert.equal(result.state.externalResearch.screening[0].fundamentalPass,false);
 assert.equal(result.state.plans.some(p=>p.symbol==='AAPL'&&p.status==='승인'),false);
 assert.equal((await recentRuns(db))[0].status,'researchIncomplete');
 assert.equal(result.summary.researchReadiness.complete,false);
 const retry=await runScheduled(db,research,now,snapshot,{});
 assert.equal(retry.reused,true);assert.equal(retry.revision,result.revision);assert.equal((await recentRuns(db)).length,1);
});
test('strategy-specific losses disable new entries without increasing other position sizes',()=>{
 const s=createState(),id='S01';s.trades=[{side:'sell',strategy:id,pnl:-3},{side:'sell',strategy:id,pnl:-2},{side:'sell',strategy:id,pnl:-1}];
 const actual=learningReview(s);const keys=Object.keys(s.strategyLearning);const strategy=keys[0];
 s.trades=s.trades.map(t=>({...t,strategy}));const review=learningReview(s);
 assert.ok(review.disabled.includes(strategy));assert.equal(s.strategyLearning[strategy].scale,0);assert.ok(Object.values(s.strategyLearning).every(x=>x.scale<=1));
});

test('a pipeline upgrade does not rerun an already completed live slot',async()=>{
 const db=database(),now=Date.UTC(2026,9,5,7),a=await readAccount(db);
 a.state.mode='live';await writeAccount(db,a,a.state,{...a.metadata,lastSlot:slotFor(now),pipelineVersion:2,runCount:5});
 const before=await readAccount(db);
 const result=await runScheduled(db,undefined,now,{data:a.state.data});
 assert.equal(result.reused,true);assert.equal(result.revision,before.revision);assert.equal(result.metadata.runCount,5);
 assert.deepEqual(result.state.trades,before.state.trades);
});


test('growth valuation exception has exact gates and never replaces missing or stale financial checks',()=>{
 const now=Date.UTC(2026,9,6,0),f=financeFixture('USD',now);f.metrics={...f.metrics,revenue:1150,priorRevenue:1000,netIncome:100,equity:1000};
 assert.equal(fundamentalReview('AAPL',f,{price:800},now).pass,true);
 for(const bad of [{...f,metrics:{...f.metrics,revenue:1149.9}},{...f,metrics:{...f.metrics,netIncome:99.9}},{...f,metrics:{...f.metrics,operatingCashFlow:0}},{...f,fetchedAt:'2026-09-01'}])assert.equal(fundamentalReview('AAPL',bad,{price:700},now).pass,false);
 assert.equal(fundamentalReview('AAPL',f,{price:800.01},now).pass,false);
});
