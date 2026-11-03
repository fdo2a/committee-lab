import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {z} from 'zod';
import {readAccount,context,researchCheck,universeCatalog} from './account.mjs';
import {authenticate} from './auth.mjs';
import {researchData} from './research-data.mjs';
import {collectUsResearch} from './us-research.mjs';
import {evaluateUsCandidates,getJevEvaluations,jevWorkflow} from './jev-candidates.mjs';
import {fundamentalReview} from './fundamentals.mjs';
import {FUNDAMENTALS_MAX_AGE_DAYS} from '../web/fundamentals-freshness.mjs';
import {activeCompanies} from '../web/engine.mjs';
import {eligibleCatalog} from '../web/universe.mjs';

const symbols=z.array(z.string().min(1).max(20)).min(1).max(40)
 .refine(rows=>new Set(rows).size===rows.length,'종목은 중복 없이 지정하세요.').optional();
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const result=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
const error=text=>({content:[{type:'text',text}],isError:true});
function freshness(timestamp,maxAgeSeconds){
 const stamp=typeof timestamp==='string'?Date.parse(timestamp):NaN,age=(Date.now()-stamp)/1000;
 return {fetchedAt:timestamp??null,ageSeconds:Number.isFinite(age)?Math.floor(age):null,maxAgeSeconds,
  status:!Number.isFinite(age)?'unknown':age<0?'invalid':age<maxAgeSeconds?'fresh':'stale'};
}
function selected(state,requested){
 const companies=activeCompanies(state),bySymbol=new Map(companies.map(c=>[c.symbol,c]));
 const rows=requested??companies.map(c=>c.symbol);
 if(rows.length>40||rows.some(s=>!bySymbol.has(s)))throw Error('관찰 중인 종목을 한 번에 최대 40개 조회하세요. get_investment_context에서 관찰 목록을 확인하세요.');
 return rows.map(s=>bySymbol.get(s));
}
const priceSource=c=>({title:c.symbol+' Yahoo 가격',url:'https://finance.yahoo.com/quote/'+encodeURIComponent(eligibleCatalog.find(x=>x.symbol===c.symbol).yahooSymbol)+'/history/'});

function createServer(env){
 const server=new McpServer({name:'committee-investment-lab',version:'1.0.0'},{
  instructions:'비공개 투자 연구용 조회 도구입니다. 가격·재무는 기존 Python 수집기가 저장한 자료이며 실시간 수집 요청이 아닙니다. 출처·수집 시각·가격 관측 시각·freshness·누락 범위를 확인하세요. 산업·시장 발굴 후보를 펀더멘탈부가 검증하고 퀀트부가 서버 계량 순위를 계산하며 기술부가 진입 시점을 확인하고 운용부가 판단합니다. 공시 목록은 원문 재무 검토를 대체하지 않으며 이 도구는 매수·매도 승인이나 체결을 하지 않습니다.',
  maxToolInputElements:20000,
 });
 const account=async()=>{if(!env.DB)throw Error('서버 저장소를 연결하지 못했습니다.');return readAccount(env.DB,false)};
 const tool=(name,description,schema,fn,external=false,writes=false)=>server.registerTool(name,{
  description,inputSchema:z.object(schema).strict(),annotations:{...annotations,openWorldHint:external,readOnlyHint:!writes},
 },async args=>{
  try{return result(await fn(args))}
  catch{return error('조회하지 못했습니다. 입력 종목·자료 존재 여부·서버 연결을 확인하세요. 자료와 가격을 추정해 대체하지 않습니다.')}
 });

 tool('get_investment_context','관찰 종목, 운용 상태, 위험 한도, 조사 절차를 조회합니다. 독립 조사를 위해 이전 부서 의견은 기본적으로 제외합니다.',{
  includeReviews:z.boolean().default(false),
 },async({includeReviews})=>{
  const a=await account(),c=context(a);
  delete c.metadata.jevEvaluations;c.jevWorkflow=jevWorkflow(env);
  if(!includeReviews){for(const key of ['departments','lastResearch','technical','strategyLearning'])delete c[key];delete c.investmentProcess.quantResearch;}
  return {...c,dataMode:a.state.mode,researchReadiness:researchCheck({...a.state,investmentProcessVersion:5}),retrievedAt:new Date().toISOString()};
 });

 tool('get_market_data','관찰 종목의 저장된 Python 가격·환율을 조회합니다. 실시간 재수집은 하지 않습니다. historyBars 기본 0, 최대 260. 수집 신선도와 실제 가격 관측 시각은 별개입니다.',{
  symbols,historyBars:z.number().int().min(0).max(260).default(0),
 },async({symbols:requested,historyBars})=>{
  const a=await account(),s=a.state,rows=selected(s,requested),snapshot=s.mode==='live'?s.marketData:null;
  const available=rows.filter(c=>snapshot?.quotes?.[c.symbol]);
  return {status:!snapshot?'unavailable':available.length===rows.length?'collected':'partial',origin:'stored_python_collection',revision:a.revision,
   provider:snapshot?.provider??null,freshness:freshness(snapshot?.fetchedAt,1800),
   quotes:Object.fromEntries(available.map(c=>[c.symbol,snapshot.quotes[c.symbol]])),
   data:Object.fromEntries(historyBars?available.map(c=>[c.symbol,(s.data[c.symbol]??[]).slice(-historyBars)]):[]),
   fx:snapshot?.fx??null,sources:available.map(priceSource),
   unavailableSymbols:rows.filter(c=>!available.includes(c)).map(c=>c.symbol),
   limitations:'저장된 관측 자료입니다. 30분 이내 수집이어도 가격은 지연·휴장으로 오래됐을 수 있습니다. 미확정 정규장 종가와 출처 없는 가격을 체결 근거로 사용하지 않습니다. 갱신은 기존 Python 수집 절차에서 수행합니다.',
  };
 });

 tool('get_fundamentals','관찰 종목의 저장된 연간 재무·출처·검증을 조회합니다. 원문 검토는 별도이며 storedPass는 과거 판정입니다. 수집 시점이 없거나 '+FUNDAMENTALS_MAX_AGE_DAYS+'일이 지나면 현재 통과로 표시하지 않습니다(연간 재무는 주 1회 재조회).',{symbols},async({symbols:requested})=>{
  const a=await account(),s=a.state,rows=selected(s,requested),fundamentals={};
  for(const c of rows){
   const f=s.mode==='live'?s.fundamentals?.[c.symbol]:null;
   if(!f){fundamentals[c.symbol]={status:'unavailable',pass:false};continue}
   const age=freshness(f.fetchedAt,FUNDAMENTALS_MAX_AGE_DAYS*86400),quote=s.marketData?.quotes?.[c.symbol];
   const current=quote?fundamentalReview(c.symbol,f,quote):null;
   const pass=!!(current?.pass&&f.businessPass&&age.status==='fresh'&&freshness(s.externalResearch?.asOf,36*3600).status==='fresh'&&freshness(s.marketData?.fetchedAt,1800).status==='fresh');
   fundamentals[c.symbol]={...f,status:'stored',storedPass:f.pass,pass,freshness:age,currentChecks:current?.checks??[]};
  }
  return {origin:'stored_python_collection',revision:a.revision,fundamentals,limitations:'저장 자료의 연구용 검증입니다. 현재 통과 표시는 매매 승인이 아니며 최신 분기·공시 원문·새 가격과 기존 위험 심사를 별도로 확인해야 합니다.'};
 });

 tool('get_research_data','DART·EDINET 공시 목록과 FRED 거시 시계열을 지금 조회합니다. 필요한 기관만 지정하세요. 원문 전체·전체 기간이 아니며 제공기관별 누락과 잘린 범위를 반환합니다.',{
  providers:z.array(z.enum(['DART','EDINET','FRED'])).min(1).max(3).refine(rows=>new Set(rows).size===rows.length).default(['DART','EDINET','FRED']),
  reportLimit:z.number().int().min(1).max(100).default(20),
  observationLimit:z.number().int().min(1).max(24).default(6),
 },async({providers,reportLimit,observationLimit})=>{
  const bundle=await researchData(env,providers);
  for(const p of Object.values(bundle.providers)){
   if(p.reports){const count=p.reports.length;p.reports=p.reports.slice(0,reportLimit);p.truncated=!!p.truncated||count>reportLimit;p.returnedCount=p.reports.length;}
   if(p.series)p.series=p.series.map(s=>({...s,observations:(s.observations??[]).slice(0,observationLimit),truncated:(s.observations?.length??0)>observationLimit}));
  }
  return {...bundle,origin:'live_provider_request',scope:{reportLimit,observationLimit}};
 },true);

 tool('collect_us_research','미국 등록 종목 1~5개의 SEC 공시 메타데이터·원문 링크를 수집합니다. 원문 내용은 별도 확인합니다. useJev 기본 false이며 true는 유료 JEV로 읽기 우선순위를 제안합니다. 모든 후보·필수 공시·불확실한 결과를 보존합니다. 자동화에서 임의로 유료 호출을 켜지 마세요.',{
  symbols:z.array(z.string().min(1).max(20)).min(1).max(5),
  query:z.string().min(1).max(500).default('Financial performance, cash flow, material risks and guidance.'),
  useJev:z.boolean().default(false),
 },async args=>collectUsResearch(env,args),true);

 tool('evaluate_us_candidates','미국 원본 후보 전체를 발굴 직후 또는 독립적인 최종 선정 직후 JEV로 비교 평가합니다. useJev 기본 false, true는 유료이며 평가 기록만 저장합니다. 후보·비중·승인·체결은 변경하지 않습니다. 영문 근거 packet 계약은 get_investment_context.jevWorkflow를 확인하세요. 완료된 과거 자료는 replay:true로만 비교합니다.',{
  stage:z.enum(['discovery','admission']),ideaId:z.string().min(1).max(80),packet:z.record(z.string(),z.unknown()),useJev:z.boolean().default(false),replay:z.boolean().default(false),
 },async args=>evaluateUsCandidates(env,args),true,true);
 tool('get_jev_evaluations','최근20개 JEV 후보 발굴·편입 비교 기록과 누락·불일치·사용 토큰을 조회합니다. 과거 재평가는 실제 시점의 평가와 구분합니다.',{},async()=>getJevEvaluations(env));

 tool('list_companies','허용 지수 후보를 국가·이름·종목 기호로 검색합니다. 페이지 기본 20, 최대 100. 후보 목록은 모든 기업을 실제 조사했다는 의미가 아닙니다.',{
  country:z.enum(['한국','미국','일본']).optional(),query:z.string().max(80).default(''),
  offset:z.number().int().min(0).max(928).default(0),limit:z.number().int().min(1).max(100).default(20),
 },async({country,query,offset,limit})=>{
  const catalog=universeCatalog(),term=query.trim().toLowerCase();
  const rows=catalog.companies.filter(c=>(!country||c.country===country)&&(!term||(c.symbol+' '+c.name).toLowerCase().includes(term)));
  return {total:rows.length,indices:catalog.indices.filter(c=>!country||c.country===country),companies:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null};
 });

 tool('check_research','기존의 부서별 조사·출처·매크로·바스켓 검증으로 부족한 근거를 점검합니다. 생략하면 저장된 조사를 검사합니다. 조사 저장·후보 편입·체결은 하지 않습니다.',{
  research:z.record(z.string(),z.unknown()).optional(),
 },async({research})=>{const a=await account();return researchCheck({...a.state,investmentProcessVersion:5},research===undefined?a.state.externalResearch:research)});
 return server;
}

export async function handleMcp(request,env,identity){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 const reject=(message,status)=>Response.json({error:message},{status,headers});
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin)return reject('허용하지 않는 요청 출처입니다.',403);
 if(request.method!=='POST')return new Response(null,{status:405,headers:{...headers,Allow:'POST'}});
 // Tool calls need the verified owner identity. Service credentials never become user identity here.
 const authenticated=(identity??await authenticate(request,env))?.kind==='owner';
 let parsed;
 try{
  if(!request.headers.get('content-type')?.includes('application/json'))return reject('JSON 요청이 필요합니다.',415);
  const reader=request.body?.getReader(),decoder=new TextDecoder();let raw='',bytes=0;
  if(reader)try{
   while(true){
    const {value,done}=await reader.read();if(done)break;
    bytes+=value.byteLength;
    if(bytes>500000){await reader.cancel();return reject('MCP 요청은 500KB 이하여야 합니다.',413)}
    raw+=decoder.decode(value,{stream:true});
   }
   raw+=decoder.decode();
  }finally{reader.releaseLock()}
  parsed=JSON.parse(raw);
 }catch{return reject('JSON 형식 확인 실패',400)}
 if(!authenticated&&!['initialize','notifications/initialized','ping','tools/list'].includes(parsed?.method))return reject('Site 소유자 인증이 필요합니다.',401);
 const server=createServer(env),transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
 try{
  await server.connect(transport);
  const response=await transport.handleRequest(request,{parsedBody:parsed});
  for(const [key,value] of Object.entries(headers))response.headers.set(key,value);
  return response;
 }catch{return reject('MCP 요청을 완료하지 못했습니다.',400)}
 finally{await server.close()}
}
