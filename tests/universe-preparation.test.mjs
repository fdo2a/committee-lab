import test from 'node:test';
import assert from 'node:assert/strict';
import * as account from '../worker/account.mjs';
import {createState,companies,validateState} from '../web/engine.mjs';
import {EXPANDED_SYMBOLS} from '../web/universe.mjs';
import {validateMarket} from '../worker/market-data.mjs';

function expandedSnapshot(s){
 const data=Object.fromEntries(companies.filter(c=>EXPANDED_SYMBOLS.includes(c.symbol)).map(c=>[c.symbol,structuredClone(s.data[c.symbol]??s.data['005930'])]));
 return {provider:'Yahoo Finance / Python',fetchedAt:new Date().toISOString(),data,fx:{KRW:1,USD:1400,JPY:9.5},quotes:Object.fromEntries(companies.filter(c=>EXPANDED_SYMBOLS.includes(c.symbol)).map(c=>[c.symbol,{price:data[c.symbol].at(-1).close,time:Date.now()/1000,currency:c.currency}]))};
}
test('verified expanded prices activate36 without executing, approving, or consuming a run slot',()=>{
 assert.equal(EXPANDED_SYMBOLS.length,36);
 const s=createState();s.mode='live';s.executionPolicy={version:1,buy:'regularClose',sell:'regularOpen',activatedAt:new Date().toISOString()};
 s.plans=[];s.trades=[];s.holdings=[];
 const current={state:s,revision:4,metadata:{runCount:7,lastSlot:100,lastRun:'2026-10-05T03:00:00Z'}};
 const preserved=JSON.stringify({cash:s.cash,holdings:s.holdings,trades:s.trades,history:s.history,metadata:current.metadata,executionPolicy:s.executionPolicy});
 assert.equal(typeof account.prepareUniverse,'function');
 account.prepareUniverse(current,validateMarket(expandedSnapshot(s)),{},null);
 assert.equal(current.state.universeVersion,'indexCatalog');assert.equal(Object.keys(current.state.data).length,36);validateState(current.state);
 assert.equal(JSON.stringify({cash:s.cash,holdings:s.holdings,trades:s.trades,history:s.history,metadata:current.metadata,executionPolicy:s.executionPolicy}),preserved);
 assert.ok(!s.plans.some(p=>p.status==='승인'));assert.equal(s.analysis.researchReadiness.complete,false);
 assert.equal(s.fundamentals.AOS.pass,false);
});
test('incomplete expansion cannot replace legacy prices or alter account records',()=>{
 const current={state:createState(),metadata:{runCount:7,lastSlot:100}},before=JSON.stringify(current);
 const raw=expandedSnapshot(current.state);delete raw.data.AOS;raw.activeSymbols=EXPANDED_SYMBOLS;
 assert.throws(()=>account.prepareUniverse(current,raw,{},null));
 assert.equal(JSON.stringify(current),before);
});
test('changing a selection cannot drop a previously approved order',()=>{
 const current={state:createState(),metadata:{runCount:7,lastSlot:100}};
 current.state.plans=[{symbol:'NVDA',status:'승인'}];
 const raw=expandedSnapshot(current.state);delete raw.data.NVDA;delete raw.quotes.NVDA;
 const before=JSON.stringify(current);
 assert.throws(()=>account.prepareUniverse(current,raw,{},null),/승인 주문/);
 assert.equal(JSON.stringify(current),before);
});

test('stored annual fundamentals survive a run that did not re-read them or got a Yahoo miss, and stay valid 30 days',()=>{
 const s=createState();s.mode='live';s.executionPolicy={version:1,buy:'regularClose',sell:'regularOpen',activatedAt:new Date().toISOString()};
 s.plans=[];s.trades=[];s.holdings=[];
 const current={state:s,revision:4,metadata:{runCount:7,lastSlot:100,lastRun:'2026-10-05T03:00:00Z'}};
 const now=Date.now(),fetchedAt=new Date(now).toISOString();
 const collected={status:'collected',periodEnd:'2025-12-31',periodType:'12M',currency:'KRW',fetchedAt,sources:[{title:'005930 Yahoo 연간 재무',url:'https://finance.yahoo.com/quote/005930.KS/financials/'}],
  metrics:{revenue:300,priorRevenue:280,netIncome:40,operatingCashFlow:80,freeCashFlow:50,equity:400,debt:50,eps:6000}};
 account.prepareUniverse(current,validateMarket(expandedSnapshot(s)),{'005930':collected},null,now);
 const first=current.state.fundamentals['005930'];
 assert.equal(first.numericPass,true);assert.equal(first.checks[0].name,'재무 수집 30일 이내');
 // Next run: 005930 was read within the week (absent) and 000660 failed at Yahoo; both keep what the server stored.
 current.state.fundamentals['000660']=structuredClone(first);
 account.prepareUniverse(current,validateMarket(expandedSnapshot(s)),{'000660':{status:'unavailable',sources:[]}},null,now+10*86400000);
 for(const symbol of ['005930','000660']){const f=current.state.fundamentals[symbol];assert.equal(f.numericPass,true,symbol);assert.equal(f.fetchedAt,fetchedAt);assert.equal(f.currency,'KRW');}
 account.prepareUniverse(current,validateMarket(expandedSnapshot(s)),{},null,now+31*86400000);
 assert.equal(current.state.fundamentals['005930'].numericPass,false);
 assert.equal(current.state.fundamentals['005930'].checks.find(c=>c.name==='재무 수집 30일 이내').pass,false);
 const ctx=account.context({state:current.state,revision:5,metadata:current.metadata});
 assert.equal(ctx.fundamentalsAsOf['005930'],fetchedAt);assert.equal(ctx.fundamentalsPolicy.recheckDays,7);
});
