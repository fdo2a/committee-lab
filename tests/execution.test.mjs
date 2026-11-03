import test from 'node:test';
import assert from 'node:assert/strict';
import {approve,advance,activeCompanies,fxOf,SLIP,backtest,strategies,INITIAL} from '../web/engine.mjs';
import {readyState as createState} from './fixtures.mjs';

const now=Date.parse('2026-10-05T08:00:00Z'), start=now/1000-3600,end=now/1000-600;
function account(){
 const s=createState(),p=s.plans.find(p=>p.status==='대기');
 s.executionPolicy={version:1,activatedAt:new Date((start-600)*1000).toISOString(),buy:'regularClose',sell:'regularOpen'};
 approve(s,p.id,(start-300)*1000);
 p.signalTimestamp=start-300;
 const quotes=Object.fromEntries(activeCompanies(s).map(c=>[c.symbol,{price:s.data[c.symbol].at(-1).close,time:now/1000,currency:c.currency}]));
 const base=p.reference/fxOf(p.symbol,s);
 quotes[p.symbol].regularSessions=[{date:'2026-10-05',open:base*.995,close:base,openTime:start,closeTime:end,complete:true}];
 return {s,p,quotes,base};
}
test('an approved buy uses the completed regular close even when the latest quote differs',()=>{
 const {s,p,quotes,base}=account();quotes[p.symbol].price=base*1.01;
 advance(s,{quotes,date:s.date,now});
 const t=s.trades.find(t=>t.side==='buy');assert.ok(t);
 assert.equal(t.price,p.reference*(1+SLIP));
 assert.equal(t.sessionPrice,base);assert.equal(t.executionTime,end);assert.equal(t.executionBasis,'regularClose');
 advance(s,{quotes,date:s.date,now});assert.equal(s.trades.filter(t=>t.side==='buy').length,1);
});
test('long backtests enter at the next close and mark remaining holdings without a fabricated last-day sale',()=>{
 const bars=Array.from({length:183},(_,i)=>({open:500,close:100+i*.2,high:500,low:90,volume:1000}));
 const st=strategies.find(x=>x.direction!=='short'&&x.f===0&&x.z===0);
 const r=backtest(bars,st),qty=Math.floor(20000000/(136.2*1.001*1.00015));
 const cost=qty*136.2*1.001*1.00015;
 assert.ok(Math.abs(r.points[1]-(INITIAL-cost+qty*136.2))<1e-6);
 assert.equal(r.trades,0);assert.ok(Math.abs(r.ret-(-cost+qty*136.4)/INITIAL)<1e-10);
});
test('short backtests use the same next-close entry model as the live basket',()=>{
 const bars=Array.from({length:183},(_,i)=>({open:500,close:100-i*.2,high:500,low:50,volume:1000}));
 const st=strategies.find(x=>x.direction==='short'&&x.f===0&&x.z===0),r=backtest(bars,st),qty=Math.floor(20000000/(63.8*.999*1.00015));
 const proceeds=qty*63.8*.999*.99985;
 assert.ok(Math.abs(r.points[1]-(INITIAL+proceeds-qty*63.8))<1e-6);assert.equal(r.trades,0);
});
test('intraday or missing session prices cannot fill a buy',()=>{
 for(const incomplete of [true,false]){
  const {s,p,quotes}=account();
  if(incomplete)Object.assign(quotes[p.symbol].regularSessions[0],{complete:false,close:null,closeTime:now/1000+3600});
  else delete quotes[p.symbol].regularSessions;
  advance(s,{quotes,date:s.date,now});assert.equal(s.trades.length,0);assert.equal(p.status,'승인');
 }
});
test('a buy approved after the close waits for a future session instead of backdating',()=>{
 const {s,p,quotes}=account();p.approvedAt=new Date(now).toISOString();p.eligibleAfter=now/1000;
 advance(s,{quotes,date:s.date,now});assert.equal(s.trades.length,0);assert.equal(p.status,'승인');
});
test('long exits use the next eligible regular open and never the current quote',()=>{
 const {s,p,quotes}=account();s.plans=[];
 s.holdings=[{symbol:p.symbol,direction:'long',qty:1,entry:p.reference,cost:p.reference,date:s.date,stop:0,target:Infinity,strategy:p.strategy,lastCheckedQuoteTime:now/1000}];
 s.plans=[{...p,id:'exit',side:'sell',qty:1,status:'승인',eligibleAfter:start-10}];
 advance(s,{quotes,date:s.date,now});const t=s.trades[0];assert.ok(t);
 assert.equal(t.price,p.reference*.995*(1-SLIP));assert.equal(t.executionTime,start);assert.equal(t.executionBasis,'regularOpen');
});
test('an intraday stop queues a sell and cannot use the already elapsed open',()=>{
 const {s,p,quotes}=account();s.plans=[];
 s.holdings=[{symbol:p.symbol,direction:'long',qty:1,entry:p.reference,cost:p.reference,date:s.date,stop:p.reference*1.1,target:p.reference*2,strategy:p.strategy,lastCheckedQuoteTime:start-1}];
 advance(s,{quotes,date:s.date,now});assert.equal(s.trades.length,0);
 const exit=s.plans.find(p=>p.side==='sell'&&p.status==='승인');assert.ok(exit);assert.equal(exit.eligibleAfter,now/1000);
 const nextOpen=now/1000+86400;
 quotes[p.symbol].regularSessions.push({date:'2026-10-06',open:p.reference/fxOf(p.symbol,s)*.98,close:null,openTime:nextOpen,closeTime:nextOpen+20000,complete:false});
 quotes[p.symbol].time=nextOpen;
 advance(s,{quotes,date:'2026-10-06',now:nextOpen*1000});assert.equal(s.trades.length,1);assert.equal(s.trades[0].executionTime,nextOpen);
});
test('repeated unit exit signals preserve the decision time while waiting for a session',()=>{
 const {s,p,quotes}=account();s.plans=[];
 s.holdings=[{symbol:p.symbol,unitId:'U',direction:'long',qty:1,entry:p.reference,cost:p.reference,date:s.date,stop:0,target:1e12,strategy:p.strategy,lastCheckedQuoteTime:start-1}];
 s.trendUnits=[{id:'U',status:'active',capital:p.reference,realizedPnl:0,lossLimit:.1,targetReturn:.2,expiresAt:'2020-01-01',reviewLog:[]}];
 advance(s,{quotes,date:s.date,now});const exit=s.plans.find(p=>p.unitExit);assert.ok(exit);
 quotes[p.symbol].time+=60;
 advance(s,{quotes,date:s.date,now:now+60000});
 assert.equal(s.plans.find(p=>p.unitExit&&p.status==='승인').id,exit.id);
 assert.equal(exit.eligibleAfter,now/1000);
});
