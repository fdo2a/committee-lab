import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/engine.mjs';
import {reviewPolicy} from '../worker/account.mjs';
const base=engine.createState();
function account(){
 const s=structuredClone(base);s.plans=[];s.holdings=[];s.trades=[];s.mode='live';s.date='2026-10-04';
 for(const c of engine.activeCompanies(s))s.data[c.symbol]=s.data[c.symbol].map(b=>({...b,open:10000,close:10000,high:10001,low:9999}));
 s.fx={USD:1,JPY:1,KRW:1};s.marketData={quotes:Object.fromEntries(engine.activeCompanies(s).map(c=>[c.symbol,{price:10000,time:2}]))};
 s.externalResearch={screening:[{symbol:'005930',stance:'allow',fundamentalPass:true}]};s.fundamentals={'005930':{pass:true}};return s;
}
function open(){const s=account();s.plans=[{id:'PS',symbol:'005930',side:'short',qty:500,reference:10000,stop:10400,target:9200,date:s.date,strategy:'SH21',status:'승인',signalTimestamp:1}];engine.advance(s,{quotes:s.marketData.quotes,date:s.date,now:Date.UTC(2026,9,4,9)});return s;}

test('one account marks long assets and short liabilities with separate gross and net exposure',()=>{
 const s=account();s.cash=101000000;s.holdings=[{symbol:'005930',direction:'long',qty:100,cost:1000000,entry:10000,stop:9000,target:12000},{symbol:'035420',direction:'short',qty:200,cost:2000000,entry:10000,stop:11000,target:8000,borrowAccrued:0}];
 assert.equal(engine.equity(s),100000000);const x=engine.exposure(s);assert.equal(x.long,1000000);assert.equal(x.short,2000000);assert.equal(x.gross,3000000);assert.equal(x.net,-1000000);assert.equal(x.availableCash,97000000);
});
test('short proceeds are locked and a falling price is covered with net profit',()=>{
 const s=open();assert.equal(s.trades[0]?.side,'short');assert.equal(s.holdings[0]?.direction,'short');assert.ok(s.cash>engine.INITIAL);assert.ok(engine.exposure(s).availableCash<engine.INITIAL);assert.ok(engine.equity(s)<engine.INITIAL);
 s.marketData.quotes['005930']={price:9000,time:3};engine.advance(s,{quotes:s.marketData.quotes,date:s.date,now:Date.UTC(2026,9,4,9)});
 const t=s.trades.find(t=>t.side==='cover');assert.ok(t.pnl>0);assert.equal(s.holdings.length,0);assert.ok(Math.abs(s.cash-engine.INITIAL-t.pnl)<0.00001);engine.validateState(s);
});
test('short stop uses the observed adverse gap and repeated quotes cannot cover twice',()=>{
 const s=open();s.marketData.quotes['005930']={price:13000,time:3};engine.advance(s,{quotes:s.marketData.quotes,date:s.date,now:Date.UTC(2026,9,4,9)});
 const t=s.trades.find(t=>t.side==='cover');assert.equal(t.price,13000*(1+engine.SLIP));assert.ok(t.pnl<0);assert.ok(t.reason.includes('손절'));engine.advance(s,{quotes:s.marketData.quotes,date:s.date,now:Date.UTC(2026,9,4,9)});assert.equal(s.trades.filter(t=>t.side==='cover').length,1);
});
test('elapsed time accrues short borrowing fees without requiring a new market quote',()=>{
 const s=open(),cash=s.cash;engine.advance(s,{quotes:s.marketData.quotes,date:s.date,now:Date.UTC(2026,9,5,9)});
 const cost=500*10000*0.03/365;assert.ok(Math.abs(cash-s.cash-cost)<0.00001);assert.ok(Math.abs(s.holdings[0].borrowAccrued-cost)<0.00001);
});
test('short exits create cover orders and their losses reduce the shared risk policy',()=>{
 const s=open();engine.requestExit(s,'005930');assert.equal(s.plans.at(-1).side,'cover');
 s.trades=[1,2,3].map(i=>({side:'cover',pnl:-1000,strategy:'SH21'}));assert.equal(reviewPolicy(s).riskScale,0.5);
});
test('pending short orders reserve the shared short exposure limit',()=>{
 const s=account();s.plans=['035420','051910','AAPL'].map((symbol,i)=>({id:'R'+i,symbol,side:'short',qty:1000,stop:10400,target:9200,status:'승인'}));
 const p={id:'P',symbol:'005930',side:'short',qty:100,stop:10400,target:9200};const r=engine.risk(s,p);assert.equal(r.pass,false);assert.ok(r.checks.some(([name,pass])=>name.includes('숏 총노출')&&!pass));
});
test('maintenance deficit closes a short and an extreme gap records insolvency honestly',()=>{
 for(const price of [600000,2000000]){const s=account();s.cash=101000000;s.holdings=[{symbol:'005930',direction:'short',qty:100,entry:10000,cost:1000000,stop:3000000,target:5000,strategy:'SH21',date:s.date,borrowAccrued:0,borrowLastAt:Date.UTC(2026,9,4,9),lastCheckedQuoteTime:1}];s.marketData.quotes['005930']={price,time:2};engine.advance(s,{quotes:s.marketData.quotes,date:s.date,now:Date.UTC(2026,9,4,9)});assert.equal(s.holdings.length,0);assert.ok(s.trades[0].reason.includes('증거금'));assert.ok(s.trades[0].pnl<0);if(price===2000000){assert.equal(s.insolvent,true);assert.ok(engine.equity(s)<0);}engine.validateState(s);}
});
test('downtrend strategies backtest short positions with borrowing costs',()=>{
 const bars=Array.from({length:320},(_,i)=>({open:100000*Math.pow(0.999,i),close:100000*Math.pow(0.999,i),high:100001*Math.pow(0.999,i),low:99999*Math.pow(0.999,i),volume:1000}));const st=engine.strategies.find(x=>x.regime==='하락'&&x.f===0&&x.z===0);assert.equal(st.direction,'short');const r=engine.backtest(bars,st);assert.ok(r.trades>0);assert.ok(r.ret>0);
});

test('short backtests charge borrowing through the next-session cover date',()=>{
 const bars=Array.from({length:185},(_,i)=>{const p=i<181?120-i*20/180:i===181?100:106;return {date:new Date(Date.UTC(2026,0,1)+i*86400000).toISOString().slice(0,10),open:p,close:p,high:p*1.0001,low:p*.9999,volume:1000};});
 const st=engine.strategies.find(x=>x.regime==='하락'&&x.f===0&&x.z===0),r=engine.backtest(bars,st);
 const qty=Math.floor(20000000/(99.9*1.00015));const proceeds=qty*99.9*.99985,cover=qty*106*1.001*1.00015,borrow=qty*(100+106)*.03/365;
 assert.equal(r.trades,1);assert.ok(Math.abs(r.ret-(proceeds-cover-borrow)/engine.INITIAL)<1e-10);
});

test('validated falling-market plans automatically open a short alongside a long in the same account',()=>{
 const s=account();for(const c of engine.activeCompanies(s))s.data[c.symbol]=Array.from({length:320},(_,i)=>{const p=100000*Math.pow(.999,i);return {open:p,close:p,high:p*1.00001,low:p*.99999,volume:1000};});
 for(const c of engine.activeCompanies(s))s.marketData.quotes[c.symbol].price=s.data[c.symbol].at(-1).close;
 s.externalResearch.screening[0].topDownScore=90;const price=s.marketData.quotes['035420'].price;s.holdings=[{symbol:'035420',direction:'long',qty:10,entry:price,cost:10*price,date:s.date,stop:price*.8,target:price*1.5,strategy:'S1',lastCheckedQuoteTime:2}];s.cash-=10*price;
 engine.analyze(s);const p=s.plans.find(p=>p.symbol==='005930'&&p.side==='short'&&p.status==='대기');assert.ok(p);engine.approve(s,p.id);p.signalTimestamp=1;engine.advance(s,{quotes:s.marketData.quotes,date:s.date,now:Date.UTC(2026,9,4,9)});
 assert.ok(s.holdings.some(h=>h.direction==='long'));assert.ok(s.holdings.some(h=>h.direction==='short'));engine.validateState(s);
});
