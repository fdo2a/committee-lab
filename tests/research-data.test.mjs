import test from 'node:test';
import assert from 'node:assert/strict';
import {researchData} from '../worker/research-data.mjs';

test('DART research identifies its client and returns public filing sources',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>options?.headers?.['User-Agent']
  ? Response.json({status:'000',total_count:1,total_page:1,list:[{corp_name:'삼성전자',corp_code:'00126380',stock_code:'005930',report_nm:'사업보고서',rcept_dt:'20261002',rcept_no:'20261002000001'}]})
  :new Response('',{status:302,headers:{location:'https://opendart.fss.or.kr/error1.html'}});
 try{const r=await researchData({DART_API_KEY:'a'.repeat(40)});assert.equal(r.providers.DART.status,'connected');assert.equal(r.providers.DART.reports[0].symbol,'005930');assert.equal(r.providers.DART.reports[0].url,'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261002000001');assert.ok(!JSON.stringify(r).includes('a'.repeat(40)));}
 finally{globalThis.fetch=original;}
});

test('credentialed provider requests stop at redirects',async()=>{
 const original=globalThis.fetch;let safeRedirect=false;
 globalThis.fetch=async(url,options)=>{safeRedirect=options?.redirect==='manual';return new Response('',{status:302,headers:{location:'https://example.com/'}});};
 try{const r=await researchData({DART_API_KEY:'b'.repeat(40)});assert.equal(r.providers.DART.code,'HTTP_302');assert.equal(safeRedirect,true);assert.ok(!JSON.stringify(r).includes('b'.repeat(40)));}
 finally{globalThis.fetch=original;}
});

test('FRED supplies direct liquidity and leading/growth series and preserves successes on one failure',async()=>{
 const original=globalThis.fetch;const attempts={};
 globalThis.fetch=async url=>{const id=new URL(url).searchParams.get('series_id');attempts[id]=(attempts[id]||0)+1;if(id==='M2SL')return new Response('',{status:403});return Response.json({observations:[{date:'2026-10-01',value:'100'}]});};
 try{const r=await researchData({FRED_API_KEY:'private-fred-key'}),p=r.providers.FRED;assert.equal(p.status,'partial');for(const id of ['DGS10','FEDFUNDS','CPIAUCSL','UNRATE','WALCL','ICSA','INDPRO'])assert.ok(p.series.some(s=>s.id===id));assert.equal(p.failures[0].id,'M2SL');assert.equal(p.failures[0].code,'HTTP_403');assert.equal(attempts.M2SL,1);assert.ok(!JSON.stringify(r).includes('private-fred-key'));}
 finally{globalThis.fetch=original;}
});

test('provider retries only bounded transient failures and does not retry rate limits',async()=>{
 const original=globalThis.fetch;let attempts=0;
 try{globalThis.fetch=async()=>{attempts++;return attempts===1?new Response('',{status:503}):Response.json({status:'013'});};assert.equal((await researchData({DART_API_KEY:'key'})).providers.DART.status,'connected');assert.equal(attempts,2);
 attempts=0;globalThis.fetch=async()=>{attempts++;return new Response('',{status:429});};assert.equal((await researchData({DART_API_KEY:'key'})).providers.DART.code,'HTTP_429');assert.equal(attempts,1);}
 finally{globalThis.fetch=original;}
});
