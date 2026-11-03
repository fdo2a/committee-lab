import test from 'node:test';
import assert from 'node:assert/strict';
import {collectUsResearch} from '../worker/us-research.mjs';

const env={SEC_USER_AGENT:'CommitteeResearch research@example.com',TYPESAFE_API_KEY:'private-typesafe-key'};
const filings=(forms=['4','8-K','10-Q','10-K'])=>({name:'Apple Inc.',tickers:['AAPL'],filings:{recent:{
 form:forms,accessionNumber:forms.map((_,i)=>'0000320193-26-'+String(i+1).padStart(6,'0')),
 filingDate:forms.map(()=> '2026-10-01'),primaryDocument:forms.map((_,i)=>'document'+i+'.htm'),
 primaryDocDescription:forms.map(f=>'Form '+f),items:forms.map(f=>f==='8-K'?'2.02':''),
}}});
const answer=(choice='later',confidence=1)=>({type:'choice',choice,confidence,probabilities:{read_next:choice==='read_next'?1:0,later:choice==='later'?1:0,uncertain:choice==='uncertain'?1:0}});
async function withFetch(fn,run){const original=globalThis.fetch;globalThis.fetch=fn;try{return await run()}finally{globalThis.fetch=original}}
function secResponse(url,body=filings()){
 if(String(url)==='https://www.sec.gov/files/company_tickers.json')return Response.json({0:{cik_str:320193,ticker:'AAPL',title:'Apple Inc.'}});
 assert.equal(String(url),'https://data.sec.gov/submissions/CIK0000320193.json');return Response.json(body);
}

test('rounded Jev choice probabilities preserve uncertain documents instead of rejecting the whole batch',async()=>{
 await withFetch(async(url,options)=>{
  if(new URL(url).host!=='api.typesafe.ai')return secResponse(url);
  const questions=JSON.parse(options.body).questions;
  return Response.json({model:'jev-1.13.0',answers:Object.fromEntries(Object.keys(questions).map(k=>[k,{type:'choice',choice:'uncertain',confidence:0,probabilities:{read_next:.33,later:.33,uncertain:.33}}])),usage:{input_tokens:100}});
 },async()=>{
  const result=await collectUsResearch(env,{symbols:['AAPL'],useJev:true});assert.equal(result.jev.status,'connected');assert.equal(result.documents.length,4);assert.equal(result.documents.find(d=>d.form==='4').priority,'uncertain');
 });
});

test('US-only collection rejects invalid markets and oversized requests before network access',async()=>{
 await withFetch(async()=>{assert.fail('invalid input must not fetch')},async()=>{
  for(const symbols of [['005930'],['7203'],['AAPL','AAPL'],[],Array(6).fill('AAPL')])await assert.rejects(()=>collectUsResearch(env,{symbols}));
  await assert.rejects(()=>collectUsResearch(env,{symbols:['AAPL'],query:'한글 질문'}));
  await assert.rejects(()=>collectUsResearch(env,{symbols:['AAPL'],useJev:'true'}));
  await assert.rejects(()=>collectUsResearch(env,{symbols:['AAPL'],market:'asia'}));
 });
});

test('missing SEC identity returns unconfigured without spending API credits',async()=>{
 await withFetch(async()=>{assert.fail('missing configuration must not fetch')},async()=>{
  const result=await collectUsResearch({TYPESAFE_API_KEY:env.TYPESAFE_API_KEY},{symbols:['AAPL'],useJev:true});
  assert.equal(result.sec.status,'unconfigured');assert.equal(result.jev.status,'not_run');assert.deepEqual(result.documents,[]);
 });
});

test('SEC collection keeps public sources and never calls paid Jev by default',async()=>{
 await withFetch(async(url,options)=>{
  assert.notEqual(new URL(url).host,'api.typesafe.ai');assert.equal(options.redirect,'manual');
  assert.equal(options.headers['User-Agent'],env.SEC_USER_AGENT);assert.equal(options.headers.Authorization,undefined);
  return secResponse(url);
 },async()=>{
  const result=await collectUsResearch(env,{symbols:['AAPL']});
  assert.equal(result.sec.status,'connected');assert.equal(result.jev.status,'disabled');assert.equal(result.documents.length,4);
  assert.ok(result.documents.find(d=>d.form==='10-K').required);
  assert.ok(result.documents.every(d=>d.bodyCollected===false&&d.url.startsWith('https://www.sec.gov/Archives/edgar/data/320193/')));
  assert.ok(!JSON.stringify(result).includes('private-typesafe-key'));assert.ok(!JSON.stringify(result).includes(env.SEC_USER_AGENT));
 });
});

test('missing Jev key preserves SEC candidates with explicit unconfigured status',async()=>{
 await withFetch(async url=>secResponse(url),async()=>{
  const result=await collectUsResearch({SEC_USER_AGENT:env.SEC_USER_AGENT},{symbols:['AAPL'],useJev:true});
  assert.equal(result.jev.status,'unconfigured');assert.equal(result.documents.length,4);
 });
});

test('one English Jev batch ranks public filing metadata while preserving mandatory and deferred documents',async()=>{
 let paidCalls=0;
 await withFetch(async(url,options)=>{
  if(new URL(url).host!=='api.typesafe.ai')return secResponse(url);
  paidCalls++;assert.equal(String(url),'https://api.typesafe.ai/v1/systemone');assert.equal(options.method,'POST');
  assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer '+env.TYPESAFE_API_KEY);
  const request=JSON.parse(options.body);assert.equal(request.model,'jev-1.13.0');assert.equal(request.state.market,'us');
  assert.ok(!options.body.includes('private-typesafe-key'));assert.ok(!options.body.includes('research@example.com'));
  const answers=Object.fromEntries(Object.keys(request.questions).map(id=>[id,answer('later')]));
  return Response.json({model:'jev-1.13.0',answers,usage:{input_tokens:1234,output_tokens:10}});
 },async()=>{
  const result=await collectUsResearch(env,{symbols:['AAPL'],query:'Cash flow and earnings risks',useJev:true});
  assert.equal(paidCalls,1);assert.equal(result.jev.status,'connected');assert.equal(result.jev.inputTokens,1234);
  assert.equal(result.documents.length,4);assert.equal(result.documents.at(-1).form,'4');
  assert.ok(result.documents.filter(d=>d.required).every(d=>d.priority==='required'&&d.jev.choice==='later'));
 });
});

test('bounded candidates retain the latest annual and quarterly filings beyond the first 30 rows',async()=>{
 await withFetch(async url=>secResponse(url,filings([...Array(31).fill('4'),'10-Q','10-K'])),async()=>{
  const result=await collectUsResearch(env,{symbols:['AAPL']});
  assert.equal(result.documents.length,32);assert.equal(result.sec.companies[0].truncated,true);
  assert.ok(result.documents.some(d=>d.form==='10-Q'&&d.required));assert.ok(result.documents.some(d=>d.form==='10-K'&&d.required));
 });
});

test('partial SEC failure preserves successful companies and skips paid selection',async()=>{
 await withFetch(async url=>String(url).endsWith('company_tickers.json')
  ?Response.json({0:{cik_str:320193,ticker:'AAPL'},1:{cik_str:789019,ticker:'MSFT'}})
  :String(url).includes('0000789019')?new Response('',{status:403}):secResponse(url),async()=>{
  const result=await collectUsResearch(env,{symbols:['AAPL','MSFT'],useJev:true});
  assert.equal(result.sec.status,'partial');assert.equal(result.sec.failures[0].symbol,'MSFT');assert.equal(result.sec.failures[0].code,'HTTP_403');
  assert.equal(result.documents.length,4);assert.equal(result.jev.status,'not_run');
 });
});

test('Jev rate limits, redirects and malformed answers preserve all candidates without retry or leaked errors',async()=>{
 for(const response of [()=>new Response('private-typesafe-key',{status:429}),()=>new Response('',{status:302,headers:{location:'https://evil.example'}}),()=>Response.json({model:'jev-1.13.0',answers:{}}),()=>Response.json({model:'jev-1.13.0',answers:Object.fromEntries([0,1,2,3].map(i=>['document_'+i,{...answer(),confidence:2}]))})]){
  let calls=0;
  await withFetch(async(url)=>{if(new URL(url).host!=='api.typesafe.ai')return secResponse(url);calls++;return response()},async()=>{
   const result=await collectUsResearch(env,{symbols:['AAPL'],useJev:true});
   assert.equal(calls,1);assert.equal(result.jev.status,'error');assert.equal(result.documents.length,4);
   assert.ok(result.documents.every(d=>!d.jev));assert.ok(!JSON.stringify(result).includes('private-typesafe-key'));
  });
 }
});

test('low-confidence deferrals remain visible as uncertain instead of being discarded',async()=>{
 await withFetch(async url=>new URL(url).host!=='api.typesafe.ai'?secResponse(url):Response.json({model:'jev-1.13.0',answers:Object.fromEntries([0,1,2,3].map(i=>['document_'+i,{type:'choice',choice:'later',confidence:0.1,probabilities:{read_next:0.3,later:0.4,uncertain:0.3}}]))}),async()=>{
  const result=await collectUsResearch(env,{symbols:['AAPL'],useJev:true});
  assert.equal(result.jev.status,'connected');assert.equal(result.documents.find(d=>d.form==='4').priority,'uncertain');assert.equal(result.documents.length,4);
 });
});

test('SEC XML rendering subdirectories produce valid source URLs and traversal paths are rejected',async()=>{
 for(const [file,valid] of [['xslF345X06/form4.xml',true],['../outside.htm',false],['/absolute.htm',false]]){
  const rows=filings();rows.filings.recent.primaryDocument[0]=file;
  await withFetch(async url=>secResponse(url,rows),async()=>{
   const result=await collectUsResearch(env,{symbols:['AAPL']});
   assert.equal(result.sec.status,valid?'connected':'error');
   if(valid)assert.ok(result.documents[0].url.endsWith('/xslF345X06/form4.xml'));
   else assert.equal(result.sec.failures[0].code,'INVALID_RESPONSE');
  });
 }
});
