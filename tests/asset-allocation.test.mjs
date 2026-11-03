import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,equity,exposure,validateState,risk} from '../web/engine.mjs';
import {allocateAssets,validateAssetSnapshot,BOND_ASSET,ETF_ASSETS,assetValue,allocationDecision} from '../web/asset-allocation.mjs';
import {readAccount,context} from '../worker/account.mjs';
import {enableRegularExecution} from '../web/execution.mjs';

const start=Date.parse('2026-10-06T10:00:00+09:00');
// Orders approved after the open fill at the next day's open (v4), so the fill clock is the following morning.
const fill=Date.parse('2026-10-07T09:20:00+09:00'),fillOpen=Date.parse('2026-10-07T09:00:00+09:00')/1000;
function snapshot(now=start,price=100000){
 const day=new Date(now+9*3600000).toISOString().slice(0,10);
 const open=Date.parse(day+'T09:00:00+09:00')/1000,close=Date.parse(day+'T15:30:00+09:00')/1000;
 return {symbol:'153130',provider:'Yahoo Finance / Python',fetchedAt:new Date(now).toISOString(),currency:'KRW',fx:{rate:1,time:now/1000},quote:{price,time:now/1000,regularSessions:[{date:day,open:price,close:now/1000>=close?price:null,openTime:open,closeTime:close,complete:now/1000>=close}]},bars:Array.from({length:21},(_,i)=>({time:open-(20-i)*86400,open:price,high:price,low:price,close:price,volume:100000})),sources:[{title:'ETF',url:'https://finance.yahoo.com/quote/153130.KS/history/'}]};
}
function state(){const s=createState();s.mode='live';s.plans=[];s.trades=[];enableRegularExecution(s,start-86400000);return s}
function run(s,raw,now=start,reserved=0){return allocateAssets(s,validateAssetSnapshot(raw,now),now,exposure(s),reserved)}

test('cash receives an approved bond order without stock research and cannot fill before a later regular open',()=>{
 const s=state(),first=run(s,snapshot());assert.equal(first.status,'orderApproved');assert.equal(s.cash,100000000);assert.equal(s.assetAllocation.positions['153130'].qty,0);assert.equal(s.assetAllocation.positions['153130'].pending.side,'buy');assert.ok(s.assetAllocation.positions['153130'].pending.qty>0);assert.ok(s.assetAllocation.positions['153130'].pending.qty<=600);
 const close=Date.parse('2026-10-06T16:00:00+09:00');run(s,snapshot(close),close);assert.equal(s.assetAllocation.positions['153130'].qty,0);
 run(s,snapshot(fill),fill);
 assert.ok(s.assetAllocation.positions['153130'].qty>0);assert.ok(s.cash>=10000000);assert.equal(s.assetAllocation.positions['153130'].trades.length,1);assert.equal(s.assetAllocation.positions['153130'].trades[0].executionBasis,'regularOpen');assert.equal(s.assetAllocation.positions['153130'].trades[0].executionTime,fillOpen);
 assert.ok(Math.abs(equity(s)-(s.cash+s.assetAllocation.positions['153130'].qty*100000))<1);assert.ok(exposure(s).assetGrossRatio<=1);
 const saved=structuredClone(s);run(s,snapshot(close),close);assert.equal(s.assetAllocation.positions['153130'].trades.length,1);assert.equal(s.cash,saved.cash);validateState(s);
});

test('bond orders preserve stock commitments and margin cash and cannot buy with stale, foreign or invented data',()=>{
 const s=state();run(s,snapshot(),start,40000000);assert.ok(s.assetAllocation.positions['153130'].pending.qty*100000*1.001*1.00015<=36000000);
 for(const change of [x=>x.fetchedAt=new Date(start-31*60000).toISOString(),x=>x.symbol='UNKNOWN',x=>x.currency='USD',x=>x.provider='demo',x=>x.quote.price=-1,x=>x.quote.regularSessions[0].close=100000,x=>x.bars.at(-1).open=99999]){
  const raw=snapshot();change(raw);assert.throws(()=>validateAssetSnapshot(raw,start));
 }
 const low=snapshot();low.bars.forEach(b=>b.volume=1);const other=state();assert.equal(run(other,low).status,'liquidityLimited');assert.equal(other.assetAllocation.positions['153130'].pending,null);
});

test('bond allocation is separate from equity holdings but included in total capital, gross limits and corruption checks',()=>{
 const s=state();run(s,snapshot());run(s,snapshot(fill),fill);
 const before=equity(s),qty=s.assetAllocation.positions['153130'].qty;s.assetAllocation.positions['153130'].quote.price=101000;assert.equal(equity(s),before+qty*1000);
 const p={id:'entry',symbol:'005930',side:'buy',qty:800,reference:100000,stop:99000,target:110000,strategy:'S01'};
 const r=risk(s,p,100000);assert.ok(r.checks.some(([name,pass])=>name==='총노출 100% 이하'&&!pass));
 for(const change of [x=>x.qty=-1,x=>x.cost=-10,x=>x.symbol='OTHER',x=>x.quote.price=NaN,x=>x.pending={side:'buy',qty:1,reference:1}]){const copy=structuredClone(s);change(copy.assetAllocation.positions['153130']);assert.throws(()=>validateState(copy));}
 assert.equal(BOND_ASSET.currency,'KRW');assert.equal(s.holdings.length,0);
});

test('a funding need queues a bond sale and releases cash only at a subsequent regular open',()=>{
 const s=state();run(s,snapshot());run(s,snapshot(fill),fill);
 const cash=s.cash;run(s,snapshot(fill),fill,60000000);assert.equal(s.assetAllocation.positions['153130'].pending.side,'sell');assert.equal(s.cash,cash);
 const next=Date.parse('2026-10-08T10:00:00+09:00'),raw=snapshot(next);
 run(s,raw,next,60000000);assert.ok(s.cash>cash);assert.equal(s.assetAllocation.positions['153130'].trades[0].side,'sell');assert.equal(s.assetAllocation.positions['153130'].trades[0].executionBasis,'regularOpen');validateState(s);
});


test('US and Japanese bond ETFs use actual FX, exchange sessions and lot size without inventing cash distributions',()=>{
 const s=state(),inputs=ETF_ASSETS.slice(0,3).map(asset=>{
  const now=Date.parse(asset.country==='미국'?'2026-10-06T10:00:00-04:00':'2026-10-06T10:00:00+09:00');
  const raw=snapshot(now,asset.currency==='KRW'?100000:100),open=Date.parse(asset.country==='미국'?'2026-10-06T09:30:00-04:00':'2026-10-06T09:00:00+09:00')/1000,close=Date.parse(asset.country==='미국'?'2026-10-06T16:00:00-04:00':'2026-10-06T15:30:00+09:00')/1000;
  raw.symbol=asset.symbol;raw.currency=asset.currency;raw.fx={rate:asset.currency==='KRW'?1:asset.currency==='USD'?1400:10,time:now/1000,source:asset.currency==='KRW'?null:`https://finance.yahoo.com/quote/${asset.currency==='USD'?'KRW=X':'JPYKRW=X'}/`};
  raw.bars.forEach((b,i)=>b.time=open-(20-i)*86400);raw.quote.regularSessions=[{date:'2026-10-06',open:raw.quote.price,close:null,openTime:open,closeTime:close,complete:false}];raw.sources=[{url:`https://finance.yahoo.com/quote/${asset.yahooSymbol}/history/`}];
  run(s,raw,now);const a=s.assetAllocation.positions[asset.symbol];assert.ok(a.pending.qty>0);assert.equal(a.pending.qty%asset.lot,0);
  const later=(open+86400)*1000+1200000;raw.fetchedAt=new Date(later).toISOString();raw.quote.time=later/1000;raw.quote.regularSessions=[{date:'2026-10-07',open:raw.quote.price,close:null,openTime:open+86400,closeTime:close+86400,complete:false}];raw.bars.push({...raw.bars.at(-1),time:open+86400});raw.fx.time=later/1000;run(s,raw,later);
  assert.ok(a.qty>0);assert.equal(a.trades.length,1);assert.equal(a.trades[0].executionBasis,'regularOpen');return {asset,raw,later};
 });
 assert.equal(Object.keys(s.assetAllocation.positions).length,3);assert.ok(s.cash>=9000000);assert.ok(exposure(s).grossRatio<=1);assert.equal(equity(s),s.cash+assetValue(s));validateState(s);
 const {asset,raw,later}=inputs[1],a=s.assetAllocation.positions[asset.symbol],cash=s.cash;
 raw.dividends=[{time:later/1000+1,amount:1}];raw.fetchedAt=new Date(later+10000).toISOString();run(s,raw,later+10000);assert.equal(s.cash,cash);assert.equal(a.distributions[0].amount,a.qty);assert.ok(exposure(s).receivables>0);
});


test('medium-duration and credit candidates require sourced allocation, enforce caps and queue losses for a future open',()=>{
 const s=state(),raw=snapshot();raw.symbol='114260';raw.sources=[{url:'https://finance.yahoo.com/quote/114260.KS/history/'}];
 run(s,raw);assert.equal(s.assetAllocation.positions['114260'].pending,null);
 const decision={asOf:new Date(start).toISOString(),weights:{'114260':.2},reason:'금리 경로와 국고채3년 가격 추세 검토',risks:'금리 상승 시 가격 손실',sourceUrls:[ETF_ASSETS.find(a=>a.symbol==='114260').source]};
 s.assetAllocation.decision=allocationDecision(decision,start);run(s,raw);assert.equal(s.assetAllocation.positions['114260'].pending.side,'buy');
 for(const bad of [{...decision,weights:{'114260':.21}},{...decision,weights:{HYG:.11}},{...decision,weights:{IEF:.2,TLT:.2,LQD:.2}},{...decision,sourceUrls:['javascript:alert(1)']},{...decision,asOf:new Date(start-37*3600000).toISOString()}])assert.throws(()=>allocationDecision(bad,start));
 const closed=snapshot(fill);closed.symbol=raw.symbol;closed.sources=raw.sources;run(s,closed,fill);const a=s.assetAllocation.positions['114260'];assert.ok(a.qty>0);
 const loss=snapshot(fill,80000);loss.symbol=raw.symbol;loss.sources=raw.sources;run(s,loss,fill);assert.equal(a.pending.side,'sell');assert.ok(a.riskExitAt);const cash=s.cash;run(s,loss,fill);assert.equal(s.cash,cash);validateState(s);
 const capped=state();capped.assetAllocation={version:1,positions:{},decision:allocationDecision({...decision,weights:{HYG:.1}},start)};const income=snapshot(start,50);income.symbol='HYG';income.currency='USD';income.fx={rate:1400,time:start/1000,source:'https://finance.yahoo.com/quote/KRW=X/'};income.sources=[{url:'https://finance.yahoo.com/quote/HYG/history/'}];income.quote.regularSessions=[];
 run(capped,income);assert.ok(capped.assetAllocation.positions.HYG.pending.qty>0);assert.ok(capped.assetAllocation.positions.HYG.pending.qty*50*1400<=10000000);const q=capped.assetAllocation.positions.HYG;q.qty=10;q.cost=700000;assert.equal(exposure(capped).bonds,700000);assert.equal(exposure(capped).equityEtfs,0);validateState(capped);
});


test('bond-only candidates reject excluded weights and preserve legacy holdings until a later verified open',async()=>{
 const decision={asOf:new Date(start).toISOString(),weights:{JEPQ:.05},reason:'이전 배분',risks:'기존 위험',sourceUrls:['https://finance.yahoo.com/quote/JEPQ/']};
 for(const symbol of ['TLTW','JEPI','JEPQ'])assert.throws(()=>allocationDecision({...decision,weights:{[symbol]:.01}},start));
 const s=state();s.assetAllocation={version:1,positions:{JEPQ:{symbol:'JEPQ',assetClass:'equity',qty:60,cost:4200000,pending:{symbol:'JEPQ',side:'buy',qty:1,reference:50,eligibleAfter:start/1000,signalTimestamp:start/1000,status:'승인'},quote:{price:50},fx:{rate:1400},trades:[{symbol:'JEPQ',side:'buy',qty:60,price:70000,nativePrice:50,fxRate:1400,fee:0,executionTime:start/1000-86400,pnl:null}],distributions:[{id:'old',amount:6,time:start/1000-10}]}},decision};s.cash-=4200000;
 const row={state:JSON.stringify(s),metadata:JSON.stringify({intervalHours:4}),revision:1};
 const db={prepare:()=>({bind:()=>({first:async()=>row,run:()=>assert.fail('GET must not write')})})};
 const account=await readAccount(db,false),loaded=account.state,a=loaded.assetAllocation.positions.JEPQ;
 const ctx=context(account);assert.equal(ctx.assetAllocation.assets.length,10);assert.ok(ctx.assetAllocation.assets.every(x=>x.assetClass==='bond'));assert.deepEqual(ctx.assetAllocation.retiringAssets.map(x=>x.symbol),['JEPQ']);
 assert.equal(a.qty,60);assert.equal(loaded.cash,s.cash);assert.equal(a.pending,null);assert.deepEqual(a.trades,s.assetAllocation.positions.JEPQ.trades);assert.deepEqual(a.distributions,s.assetAllocation.positions.JEPQ.distributions);assert.equal(loaded.assetAllocation.decision.weights.JEPQ,0);assert.equal(exposure(loaded).equityEtfs,4200000);
 const now=Date.parse('2026-10-06T12:00:00-04:00');enableRegularExecution(loaded,start,'open');
 function usRaw(at,date){const x=snapshot(at,50),open=Date.parse(date+'T09:30:00-04:00')/1000;x.symbol='JEPQ';x.currency='USD';x.fx={rate:1400,time:at/1000,source:'https://finance.yahoo.com/quote/KRW=X/'};x.sources=[{url:'https://finance.yahoo.com/quote/JEPQ/history/'}];x.bars.forEach((b,i)=>b.time=open-(20-i)*86400);x.quote.regularSessions=[{date,open:50,close:null,openTime:open,closeTime:open+23400,complete:false}];return x;}
 const phase={phase:'open',date:'2026-10-06'};allocateAssets(loaded,validateAssetSnapshot(usRaw(now,phase.date),now),now,exposure(loaded),0,phase);assert.equal(a.pending.side,'sell');assert.equal(a.pending.qty,60);
 allocateAssets(loaded,validateAssetSnapshot(usRaw(now,phase.date),now),now,exposure(loaded),0,phase);assert.equal(a.qty,60);assert.equal(loaded.cash,s.cash);
 const next=Date.parse('2026-10-07T10:00:00-04:00');allocateAssets(loaded,validateAssetSnapshot(usRaw(next,'2026-10-07'),next),next,exposure(loaded),0,{phase:'open',date:'2026-10-07'});
 assert.equal(a.qty,0);assert.equal(a.trades.length,2);assert.equal(a.trades[0].side,'sell');assert.equal(a.trades[0].executionBasis,'regularOpen');assert.ok(loaded.cash>s.cash);validateState(loaded);
});

test('an approved bond buy expires after five days without an approved close; sells never expire; the next approved pre-market re-approves',async()=>{
 const {PENDING_BUY_TTL}=await import('../web/asset-allocation.mjs');
 assert.equal(PENDING_BUY_TTL,5*86400000);
 const held={approved:false,reason:'logicPending'};
 const pass=(s,now,review)=>allocateAssets(s,validateAssetSnapshot(snapshot(now),now),now,exposure(s),0,null,review);
 const s=state();run(s,snapshot());
 const p=s.assetAllocation.positions['153130'];assert.equal(p.pending.side,'buy');assert.equal(p.pending.approvedAt,new Date(start).toISOString());
 const day4=start+4*86400000,day6=start+6*86400000;
 pass(s,day4,held);assert.equal(p.pending?.side,'buy','four days without an approved close keeps the order');
 pass(s,day6,held);assert.equal(p.pending,null);assert.match(s.events[0].text,/KODEX 단기채권 매수 \d+주 승인 만료 · 5일 내 미체결/);assert.equal(p.qty,0);
 // The next approved pre-market pass approves a fresh order instead of leaving the target unfilled.
 assert.equal(pass(s,day6+3600000,{approved:true}).status,'orderApproved');assert.equal(p.pending.side,'buy');assert.equal(p.pending.approvedAt,new Date(day6+3600000).toISOString());
 // A pending sell older than the limit is untouched (risk exits are exempt).
 const t=state();run(t,snapshot());run(t,snapshot(fill),fill);const close=Date.parse('2026-10-07T15:30:00+09:00');
 const q=t.assetAllocation.positions['153130'];assert.ok(q.qty>0);
 q.pending={id:'A9',symbol:'153130',side:'sell',qty:q.qty,reference:100000,status:'승인',signalTimestamp:close/1000,approvedAt:new Date(close).toISOString(),eligibleAfter:close/1000};
 pass(t,close+10*86400000,held);assert.equal(q.pending?.side,'sell');assert.ok(!t.events.some(e=>/승인 만료/.test(e.text)));
});

test('bond ETFs together stay within 50% of capital: default weights scale down and an overweight holding queues a sale',()=>{
 const s=state();run(s,snapshot());const p=s.assetAllocation.positions['153130'].pending;
 assert.equal(p.side,'buy');assert.ok(p.qty*100000<=equity(s)*.5*.6/.9+1);
 const over=state();run(over,snapshot());run(over,snapshot(fill),fill);
 const a=over.assetAllocation.positions['153130'];a.qty=900;a.cost=90000000;over.cash=10000000;
 const next=Date.parse('2026-10-08T10:00:00+09:00');run(over,snapshot(next),next);
 assert.equal(a.pending.side,'sell');assert.equal(a.pending.riskExit,false);assert.ok(a.qty-a.pending.qty<=equity(over)*.5*.6/.9/100000+1);
 const full=state();full.assetAllocation={version:1,positions:{SGOV:{symbol:'SGOV',assetClass:'bond',qty:357,cost:49980000,quote:{price:100},fx:{rate:1400},trades:[],distributions:[],pending:null}}};full.cash=50020000;
 run(full,snapshot());assert.equal(full.assetAllocation.positions['153130'].pending,null);
});
