import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleMcp} from '../worker/mcp.mjs';
import {readAccount,writeAccount} from '../worker/account.mjs';
import {fundamentalReview} from '../worker/fundamentals.mjs';
import {jevPackets} from '../scripts/research-agent.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function database(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0000_new_millenium_guard','0001_nifty_marrow'])sqlite.exec(readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8'));
 return {sqlite,prepare(sql){
  const stmt=sqlite.prepare(sql);let args=[];
  return {
   bind(...values){args=values;return this},
   async first(){return stmt.get(...args)},
   async all(){return {results:stmt.all(...args)}},
   async run(){return {meta:{changes:stmt.run(...args).changes}}},
  };
 }};
}
function request(method,params={},headers={},verb='POST'){
 return new Request('https://committee.example/mcp',{method:verb,headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25',...headers},...(verb==='POST'?{body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}:{})});
}
async function call(env,name,args={}){
 const response=await handleMcp(request('tools/call',{name,arguments:args},{'oai-authenticated-user-id':'owner'}),env);
 assert.equal(response.status,200);
 const message=await response.json();
 return message.result;
}
const data=result=>result.structuredContent;
async function liveAccount(db){
 const account=await readAccount(db);account.state.mode='live';
 account.state.marketData={provider:'Yahoo Finance / Python',fetchedAt:new Date(Date.now()-31*60000).toISOString(),quotes:{AAPL:{price:100,time:Math.floor(Date.now()/1000)-3600,currency:'USD'}},fx:{KRW:1,USD:1400,JPY:9.5}};
 await writeAccount(db,account,account.state);
}

test('official MCP client discovers research tools and declares evaluation-log writes without reading private data',async()=>{
 const client=new Client({name:'committee-test',version:'1.0.0'});
 const transport=new StreamableHTTPClientTransport(new URL('https://committee.example/mcp'),{fetch:(url,options)=>handleMcp(new Request(url,options),{AUTH_PROVIDER:'sites'})});
 try{
  await client.connect(transport);const tools=(await client.listTools()).tools;
  assert.ok(tools.some(t=>t.name==='get_market_data'));
  assert.ok(tools.some(t=>t.name==='get_research_data'));
  assert.ok(tools.some(t=>t.name==='collect_us_research'));
  assert.ok(tools.every(t=>!t.annotations.destructiveHint));
  assert.ok(tools.filter(t=>t.name!=='evaluate_us_candidates').every(t=>t.annotations.readOnlyHint));
  assert.equal(tools.find(t=>t.name==='evaluate_us_candidates')?.annotations.readOnlyHint,false);
  assert.ok(!JSON.stringify(tools).includes('holdings'));
 }finally{await client.close()}
});

const pilotSource='https://www.apple.com/newsroom/';
async function pilotAccount(db){
 await liveAccount(db);const a=await readAccount(db),asOf=new Date().toISOString();
 const idea={id:'us-test',name:'Cloud investment',sourceDepartments:['screening','market'],region:'미국',category:'theme',asOf,
  thesis:'Cloud investment',catalyst:'Orders',whatToWatch:'Demand',invalidation:'Order cancellation',action:'review',
  candidates:[{symbol:'AAPL',reason:'Hardware'},{symbol:'MSFT',reason:'Cloud'}],sourceUrls:[pilotSource],opposingViews:[],
  referenceIndex:{name:'Test universe',asOf,constituents:['AAPL','MSFT'],sourceUrls:[pilotSource]}};
 a.state.externalResearch={asOf,topDown:'Cloud investment',bottomUp:'Pending',decision:'Watch',marketReview:'Neutral',limitations:'Test fixture',sources:[{title:'Test source',url:pilotSource}],investmentIdeas:[idea],trendUnits:[],macroScorecard:[],departmentResearch:{}};
 await writeAccount(db,a,a.state);
 return {asOf,regime:'High rates',concept:'Cloud investment',horizonMonths:2,catalyst:'Orders within two months',invalidation:'Order cancellations',sourceUrls:[pilotSource],
  candidates:['AAPL','MSFT'].map(symbol=>({symbol,conceptEvidence:'Supplies cloud infrastructure.',regimeEvidence:'Higher rates raise funding costs.',catalystEvidence:'Orders scheduled within two months.',counterEvidence:'Orders can be cancelled.',sourceUrls:[pilotSource]}))};
}
function pilotResponse(body,mutate=()=>{}){
 const answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=>[id,q.type==='score'?{type:'score',score:id.startsWith('candidate_0')?1:4,confidence:1,probabilities:Object.fromEntries(q.criteria.map((_,i)=>[i,Number(i===(id.startsWith('candidate_0')?1:4))])),legend:Object.fromEntries(q.criteria.map((v,i)=>[i,v]))}:{type:'choice',choice:'candidate',confidence:1,probabilities:{candidate:1,reserve:0,watch:0,exclude:0}}]));
 const result={model:'jev-1.13.0',answers,usage:{input_tokens:400,output_tokens:100}};mutate(result);return Response.json(result);
}

test('two JEV stages preserve all candidates, hide existing selections, cache paid calls and leave account state byte-for-byte intact',async()=>{
 const db=database(),original=globalThis.fetch;let calls=0;
 try{
  const packet=await pilotAccount(db),before=db.sqlite.prepare("SELECT state FROM paper_account WHERE id='main'").get().state;
  globalThis.fetch=async(url,options)=>{
   calls++;assert.equal(url,'https://api.typesafe.ai/v1/systemone');const body=JSON.parse(options.body);
   assert.ok(!JSON.stringify(body).includes('SECRET'));assert.ok(!JSON.stringify(body).includes('baseline'));
   return pilotResponse(body);
  };
  const args={stage:'discovery',ideaId:'us-test',packet,useJev:true},env={AUTH_PROVIDER:'sites',DB:db,TYPESAFE_API_KEY:'SECRET'};
  const discovery=data(await call(env,'evaluate_us_candidates',args));assert.equal(discovery.status,'evaluated');
  assert.deepEqual(discovery.candidates.map(c=>c.symbol),['MSFT','AAPL']);assert.equal(discovery.candidates[0].score,100);
  assert.equal(discovery.candidates.length,2);assert.equal(discovery.mode,'shadow');
  const cached=data(await call(env,'evaluate_us_candidates',args));assert.equal(cached.cached,true);assert.equal(calls,1);
  const a=await readAccount(db);a.state.externalResearch.investmentIdeas[0].managementReview={status:'watch',reason:'Missing real financials',sourceUrls:[pilotSource]};await writeAccount(db,a,a.state);
  const admission=data(await call(env,'evaluate_us_candidates',{...args,stage:'admission'}));assert.equal(admission.status,'evaluated');
  assert.ok(admission.candidates.every(c=>c.assessment==='needs_research'));assert.equal(calls,2);
  assert.deepEqual(admission.comparison.jevCandidateSymbols,[]);assert.equal(admission.comparison.baselineSelectedOverlap,null);
  const state=JSON.parse(db.sqlite.prepare("SELECT state FROM paper_account WHERE id='main'").get().state),initial=JSON.parse(before);
  for(const key of ['trades','holdings','plans','cash'])assert.deepEqual(state[key],initial[key]);
  const history=data(await call(env,'get_jev_evaluations'));assert.equal(history.evaluations.length,2);
 }finally{globalThis.fetch=original;db.sqlite.close()}
});

test('JEV rejects scope, language, evidence and stage violations before spending',async()=>{
 const db=database(),original=globalThis.fetch;globalThis.fetch=async()=>assert.fail('Invalid packet must not spend');
 try{
  const packet=await pilotAccount(db),env={AUTH_PROVIDER:'sites',DB:db,TYPESAFE_API_KEY:'SECRET'},base={stage:'discovery',ideaId:'us-test',packet,useJev:true};
  for(const args of [{...base,stage:'admission'},{...base,packet:{...packet,concept:'한국어'}},{...base,packet:{...packet,candidates:packet.candidates.slice(0,1)}},{...base,packet:{...packet,candidates:packet.candidates.map(c=>({...c,admissionEvidence:'Future selection information'}))}},{...base,packet:{...packet,sourceUrls:['https://unregistered.example/']}},{...base,packet:{...packet,apiKey:'SECRET'}}])assert.equal((await call(env,'evaluate_us_candidates',args)).isError,true);
  const a=await readAccount(db);a.state.externalResearch.investmentIdeas[0].region='한국';await writeAccount(db,a,a.state);
  assert.equal((await call(env,'evaluate_us_candidates',base)).isError,true);
 }finally{globalThis.fetch=original;db.sqlite.close()}
});

test('uncertainty and missing evidence stay on watch; malformed or billed failures are recorded and never retried',async()=>{
 const db=database(),original=globalThis.fetch;let calls=0;
 try{
  const packet=await pilotAccount(db),env={AUTH_PROVIDER:'sites',DB:db,TYPESAFE_API_KEY:'SECRET'},base={stage:'discovery',ideaId:'us-test',packet,useJev:true};
  packet.candidates[0].conceptEvidence='';
  globalThis.fetch=async(_url,options)=>{calls++;return pilotResponse(JSON.parse(options.body),r=>{for(const a of Object.values(r.answers))a.confidence=.2})};
  const low=data(await call(env,'evaluate_us_candidates',base));assert.ok(low.candidates.every(c=>c.assessment==='needs_research'));assert.equal(low.metrics.evaluatedCount,1);
  const failedArgs={...base,packet:{...packet,concept:'Different cloud hypothesis'}};
  globalThis.fetch=async()=>{calls++;return new Response('SECRET provider error',{status:429})};
  const failure=data(await call(env,'evaluate_us_candidates',failedArgs));assert.equal(failure.status,'error');assert.equal(failure.code,'HTTP_429');assert.ok(!JSON.stringify(failure).includes('SECRET'));
  await call(env,'evaluate_us_candidates',failedArgs);assert.equal(calls,2);
  globalThis.fetch=async(_url,options)=>{calls++;return pilotResponse(JSON.parse(options.body),r=>{Object.values(r.answers)[0].score=99})};
  const malformed=data(await call(env,'evaluate_us_candidates',{...base,packet:{...packet,concept:'Another cloud hypothesis'}}));assert.equal(malformed.status,'error');assert.equal(malformed.code,'INVALID_RESPONSE');
 }finally{globalThis.fetch=original;db.sqlite.close()}
});

test('retrospective JEV comparisons are explicitly labelled and cannot masquerade as discovery snapshots',async()=>{
 const db=database(),original=globalThis.fetch;
 try{
  const packet=await pilotAccount(db),a=await readAccount(db);a.state.externalResearch.investmentIdeas[0].managementReview={status:'watch',reason:'Already reviewed',sourceUrls:[pilotSource]};await writeAccount(db,a,a.state);
  const args={stage:'discovery',ideaId:'us-test',packet,useJev:true},env={AUTH_PROVIDER:'sites',DB:db,TYPESAFE_API_KEY:'SECRET'};
  globalThis.fetch=async(_url,options)=>pilotResponse(JSON.parse(options.body));
  assert.equal((await call(env,'evaluate_us_candidates',args)).isError,true);
  const replay=data(await call(env,'evaluate_us_candidates',{...args,replay:true}));assert.equal(replay.mode,'retrospective');assert.equal(replay.prospective,false);
 }finally{globalThis.fetch=original;db.sqlite.close()}
});

test('large JEV candidate sets are fully batched and a later failed batch cannot publish a partial ranking',async()=>{
 const db=database(),original=globalThis.fetch;let calls=0;
 try{
  const packet=await pilotAccount(db),a=await readAccount(db);
  const symbols=['AAPL','MSFT','NVDA','AMZN','GOOGL','JPM','TSLA','XOM','META'];
  packet.candidates=symbols.map(symbol=>({...packet.candidates[0],symbol}));
  const idea=a.state.externalResearch.investmentIdeas[0];idea.candidates=symbols.map(symbol=>({symbol,reason:'Test infrastructure'}));idea.referenceIndex.constituents=symbols;await writeAccount(db,a,a.state);
  const args={stage:'discovery',ideaId:'us-test',packet,useJev:true},env={AUTH_PROVIDER:'sites',DB:db,TYPESAFE_API_KEY:'SECRET'};
  globalThis.fetch=async(_url,options)=>{
   calls++;const body=JSON.parse(options.body);assert.ok(body.state.candidates.length<=8);assert.ok(JSON.stringify(body.state).length<=24000);assert.ok(options.body.length<=60000);
   return pilotResponse(body);
  };
  const whole=data(await call(env,'evaluate_us_candidates',args));assert.equal(whole.candidates.length,9);assert.equal(whole.metrics.requests,2);assert.equal(whole.metrics.inputTokens,800);assert.equal(calls,2);
  globalThis.fetch=async(_url,options)=>{calls++;return calls===4?new Response('Provider failure',{status:529}):pilotResponse(JSON.parse(options.body))};
  const next={...args,packet:{...packet,concept:'Second complete hypothesis'}};
  const failed=data(await call(env,'evaluate_us_candidates',next));assert.equal(failed.status,'error');assert.equal(failed.completedBatches,1);assert.equal(failed.knownInputTokens,400);assert.equal(failed.packet.candidates.length,9);assert.equal(failed.candidates,undefined);
  await call(env,'evaluate_us_candidates',next);assert.equal(calls,4);
 }finally{globalThis.fetch=original;db.sqlite.close()}
});

test('rounded JEV score distributions remain usable while materially inconsistent scores are rejected',async()=>{
 const db=database(),original=globalThis.fetch;
 try{
  const packet=await pilotAccount(db),env={AUTH_PROVIDER:'sites',DB:db,TYPESAFE_API_KEY:'SECRET'},args={stage:'discovery',ideaId:'us-test',packet,useJev:true};
  globalThis.fetch=async(_url,options)=>pilotResponse(JSON.parse(options.body),r=>{
   for(const a of Object.values(r.answers)){a.score=2;a.confidence=.5;a.probabilities={'0':0,'1':.33,'2':.33,'3':.33,'4':0};}
  });
  const rounded=data(await call(env,'evaluate_us_candidates',args));assert.equal(rounded.status,'evaluated');assert.equal(rounded.candidates.length,2);assert.ok(rounded.candidates.every(c=>c.assessment==='needs_research'));
  globalThis.fetch=async(_url,options)=>pilotResponse(JSON.parse(options.body),r=>{Object.values(r.answers)[0].score=2});
  const bad=data(await call(env,'evaluate_us_candidates',{...args,packet:{...packet,concept:'Different hypothesis'}}));assert.equal(bad.status,'error');assert.equal(bad.knownInputTokens,400);
 }finally{globalThis.fetch=original;db.sqlite.close()}
});

test('US research tool defaults to free collection and rejects non-US symbols before provider access',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{assert.fail('invalid or unconfigured requests must not fetch')};
 try{
  const result=data(await call({AUTH_PROVIDER:'sites'},'collect_us_research',{symbols:['AAPL']}));
  assert.equal(result.market,'us');assert.equal(result.sec.status,'unconfigured');assert.equal(result.jev.status,'disabled');
  assert.equal((await call({AUTH_PROVIDER:'sites'},'collect_us_research',{symbols:['005930'],useJev:true})).isError,true);
  assert.equal((await call({AUTH_PROVIDER:'sites'},'collect_us_research',{symbols:['AAPL'],apiKey:'secret'})).isError,true);
 }finally{globalThis.fetch=original}
});

test('JEV candidate pilot defaults off and cannot mutate investment state or spend without opt-in',async()=>{
 const db=database(),original=globalThis.fetch;
 globalThis.fetch=async()=>assert.fail('Default pilot must not spend');
 try{
  await liveAccount(db);const before=db.sqlite.prepare("SELECT state,revision,metadata FROM paper_account WHERE id='main'").get();
  const result=await call({AUTH_PROVIDER:'sites',DB:db},'evaluate_us_candidates',{stage:'discovery',ideaId:'missing',packet:{}});
  assert.equal(result.isError,undefined);
  assert.equal(data(result).status,'disabled');
  const after=db.sqlite.prepare("SELECT state,revision,metadata FROM paper_account WHERE id='main'").get();assert.deepEqual(after,before);
 }finally{globalThis.fetch=original;db.sqlite.close()}
});

test('data calls require trusted Site identity and reject foreign origins before provider access',async()=>{
 assert.equal((await handleMcp(request('tools/call',{name:'get_research_data'}),{})).status,401);
 assert.equal((await handleMcp(request('tools/list',{}, {origin:'https://attacker.example'}),{})).status,403);
 assert.equal((await handleMcp(request('tools/list',{}, {},'GET'),{})).status,405);
});

test('transport rejects malformed messages, unsupported versions and oversized streamed bodies',async()=>{
 assert.equal((await handleMcp(new Request('https://committee.example/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'{' }),{})).status,400);
 assert.equal((await handleMcp(request('tools/list',{}, {'mcp-protocol-version':'invalid'}),{})).status,400);
 let cancelled=false;
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(500001))},pull(controller){controller.close()},cancel(){cancelled=true}},{highWaterMark:0});
 const oversized=new Request('https://committee.example/mcp',{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'});
 assert.equal((await handleMcp(oversized,{})).status,413);
 assert.equal(cancelled,true);
});

test('querying an empty account never initializes or writes a demonstration account',async()=>{
 const db=database();
 try{const result=await call({AUTH_PROVIDER:'sites',DB:db},'get_investment_context');assert.equal(result.isError,true);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM paper_account').get().n,0)}finally{db.sqlite.close()}
});

test('stored market data preserves quote time, bounds history, marks expired data and never changes account revision',async()=>{
 const db=database();
 try{
  await liveAccount(db);const before=await readAccount(db);
  const result=data(await call({AUTH_PROVIDER:'sites',DB:db},'get_market_data',{symbols:['AAPL'],historyBars:2}));
  assert.equal(result.origin,'stored_python_collection');assert.equal(result.freshness.status,'stale');
  assert.equal(result.freshness.maxAgeSeconds,1800);assert.equal(result.quotes.AAPL.price,100);
  assert.equal(result.quotes.AAPL.time,before.state.marketData.quotes.AAPL.time);
  assert.equal(result.data.AAPL.length,2);assert.ok(result.sources.some(s=>s.url==='https://finance.yahoo.com/quote/AAPL/history/'));
  const after=await readAccount(db);assert.equal(after.revision,before.revision);assert.deepEqual(after.state.trades,before.state.trades);
  const invalid=await call({AUTH_PROVIDER:'sites',DB:db},'get_market_data',{symbols:['AAPL'],historyBars:261});assert.equal(invalid.isError,true);
  assert.equal((await call({AUTH_PROVIDER:'sites',DB:db},'get_market_data',{symbols:['NOT_A_SYMBOL']})).isError,true);
  assert.equal((await call({AUTH_PROVIDER:'sites',DB:db},'get_market_data',{symbols:['AAPL','AAPL']})).isError,true);
 }finally{db.sqlite.close()}
});

test('demo prices cannot masquerade as observed market data and missing stored quotes remain unavailable',async()=>{
 const db=database();
 try{
  await readAccount(db);const demo=data(await call({AUTH_PROVIDER:'sites',DB:db},'get_market_data',{symbols:['AAPL']}));
  assert.equal(demo.status,'unavailable');assert.deepEqual(demo.quotes,{});assert.deepEqual(demo.data,{});
  await liveAccount(db);const missing=data(await call({AUTH_PROVIDER:'sites',DB:db},'get_market_data',{symbols:['MSFT']}));
  assert.equal(missing.status,'partial');assert.deepEqual(missing.quotes,{});assert.deepEqual(missing.data,{});assert.deepEqual(missing.unavailableSymbols,['MSFT']);
 }finally{db.sqlite.close()}
});

test('financial collection time survives validation and stale stored approval is never current approval',async()=>{
 const db=database();
 try{
  await liveAccount(db);const account=await readAccount(db),fetchedAt=new Date(Date.now()-31*86400000).toISOString();
  const review=fundamentalReview('AAPL',{periodEnd:'2026-03-31',periodType:'12M',currency:'USD',fetchedAt,sources:[{title:'Yahoo',url:'https://finance.yahoo.com/quote/AAPL/financials/'}],metrics:{revenue:100,priorRevenue:90,netIncome:20,equity:100,eps:10,debt:10,operatingCashFlow:25}}, {price:100});
  assert.equal(review.fetchedAt,fetchedAt);account.state.fundamentals={AAPL:{...review,pass:true}};
  await writeAccount(db,account,account.state);
  const result=data(await call({AUTH_PROVIDER:'sites',DB:db},'get_fundamentals',{symbols:['AAPL']}));
  assert.equal(result.fundamentals.AAPL.storedPass,true);assert.equal(result.fundamentals.AAPL.pass,false);assert.equal(result.fundamentals.AAPL.freshness.status,'stale');
  account.state.fundamentals.AAPL.fetchedAt=null;await writeAccount(db,await readAccount(db),account.state);
  assert.equal(data(await call({AUTH_PROVIDER:'sites',DB:db},'get_fundamentals',{symbols:['AAPL']})).fundamentals.AAPL.freshness.status,'unknown');
 }finally{db.sqlite.close()}
});

test('provider selection avoids unrelated fetches and bounded output preserves scope and credential-free sources',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async url=>{
  assert.equal(new URL(url).host,'opendart.fss.or.kr');
  return Response.json({status:'000',total_count:2,total_page:1,list:[1,2].map(i=>({corp_name:'Company '+i,stock_code:'005930',report_nm:'Report '+i,rcept_dt:'20261005',rcept_no:'2026100500000'+i}))});
 };
 try{
  const result=data(await call({AUTH_PROVIDER:'sites',DART_API_KEY:'SECRET_DART',FRED_API_KEY:'SECRET_FRED'},'get_research_data',{providers:['DART'],reportLimit:1}));
  assert.deepEqual(Object.keys(result.providers),['DART']);assert.equal(result.providers.DART.reports.length,1);assert.equal(result.providers.DART.truncated,true);assert.equal(result.providers.DART.total,2);
  assert.ok(!JSON.stringify(result).includes('SECRET_'));
  assert.equal((await call({AUTH_PROVIDER:'sites'},'get_research_data',{providers:['UNKNOWN']})).isError,true);
 }finally{globalThis.fetch=original}
});

test('company paging is bounded and research preflight reuses validation without trading or saving',async()=>{
 const db=database();
 try{
  await liveAccount(db);const before=await readAccount(db);
  const universe=data(await call({AUTH_PROVIDER:'sites',DB:db},'list_companies',{country:'미국',limit:2,offset:1}));
  assert.equal(universe.companies.length,2);assert.equal(universe.total,503);assert.equal(universe.nextOffset,3);assert.ok(universe.companies.every(c=>c.country==='미국'));
  const check=data(await call({AUTH_PROVIDER:'sites',DB:db},'check_research',{research:{sources:[]}}));assert.equal(check.complete,false);assert.ok(check.missing.length);
  const context=data(await call({AUTH_PROVIDER:'sites',DB:db},'get_investment_context'));assert.equal(context.lastResearch,undefined);assert.equal(context.departments,undefined);
  assert.equal((await readAccount(db)).revision,before.revision);
 }finally{db.sqlite.close()}
});
test('initial MCP preflight uses v5 for a sourced cash watch decision without a write',async()=>{
 const db=database();try{
  const a=await readAccount(db),raw={asOf:new Date().toISOString(),topDown:'산업 후보 없음',bottomUp:'기업 검토 대상 없음',marketReview:'시장 관찰',decision:'현금 관찰',limitations:'시험',sources:[{title:'관찰 근거',url:'https://example.com/evidence'}],investmentIdeas:[],trendUnits:[],macroScorecard:[],departmentResearch:{}};
  const checked=data(await call({AUTH_PROVIDER:'sites',DB:db},'check_research',{research:raw}));assert.equal(checked.complete,true);assert.equal(checked.stages.ideas,'watch');assert.equal((await readAccount(db)).revision,a.revision);
 }finally{db.sqlite.close()}
});

test('host-built JEV packets from saved research pass the server contract in both replay stages',async()=>{
 const db=database(),original=globalThis.fetch;
 try{
  const packet=await pilotAccount(db),a=await readAccount(db);a.state.externalResearch.investmentIdeas[0].managementReview={status:'watch',reason:'Reviewed',sourceUrls:[pilotSource]};await writeAccount(db,a,a.state);
  const {asOf,candidates,...idea}=packet,research=(await readAccount(db)).state.externalResearch;
  const {packets,skipped}=jevPackets(research,{ideas:[{ideaId:'us-test',...idea,candidates:candidates.map(c=>({...c,admissionEvidence:'Fundamental and technical review passed.'}))}]});
  assert.deepEqual(skipped,[]);
  const env={AUTH_PROVIDER:'sites',DB:db,TYPESAFE_API_KEY:'SECRET'};globalThis.fetch=async(_url,options)=>pilotResponse(JSON.parse(options.body));
  for(const stage of ['discovery','admission']){const r=data(await call(env,'evaluate_us_candidates',{stage,ideaId:'us-test',packet:packets[0][stage],useJev:true,replay:true}));assert.equal(r.status,'evaluated',stage);assert.equal(r.mode,'retrospective');}
 }finally{globalThis.fetch=original;db.sqlite.close()}
});
