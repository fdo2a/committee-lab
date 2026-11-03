import test from 'node:test';
import assert from 'node:assert/strict';
import {enableRegularExecution,regularExecution,stampDecision} from '../web/execution.mjs';
import {createState,exposure,coreCompanies} from '../web/engine.mjs';
import {allocateAssets} from '../web/asset-allocation.mjs';
import * as account from '../worker/account.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

test('JPX cash-market holiday excludes Japan without stopping Korea or consuming its pending orders',()=>{
 const now=Date.parse('2026-10-12T08:00:00Z'),session=account.sessionFor('asia','close',now);
 assert.deepEqual(session.countries,['한국']);
 assert.equal(session.closedCountries[0].country,'일본');
 assert.equal(session.closedCountries[0].reason,'exchangeHoliday');
 const s=createState();s.mode='live';s.plans=[];
 s.assetAllocation={version:1,positions:{'570A':{symbol:'570A',qty:0,cost:0,pending:{side:'buy'},trades:[],distributions:[],quote:{price:900},fx:{rate:9}}}};
 const snapshot={data:s.data,fx:s.fx,quotes:Object.fromEntries(coreCompanies.map(c=>[c.symbol,{price:s.data[c.symbol].at(-1).close,time:now/1000,currency:c.currency,regularSessions:[]}]))};
 const summary=account.autonomousCycle(s,null,now,snapshot,null,session);
 assert.equal(summary.status,'complete');assert.equal(summary.newExecutions,0);assert.ok(s.assetAllocation.positions['570A'].pending);
 assert.deepEqual(account.sessionFor('asia','pre',Date.parse('2026-10-13T23:00:00Z')).countries,['한국','일본']);
 assert.equal(account.sessionFor('asia','close',Date.parse('2027-10-11T08:00:00Z')).closedCountries[0].reason,'exchangeHoliday');
 assert.equal(account.sessionFor('asia','close',Date.parse('2028-10-12T08:00:00Z')).closedCountries[0].reason,'calendarUnavailable');
});

test('session entries fill at the first open after approval and cannot backdate a late decision',()=>{
 const s=createState(),open=Date.parse('2026-10-06T00:00:00Z'),close=open+23400000;
 s.executionPolicy={version:3,activatedAt:new Date(open-7200000).toISOString()};s.trades=[{id:'existing',executionBasis:'regularClose'}];
 enableRegularExecution(s,open-3600000,'open');
 assert.equal(s.executionPolicy.version,4);assert.equal(s.executionPolicy.activatedAt,new Date(open-7200000).toISOString());
 const quote={regularSessions:[{date:'2026-10-06',openTime:open/1000,closeTime:close/1000,open:null,close:null,complete:false}]};
 for(const side of ['buy','short','sell','cover']){
  const p={side,signalTimestamp:open/1000-86400};stampDecision(p,open-60000);
  assert.equal(regularExecution(s,p,quote,open+1200000),null);
  quote.regularSessions[0].open=103;
  const e=regularExecution(s,p,quote,open+1200000);assert.equal(e?.executionBasis,'regularOpen');assert.equal(e.sessionPrice,103);assert.equal(e.executionTime,open/1000);
  stampDecision(p,open+1000);assert.equal(regularExecution(s,p,quote,close+1800000),null);
  quote.regularSessions[0].open=null;
 }
 assert.equal(s.trades[0].executionBasis,'regularClose');
});

test('session retries are idempotent and opening/closing runs cannot approve stock entries',async()=>{
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0000_new_millenium_guard.sql','0001_nifty_marrow.sql','0002_steady_ricochet.sql','0003_amused_patch.sql'])sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const db={prepare(query){
  let args=[];const statement=sql.prepare(query);
  return {bind(...a){args=a;return this},async first(){return statement.get(...args)},async all(){return {results:statement.all(...args)}},async run(){return {meta:{changes:Number(statement.run(...args).changes)}}}};
 }};
 const a=await account.readAccount(db);a.state.mode='live';a.state.plans=[];
 await account.writeAccount(db,a,a.state);
 const now=Date.parse('2026-10-06T00:20:00Z'),snapshot={data:a.state.data,fx:a.state.fx,quotes:{},fetchedAt:new Date(now).toISOString()};
 for(const c of (await import('../web/engine.mjs')).activeCompanies(a.state))snapshot.quotes[c.symbol]={price:a.state.data[c.symbol].at(-1).close,time:now/1000,currency:c.currency,regularSessions:[]};
 const opened=account.sessionFor('asia','open',now);
 const first=await account.runScheduled(db,null,now,snapshot,null,opened);
 assert.equal(first.metadata.lastSession?.key,opened.key);assert.equal(first.summary.approved,0);assert.equal(first.state.trades.length,0);
 const repeated=await account.runScheduled(db,null,now,snapshot,null,opened);assert.equal(repeated.reused,true);assert.equal(repeated.revision,first.revision);
 const later=Date.parse('2026-10-06T07:00:00Z'),closed=account.sessionFor('asia','close',later);
 const result=await account.runScheduled(db,null,later,{...snapshot,fetchedAt:new Date(later).toISOString()},null,closed);
 assert.equal(result.summary.approved,0);assert.equal(result.metadata.lastSession.key,closed.key);assert.equal(result.metadata.runCount,2);
});

test('ETF preopen decisions fill once at the opening price even after a gap above 3%',()=>{
 const now=Date.parse('2026-10-06T00:20:00Z'),open=now/1000-1200;
 const raw={symbol:'153130',quote:{price:100000,time:now/1000,regularSessions:[{date:'2026-10-06',openTime:open,closeTime:open+23400,open:100000,close:null,complete:false}]},fx:{rate:1,time:now/1000},bars:Array.from({length:61},(_,i)=>({time:open-(60-i)*86400,close:100000,volume:100000})),dividends:[],sources:[]};
 const s=createState();s.mode='live';s.plans=[];enableRegularExecution(s,now-7200000,'open');
 for(const phase of ['open','close']){
  allocateAssets(s,raw,now,exposure(s),0,{phase,date:'2026-10-06'});
  assert.equal(s.assetAllocation.positions['153130'].pending,null);assert.equal(s.trades.length,0);
 }
 allocateAssets(s,{...raw,quote:{...raw.quote,time:open-86400,regularSessions:[]}},now-3600000,exposure(s),0,{phase:'pre',date:'2026-10-06'});
 const p=s.assetAllocation.positions['153130'].pending;assert.ok(p);assert.equal(p.reference,100000);
 const unopened={...raw,quote:{...raw.quote,regularSessions:[]}};
 allocateAssets(s,unopened,now,exposure(s),0,{phase:'open',date:'2026-10-06'});
 const a=s.assetAllocation.positions['153130'];assert.equal(a.qty,0);assert.ok(a.pending);
 const gapped={...raw,quote:{...raw.quote,regularSessions:[{...raw.quote.regularSessions[0],open:104000}]}};
 allocateAssets(s,gapped,now,exposure(s),0,{phase:'open',date:'2026-10-06'});assert.ok(a.qty>0);assert.equal(a.pending,null);assert.equal(a.trades[0].executionBasis,'regularOpen');assert.equal(a.trades[0].sessionPrice,104000);assert.equal(a.trades[0].executionTime,open);
 const cash=s.cash;allocateAssets(s,gapped,now,exposure(s),0,{phase:'open',date:'2026-10-06'});assert.equal(s.cash,cash);
 const end=(open+23400)*1000,closed={...gapped,quote:{...gapped.quote,time:end/1000,regularSessions:[{...gapped.quote.regularSessions[0],close:104000,complete:true}]}};
 allocateAssets(s,closed,end+1800000,exposure(s),0,{phase:'close',date:'2026-10-06'});assert.equal(s.cash,cash);assert.equal(a.trades.length,1);
});

test('session identity distinguishes preopen and open in one 4h slot and handles US Friday in Seoul Saturday',()=>{
 assert.equal(typeof account.sessionFor,'function');
 const pre=account.sessionFor('asia','pre',Date.parse('2026-10-05T23:00:00Z'));
 const opened=account.sessionFor('asia','open',Date.parse('2026-10-06T00:20:00Z'));
 assert.notEqual(pre.key,opened.key);assert.notEqual(pre.slot,opened.slot);
 assert.equal(account.sessionFor('us','close',Date.parse('2026-10-09T20:30:00Z')).date,'2026-10-09');
 assert.equal(account.sessionFor('us','pre',Date.parse('2026-10-12T12:30:00Z')).date,'2026-10-12');
 assert.equal(account.sessionFor('us','pre',Date.parse('2026-11-02T13:30:00Z')).date,'2026-11-02');
 assert.throws(()=>account.sessionFor('us','pre',Date.parse('2026-10-06T13:31:00Z')));
 assert.throws(()=>account.sessionFor('asia','open',Date.parse('2026-10-10T00:20:00Z')));
});

test('risk-only sessions follow US DST and close boundaries without admitting weekends or invalid phases',()=>{
 assert.equal(account.sessionFor('us','pre',Date.parse('2026-10-06T13:35:00Z'),true).key,'us:2026-10-06:open');
 assert.equal(account.sessionFor('us','pre',Date.parse('2026-11-02T14:35:00Z'),true).key,'us:2026-11-02:open');
 assert.equal(account.sessionFor('us','open',Date.parse('2026-10-09T20:05:00Z'),true).key,'us:2026-10-09:close');
 assert.throws(()=>account.sessionFor('us','open',Date.parse('2026-10-09T20:05:00Z')));
 assert.throws(()=>account.sessionFor('asia','pre',Date.parse('2026-10-10T00:05:00Z'),true));
 assert.throws(()=>account.sessionFor('asia','invalid',Date.parse('2026-10-06T00:05:00Z'),true));
});

import {eligibleIdeaAccount,ideaResearch,testNow} from './idea-fixtures.mjs';
test('preopen research approval reaches stock open execution without fresh decisions at opening or closing',()=>{
 const s=eligibleIdeaAccount(),pre=testNow-3600000,open=testNow,close=open+23400000,raw=ideaResearch();raw.asOf=new Date(pre).toISOString();raw.investmentIdeas[0].asOf=raw.asOf;
 enableRegularExecution(s,pre-1000);
 const quotes=Object.fromEntries(Object.entries(s.marketData.quotes).map(([symbol,q])=>[symbol,{...q,time:pre/1000-86400,regularSessions:[]}]));
 const snapshot={data:s.data,fx:s.fx,quotes,fetchedAt:new Date(pre).toISOString()};
 const finance=Object.fromEntries(['005930','000660'].map(symbol=>[symbol,{periodEnd:'2026-03-31',periodType:'12M',currency:'KRW',fetchedAt:raw.asOf,sources:[{url:'https://finance.yahoo.com/quote/005930.KS/financials/'}],metrics:{revenue:1200,priorRevenue:1000,netIncome:100,equity:1000,eps:10000,debt:100,operatingCashFlow:120}}]));
 const researched=account.autonomousCycle(s,raw,pre,snapshot,finance,account.sessionFor('asia','pre',pre));assert.ok(researched.approved>0);assert.equal(s.trades.length,0);
 const approved=s.plans.filter(p=>p.status==='승인').map(p=>p.id);
 const at=(now,complete,gap=null)=>({...snapshot,fetchedAt:new Date(now).toISOString(),quotes:Object.fromEntries(Object.entries(quotes).map(([symbol,q])=>[symbol,{...q,time:now/1000,regularSessions:gap===null?[]:[{date:'2026-10-05',openTime:open/1000,closeTime:close/1000,open:q.price*gap,close:complete?q.price:null,complete}]}]))});
 const waiting=account.autonomousCycle(s,null,open+1200000,at(open+1200000,false),null,account.sessionFor('asia','open',open+1200000));assert.equal(waiting.approved,0);assert.equal(waiting.newExecutions,0);assert.equal(waiting.status,'awaitingOpen');assert.equal(s.trades.length,0);
 const opened=account.autonomousCycle(s,null,open+1200000,at(open+1200000,false,1.04),null,account.sessionFor('asia','open',open+1200000));assert.equal(opened.approved,0);assert.ok(opened.newExecutions>0);assert.equal(opened.status,'complete');
 assert.ok(s.trades.every(t=>t.executionBasis==='regularOpen'&&t.executionTime===open/1000));assert.ok(approved.every(id=>s.plans.some(p=>p.id===id&&p.status==='체결')));
 const count=s.trades.length;account.autonomousCycle(s,null,open+1200000,at(open+1200000,false,1.04),null,account.sessionFor('asia','open',open+1200000));assert.equal(s.trades.length,count);
 const ended=account.autonomousCycle(s,null,close+1800000,at(close+1800000,true,1.04),null,account.sessionFor('asia','close',close+1800000));assert.equal(ended.approved,0);assert.equal(ended.newExecutions,0);assert.equal(ended.status,'complete');assert.equal(s.trades.length,count);
});
