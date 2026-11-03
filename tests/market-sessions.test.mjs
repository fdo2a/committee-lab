import test from 'node:test';
import assert from 'node:assert/strict';
import {coreCompanies as companies,createState} from '../web/engine.mjs';
import {validateMarket} from '../worker/market-data.mjs';

function snapshot(){const s=createState(),time=Date.now()/1000;return {provider:'Yahoo Finance / Python',fetchedAt:new Date().toISOString(),data:s.data,fx:{KRW:1,USD:1400,JPY:9.5},quotes:Object.fromEntries(companies.map(c=>[c.symbol,{price:100,time,currency:c.currency,regularSessions:[]}]))};}
function session(){const now=Date.now()/1000,day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date((now-86400)*1000));return {date:day,open:100,close:102,openTime:now-86400,closeTime:now-80000,complete:true};}
function attach(raw,s){raw.quotes.AAPL.regularSessions=[s];Object.assign(raw.data.AAPL.at(-1),{time:s.openTime,open:s.open,close:s.close??s.open,high:Math.max(s.open,s.close??s.open)+1,low:Math.min(s.open,s.close??s.open)-1});return raw;}
test('validated session events preserve quote marking and normalize missing metadata to no events',()=>{
 const raw=snapshot();delete raw.quotes.AAPL.regularSessions;const valid=validateMarket(raw);assert.deepEqual(valid.quotes.AAPL.regularSessions,[]);assert.equal(valid.quotes.AAPL.price,100);assert.equal(valid.quotes.AAPL.time,raw.quotes.AAPL.time);
});
test('future incomplete close is retained as null while completed future events are rejected',()=>{
 const raw=snapshot(),now=Date.now()/1000;attach(raw,{date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date((now-100)*1000)),open:100,close:null,openTime:now-100,closeTime:now+100,complete:false});assert.equal(validateMarket(raw).quotes.AAPL.regularSessions[0].complete,false);
 raw.quotes.AAPL.regularSessions[0].complete=true;raw.quotes.AAPL.regularSessions[0].close=101;assert.throws(()=>validateMarket(raw));
});
test('session prices must match the actual daily OHLC at the sourced opening timestamp',()=>{
 const raw=attach(snapshot(),session());assert.equal(validateMarket(raw).quotes.AAPL.regularSessions[0].close,102);
 raw.quotes.AAPL.regularSessions[0].close=103;assert.throws(()=>validateMarket(raw));raw.quotes.AAPL.regularSessions[0].close=102;raw.quotes.AAPL.regularSessions[0].openTime-=60;assert.throws(()=>validateMarket(raw));
});
test('invalid bounds, duplicate sessions, excessive sessions and false close confirmation are rejected',()=>{
 for(const mutate of [s=>s.openTime=Date.now()/1000+100,s=>s.closeTime=s.openTime-1,s=>s.open=0,s=>s.close=null,s=>s.complete=false,s=>s.date='2026-99-99']){const raw=snapshot(),s=session();mutate(s);raw.quotes.AAPL.regularSessions=[s];assert.throws(()=>validateMarket(raw));}
 const raw=snapshot();raw.quotes.AAPL.regularSessions=Array.from({length:6},()=>session());assert.throws(()=>validateMarket(raw));raw.quotes.AAPL.regularSessions=[session(),session()];assert.throws(()=>validateMarket(raw));
});
