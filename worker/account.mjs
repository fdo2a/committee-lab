import {markManualReviewed,manualContext} from './manual-candidates.mjs';
import {ETF_ASSETS,ETF_CANDIDATES,applyBondOnlyPolicy,ALLOCATION_POLICY,allocationDecision,allocateAssets,validateAssetSnapshot} from '../web/asset-allocation.mjs';
import {compactReports} from './market-reports.mjs';
import {cleanInvestmentProcess,unitSnapshot,unitPerformance} from '../web/trend-units.mjs';
import {quantMethod} from '../web/quant-research.mjs';
import {weeklyStrategySnapshot} from './weekly-reports.mjs';
import {researchReadiness,departmentReadiness} from './research-readiness.mjs';
import {fundamentalReview} from './fundamentals.mjs';
import {FUNDAMENTALS_CHECK_NAME,FUNDAMENTALS_MAX_AGE_DAYS,FUNDAMENTALS_RECHECK_DAYS,fundamentalsCurrent} from '../web/fundamentals-freshness.mjs';
import {learningReview,departmentReviews} from './department-reviews.mjs';
import {researchDepartments,businessResearch} from '../web/committee.mjs';
import {enableRegularExecution,executionBasis} from '../web/execution.mjs';
import {validateMarket} from './market-data.mjs';
import {indexCatalog,eligibleCatalog} from '../web/universe.mjs';
export const PIPELINE_VERSION=5;
import {
  createState,
  validateState,
  analyze,analysisReports,refreshQuantAnalysis,
  advance,
  approve,
  equity,
  exposure,
  drawdown,
  unrealized,
  companies,
  activeCompanies,
  requestExit,
  markPrice,fxOf,
} from "../web/engine.mjs";
export const INTERVAL = 4 * 60 * 60 * 1000,
  OFFSET = 9 * 60 * 60 * 1000;
export const slotFor = (now) => Math.floor((now + OFFSET) / INTERVAL);
export const isTradingWeekday=now=>![0,6].includes(new Date(now+OFFSET).getUTCDay());
const sessionFormats=Object.fromEntries(['asia','us'].map(market=>[market,new Intl.DateTimeFormat('en',{timeZone:market==='us'?'America/New_York':'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})]));
const japanCalendarSource='https://www.jpx.co.jp/english/corporate/about-jpx/calendar/index.html';
// shortcut: JPX cash-market holidays verified for 2026–2027; refresh before Japanese trading in later years.
const japanHolidays={
 2026:['01-01','01-02','01-03','01-12','02-11','02-23','03-20','04-29','05-03','05-04','05-05','05-06','07-20','08-11','09-21','09-22','09-23','10-12','11-03','11-23','12-31'],
 2027:['01-01','01-02','01-03','01-11','02-11','02-23','03-21','03-22','04-29','05-03','05-04','05-05','07-19','08-11','09-20','09-23','10-11','11-03','11-23','12-31'],
};
export function sessionFor(market,phase='auto',now=Date.now(),riskOnly=false){
 if(!['asia','us'].includes(market)||!['auto','pre','open','close'].includes(phase))throw Error('시장과 운용 단계 확인 필요');
 const zone=market==='us'?'America/New_York':'Asia/Seoul';
 const p=Object.fromEntries(sessionFormats[market].formatToParts(new Date(now)).map(p=>[p.type,p.value]));
 const date=`${p.year}-${p.month}-${p.day}`,minute=Number(p.hour)*60+Number(p.minute),open=market==='us'?570:540,close=market==='us'?960:930;
 // Risk monitoring follows the current phase even when collection crosses its boundary.
 if(phase==='auto'||riskOnly)phase=minute<open?'pre':minute<close?'open':'close';
 const delay=riskOnly?0:15;
 const weekday=new Date(date+'T00:00:00Z').getUTCDay();
 if([0,6].includes(weekday)||(phase==='pre'?(minute<open-60||minute>=open):phase==='open'?(minute<open+delay||minute>=close):minute<close+delay))throw Error('해당 시장의 운용 단계 시각이 아닙니다.');
 const holidays=japanHolidays[p.year],closedCountries=market==='asia'&&(!holidays||holidays.includes(date.slice(5)))?[{country:'일본',reason:holidays?'exchangeHoliday':'calendarUnavailable',source:japanCalendarSource}]:[];
 return {market,phase,date,zone,minute,countries:market==='us'?['미국']:closedCountries.length?['한국']:['한국','일본'],closedCountries,key:`${market}:${date}:${phase}`,slot:Date.parse(date+'T00:00:00Z')/86400000*10+(market==='us'?5:0)+['pre','open','close'].indexOf(phase)};
}
export const nextRun = (now,sessionMode=false) => {
 if(sessionMode){
  // ponytail: normal-session schedule; the updater verifies actual holidays/shortened sessions before trading.
  for(let next=Math.floor(now/600000)*600000+600000;next<now+7*86400000;next+=600000){
   for(const market of ['asia','us']){try{const r=sessionFor(market,'auto',next);if((market==='asia'?[480,560,960]:[510,590,990]).includes(r.minute))return new Date(next).toISOString()}catch{}}
  }
 }
  let next=(slotFor(now)+1)*INTERVAL-OFFSET;
  while(!isTradingWeekday(next))next+=INTERVAL;
  return new Date(next).toISOString();
};
// D1 caps any string or row at 2MB. States above PART_BYTES are split into paper_account_part rows and the main row keeps a pointer.
const PART_BYTES=1_000_000,POINTER=/^\{"parts":\d+,"set":"[0-9a-f-]{36}"\}$/;
function statePieces(json){
  if(new TextEncoder().encode(json).length<=PART_BYTES)return {stored:json,parts:[]};
  // Slice by UTF-16 units: 400k units stay under 2MB even when every character is 3 bytes.
  const parts=[];
  for(let start=0;start<json.length;){
    let end=Math.min(json.length,start+400000);
    if(end<json.length&&json.charCodeAt(end-1)>=0xd800&&json.charCodeAt(end-1)<=0xdbff)end--;
    parts.push(json.slice(start,end));start=end;
  }
  return {stored:JSON.stringify({parts:parts.length,set:crypto.randomUUID()}),parts};
}
async function storeParts(db,id,stored,parts){
  const set=parts.length?JSON.parse(stored).set:null;
  for(const [part,body] of parts.entries())await db.prepare('INSERT INTO paper_account_part (id,part_set,part,body) VALUES (?,?,?,?)').bind(id,set,part,body).run();
  return set;
}
async function loadStoredState(db,row){
  if(!POINTER.test(row.state))return {json:row.state,set:null};
  const pointer=JSON.parse(row.state),r=await db.prepare('SELECT body FROM paper_account_part WHERE id = ? AND part_set = ? ORDER BY part').bind(row.id,pointer.set).all();
  // Fail closed: a pointer without its parts must never look like an empty account.
  if(r.results.length!==pointer.parts)throw Error('저장된 계좌 조각을 찾지 못했습니다.');
  return {json:r.results.map(x=>x.body).join(''),set:pointer.set};
}
export async function readAccount(db, initialize = true) {
  let row = await db
    .prepare("SELECT * FROM paper_account WHERE id = ?")
    .bind("main")
    .first();
  if (!row) {
    if (!initialize) throw Error('저장된 계좌가 없습니다.');
    const s = createState(),
      now = new Date().toISOString();
    await db
      .prepare(
        "INSERT OR IGNORE INTO paper_account (id,state,revision,metadata,updated_at) VALUES (?,?,?,?,?)",
      )
      .bind(
        "main",
        JSON.stringify(s),
        1,
        JSON.stringify({
          enabled: false,
          runCount: 0,
          lastRun: null,
          lastSlot: null,
        }),
        now,
      )
      .run();
    row = await db
      .prepare("SELECT * FROM paper_account WHERE id = ?")
      .bind("main")
      .first();
  }
  const metadata = JSON.parse(row.metadata);
  if (metadata.intervalHours !== 4) {
    const last = Date.parse(metadata.lastRun);
    metadata.lastSlot = Number.isFinite(last) ? slotFor(last) : null;
    metadata.intervalHours = 4;
  }
  const stored=await loadStoredState(db,row);
  const state=validateState(applyBondOnlyPolicy(JSON.parse(stored.json)));
  // Migrate only recorded legacy risk decisions; explicit discretionary flags remain authoritative.
  for(const p of state.plans)if(p.riskExit===undefined&&p.status==='승인'&&['sell','cover'].includes(p.side)&&(
    ['사전 승인 손절 · 정규장 청산 대기','사전 승인 목표가 · 정규장 청산 대기','증거금 부족: 다음 정규장 가격에서 숏 상환'].includes(p.reason)||
    p.unitExit===true&&['유닛 손실 한도 전액 도달','유닛 목표수익 도달','유닛 투자기한 도래','유닛 손실 한도 50% 도달: 절반 축소'].includes(p.reason)
  ))p.riskExit=true;
  for(const asset of ETF_ASSETS.filter(a=>a.enabled===false)){
    const p=state.assetAllocation?.positions[asset.symbol]?.pending;
    if(p?.side==='sell'&&p.status==='승인'&&p.riskExit===undefined)p.riskExit=true;
  }
  if(state.mode==='live'){state.investmentProcessVersion=5;enableRegularExecution(state);state.analysis.reports=analysisReports(state);refreshQuantAnalysis(state);state.analysis.researchReadiness=researchCheck(state);}
  return {
    state,
    revision: row.revision,
    metadata,
    updatedAt: row.updated_at,
    ...(stored.set?{partSet:stored.set}:{}),
  };
}
export function operatorExceptionStatus(env,current,now=Date.now()){
 try{
  const grant=JSON.parse(env.OPERATOR_REVIEW_EXCEPTION);
  if(!grant||typeof grant.id!=='string'||!/^[\w-]{8,64}$/.test(grant.id)||!Number.isSafeInteger(grant.issuedAt)||!Number.isSafeInteger(grant.expiresAt)||grant.issuedAt>now||grant.expiresAt<=now||grant.expiresAt<=grant.issuedAt||grant.expiresAt-grant.issuedAt>7*86400000)return {status:'unavailable'};
  const saved=current.metadata.operatorReviewException;
  if(!saved||saved.id!==grant.id)return {...grant,status:'pending'};
  return {...saved,status:now>=saved.expiresAt?'expired':saved.completedScopes?.length===2?'completed':'active'};
 }catch{return {status:'unavailable'}}
}
export function verifyOperatorException(input,scope,env,current,now=Date.now()){
 const held={approved:false,reason:'operatorExceptionUnavailable'},grant=operatorExceptionStatus(env,current,now);
 if(!['/api/run','/api/allocation'].includes(scope)||input.reviewProof||input.operatorException!==grant.id||!['pending','active'].includes(grant.status)||current.metadata.paused||input.expectedRevision!==current.revision||grant.completedScopes?.includes(scope))return held;
 try{
  const session=sessionFor(input.market,input.phase,now);
  if(input.phase==='auto'||!input.phase||grant.status==='pending'&&session.phase!=='pre'||grant.status==='active'&&(grant.market!==session.market||grant.date!==session.date))return held;
  const expiresAt=Math.min(grant.expiresAt,now-now%60000+(1440-session.minute)*60000);
  const exception={id:grant.id,market:session.market,date:session.date,expiresAt,completedScopes:grant.completedScopes??[]};
  return {approved:true,reason:'userAuthorizedException',reviewer:'operator-exception',exception,issuedAt:now,expiresAt};
 }catch{return held}
}
function recordOperatorException(current,approval,scope,session,complete){
 if(approval.reviewer!=='operator-exception'||!approval.approved)return;
 const exception={...approval.exception,completedScopes:[...approval.exception.completedScopes]};
 if(session.phase==='close'&&complete&&!exception.completedScopes.includes(scope))exception.completedScopes.push(scope);
 current.metadata.operatorReviewException=exception;
}
export async function writeAccount(
  db,
  current,
  state,
  metadata = current.metadata,
) {
  validateState(state);
  const now = new Date().toISOString();
  // Parts go in first so a pointer never references missing rows; a lost race only leaves orphan parts, cleaned below.
  const {stored,parts}=statePieces(JSON.stringify(state)),set=await storeParts(db,"main",stored,parts);
  const result = await db
    .prepare(
      "UPDATE paper_account SET state = ?, metadata = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
    )
    .bind(
      stored,
      JSON.stringify(metadata),
      now,
      "main",
      current.revision,
    )
    .run();
  if (result.meta.changes !== 1) {
    if(set)await db.prepare('DELETE FROM paper_account_part WHERE id = ? AND part_set = ?').bind("main",set).run();
    const e = Error(
      "다른 실행이 계좌를 갱신했습니다. 최신 상태에서 다시 시도하세요.",
    );
    e.status = 409;
    throw e;
  }
  // Keep the previous set for readers that already hold its pointer; drop everything older.
  if(set||current.partSet)await db.prepare('DELETE FROM paper_account_part WHERE id = ? AND part_set NOT IN (?,?)').bind("main",set??'',current.partSet??'').run();
  return { state, revision: current.revision + 1, metadata, updatedAt: now, ...(set?{partSet:set}:{}) };
}
export function cleanResearch(input) {
  if (input === undefined) return null;
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("조사 자료 형식이 올바르지 않습니다.");
  const sources = input.sources;
  if (!Array.isArray(sources) || sources.length > 300)
    throw Error("출처는 최대 300개입니다.");
  const text = (x, max = 12000) => {
    // Name the value so the research model can find the field; it is the model's own text, never account data.
    if (typeof x !== "string" || x.length > max)
      throw Error("조사 텍스트 형식이 올바르지 않습니다. 문자열 최대 " + max + "자 필요, 받은 값 " + (typeof x) + " " + JSON.stringify(x === undefined ? null : x).slice(0, 120));
    return x;
  };
  if(input.screening!==undefined&&!Array.isArray(input.screening))throw Error('후보 조사 형식 오류');
  const screening = (input.screening || []).map((c) => {
    if (
      !companies.some((x) => x.symbol === c.symbol) ||
      !["allow", "watch", "avoid"].includes(c.stance) ||
      !["topDownScore"].every(
        (k) => c[k]===null || (Number.isFinite(c[k]) && c[k] >= 0 && c[k] <= 100),
      )
    )
      throw Error("후보 조사 값이 올바르지 않습니다.");
    return {
      symbol: c.symbol,
      stance: c.stance,
      topDownScore: c.topDownScore,
      bottomUpScore: Number.isFinite(c.bottomUpScore)?c.bottomUpScore:null,
      bottomUpPass:c.bottomUpPass===true,
      reason: text(c.reason, 2000),
      topDownReason:text(c.topDownReason??'시장·산업 조사 근거 미확인',3000),
      bottomUpReason:text(c.bottomUpReason??'사업·경쟁력 조사 근거 미확인',3000),
      fundamentalReview:text(c.fundamentalReview??'공시 수치·밸류에이션 검증 미확인',5000),
      fundamentalPass:c.fundamentalPass===true&&typeof c.fundamentalReview==='string'&&c.fundamentalReview.trim().length>0&&sources.length>0,
      sourceUrls:Array.isArray(c.sourceUrls)?c.sourceUrls.filter(u=>typeof u==='string'&&sources.some(s=>s.url===u)).slice(0,6):[],
      exit:c.exit===true,
      risks:text(c.risks??'추가 검토 필요',3000),
    };
  });
  if (
    screening.length > companies.length ||
    new Set(screening.map((c) => c.symbol)).size !== screening.length
  )
    throw Error(`후보 조사는 중복 없이 ${companies.length}개 이하여야 합니다.`);
  const departmentResearch={};
  if(input.departmentResearch!==undefined){
    const submitted=input.departmentResearch;
    if(!submitted||typeof submitted!=='object'||Array.isArray(submitted)||Object.keys(submitted).some(k=>!researchDepartments.includes(k)))throw Error('부서별 조사 형식 오류');
    for(const department of researchDepartments){
      if(submitted[department]===undefined)continue;
      const rows=submitted[department];
      if(!Array.isArray(rows)||rows.length>companies.length)throw Error(`부서별 조사는 ${companies.length}개 이하여야 합니다.`);
      departmentResearch[department]=rows.map(c=>{
        if(!c||!companies.some(x=>x.symbol===c.symbol)||!['allow','watch','avoid'].includes(c.stance)||!(c.score===undefined||c.score===null||(Number.isFinite(c.score)&&c.score>=0&&c.score<=100))){
         // 2026-10-28: a bare error left the researcher guessing for five rounds over one stance:'buy'; name the row, the field and the allowed values.
         const symbol=typeof c?.symbol==='string'?c.symbol.slice(0,20):null,field=!symbol||!companies.some(x=>x.symbol===symbol)?'symbol':!['allow','watch','avoid'].includes(c.stance)?'stance':'score';
         throw Object.assign(Error('부서별 조사 값 오류'),{researchGap:{stage:department,ideaId:typeof c?.ideaId==='string'?c.ideaId.slice(0,80):null,region:companies.find(x=>x.symbol===symbol)?.country??null,kind:'validation',field:department+'.'+(symbol??'?')+'.'+field,symbol,reason:field==='symbol'?'등록 Universe에 없는 종목입니다.':field==='stance'?'stance는 allow|watch|avoid만 허용합니다(입력값: '+String(c.stance).slice(0,40)+').':'score는 0~100 숫자 또는 null이어야 합니다.'}});
        }
        if(!Array.isArray(c.sourceUrls)||c.sourceUrls.length>6||c.sourceUrls.some(u=>typeof u!=='string'||!sources.some(s=>s.url===u)))throw Object.assign(Error('부서별 출처는 최대 6개이며 전체 출처 목록에 있어야 합니다.'),{researchGap:{stage:department,ideaId:typeof c.ideaId==='string'?c.ideaId:null,region:companies.find(x=>x.symbol===c.symbol).country,kind:'validation',field:department+'.'+c.symbol+'.sourceUrls',symbol:c.symbol,reason:'전체 목록에 등록한 출처를 행마다 최대 6개 사용해야 합니다.'}});
        if(c.revisedStance!==undefined&&(!['allow','watch','avoid'].includes(c.revisedStance)||typeof c.revisionReason!=='string'||!c.revisionReason.trim()))throw Error('의견 수정에는 수정 이유가 필요합니다.');
        return {symbol:c.symbol,...(c.ideaId!==undefined?{ideaId:text(c.ideaId,80)}:{}),stance:c.stance,score:c.score??null,reason:text(c.reason,3000),sourceUrls:[...c.sourceUrls],risks:text(c.risks??'추가 확인 필요',3000),businessPass:department==='fundamental'&&c.businessPass===true,
          ...(c.revisedStance!==undefined?{revisedStance:c.revisedStance,revisionReason:text(c.revisionReason,3000)}:{})};
      });
      if(new Set(rows.map(x=>`${x.ideaId??''}:${x.symbol}`)).size!==rows.length)throw Error('부서별 아이디어·종목이 중복되었습니다.');
    }
  }
  return {
    screening,
    departmentResearch,
    ...cleanInvestmentProcess(input,companies.map(c=>c.symbol),sources,text),
    asOf: text(input.asOf, 80),
    topDown: text(input.topDown),
    bottomUp: text(input.bottomUp),
    decision: text(input.decision),
    marketReview:text(input.marketReview??'금리·뉴스 추가 확인 필요'),
    marketReportReview:input.marketReportReview?text(input.marketReportReview,6000):null,
    riskReview:text(input.riskReview??'외부 위험 반대 근거 추가 확인 필요'),
    limitations: text(input.limitations),
    sources: sources.map((s) => {
      const u = new URL(text(s.url, 2048));
      if (u.protocol !== "https:") throw Error("HTTPS 출처만 허용합니다.");
      return { title: text(s.title, 300), url: u.href };
    }),
  };
}
export function researchCheck(state,input=state.externalResearch,now=Date.now()){
  try{return researchReadiness(state,input==null?null:cleanResearch(input),now)}
  catch(error){if(state.investmentProcessVersion>=5||input?.investmentIdeas?.length)return {complete:false,missing:[error.researchGap??{stage:'ideas',region:null,kind:'validation',field:'research',reason:'컨셉 후보·기업·기술 검토 연결·최종 바스켓·비중·참조지수·등록 HTTPS 출처 형식 확인 필요 ('+String(error.message).slice(0,300)+')'}],regions:[],stages:{ideas:'pending',fundamental:'pending',technical:'pending',management:'pending'}};return {complete:false,missing:[...departmentReadiness(input,activeCompanies(state)),{region:null,kind:'validation',field:'research',reason:'부서 조사·매크로·2~20개 바스켓·비중·참조지수·HTTPS 출처 형식 확인 필요'}],regions:[]}}
}
function preserveApprovedEntryResearch(state){
 if(state.plans.some(p=>p.status==='승인'&&['buy','short'].includes(p.side))){
  const error=Error('승인 주문의 조사 근거는 서명된 운용 요청으로만 변경할 수 있습니다.');error.status=409;throw error;
 }
}
// Enrich research in an already consumed slot without quotes, approval or execution.
export function prepareResearch(current,input,now=Date.now()){
  preserveApprovedEntryResearch(current.state);
  const s=current.state,clean=cleanResearch(input);s.investmentProcessVersion=5;const readiness=researchCheck(s,clean,now);
  s.externalResearch=clean;
  clean.fresh=Number.isFinite(Date.parse(clean.asOf))&&Math.abs(now-Date.parse(clean.asOf))<36*3600000;
  for(const c of activeCompanies(s)){
    const f=s.fundamentals?.[c.symbol];if(!f)continue;
    const business=businessResearch(s,c.symbol);
    f.businessPass=clean.fresh&&business?.businessPass===true&&business.sourceUrls.length>0;
    const numeric=(f.checks||[]).filter(x=>x.name!=='최신 바텀업 사업·공시 검토');
    // Research without a new collection re-ages the stored numbers; price freshness is checked at execution, not here.
    const collection=numeric.find(x=>x.name===FUNDAMENTALS_CHECK_NAME);
    if(collection)collection.pass=fundamentalsCurrent(f,now);
    f.checks=[...numeric,{name:'최신 바텀업 사업·공시 검토',pass:f.businessPass}];
    f.numericPass=numeric.length>0&&numeric.every(x=>x.pass);
    f.pass=f.numericPass&&f.businessPass;
  }
  analyze(s,now);s.analysis.researchReadiness=readiness;s.researchPreparedAt=new Date(now).toISOString();
  return readiness;
}
// An expansion prepares sourced observations, without placing orders or consuming a run slot.
export function prepareUniverse(current,input,financials,researchInput,now=Date.now()){
 preserveApprovedEntryResearch(current.state);
 const snapshot=validateMarket(input);
 if(snapshot.activeSymbols.some(symbol=>!eligibleCatalog.some(c=>c.symbol===symbol)))throw Error('허용 지수 안의 전체 실제 가격을 확인하세요.');
 const required=[...current.state.holdings,...current.state.plans.filter(p=>p.status==='승인')];
 if(required.some(p=>!snapshot.activeSymbols.includes(p.symbol)))throw Error('기존 보유와 승인 주문 종목의 가격을 유지하세요.');
 const candidate=structuredClone(current.state);
 candidate.mode='live';candidate.universeVersion='indexCatalog';candidate.activeSymbols=snapshot.activeSymbols;candidate.data=snapshot.data;candidate.fx=snapshot.fx;candidate.marketData=snapshot;
 if(researchInput)candidate.externalResearch=cleanResearch(researchInput);
 if(!candidate.executionPolicy)enableRegularExecution(candidate,now);
 refreshFundamentals(candidate,financials,snapshot,now);
 validateState(candidate);
 const readiness=prepareResearch({state:candidate,metadata:current.metadata},candidate.externalResearch??{asOf:new Date(now).toISOString(),topDown:'추가 조사 필요',bottomUp:'추가 조사 필요',decision:'추가 조사 필요',limitations:'독립 조사 미완료',sources:[],departmentResearch:{},macroScorecard:[],trendUnits:[]},now);
 candidate.universePreparedAt=new Date(now).toISOString();
 Object.assign(current.state,candidate);
 return readiness;
}
function refreshFundamentals(s,financials,snapshot,now){
 const stamp=Date.parse(s.externalResearch?.asOf),fresh=Number.isFinite(stamp)&&Math.abs(now-stamp)<36*3600000;
 if(s.externalResearch)s.externalResearch.fresh=fresh;
 // The runner only sends stocks it re-read this run; the rest keep the stored numbers, as does a Yahoo miss ('unavailable').
 const previous=s.fundamentals??{};
 s.fundamentals=Object.fromEntries(activeCompanies(s).map(c=>{const fresh=financials?.[c.symbol];return [c.symbol,fundamentalReview(c.symbol,typeof fresh?.fetchedAt==='string'?fresh:previous[c.symbol],snapshot.quotes[c.symbol],now)];}));
 for(const c of activeCompanies(s)){
  const f=s.fundamentals[c.symbol],business=businessResearch(s,c.symbol);
  f.businessPass=fresh&&business?.businessPass===true&&business.sourceUrls.length>0;
  f.numericPass=f.pass;f.pass=f.numericPass&&f.businessPass;
  if(!f.businessPass)f.checks.push({name:'최신 바텀업 사업·공시 검토',pass:false});
 }
}
export function reviewPolicy(s) {
  const sells = (s.investmentProcessVersion>=4 ? [...(s.trendUnits||[]).filter(u=>u.status==='closed').map(u=>({pnl:u.realizedPnl,date:u.closedAt})),...s.trades.filter(t=>!t.unitId&&["sell","cover"].includes(t.side))].sort((a,b)=>String(b.date).localeCompare(String(a.date))) : s.trades.filter((t) => ["sell","cover"].includes(t.side))).slice(0, 10),
    old = s.policy?.riskScale ?? 1;
  let scale = old,
    reason = "기존 기준 유지";
  if (sells.length >= 3 && sells.slice(0, 3).every((t) => t.pnl < 0)) {
    scale = 0.5;
    reason = "최근 청산 3건 연속 손실: 신규 투자 규모 50%로 축소";
  } else if (sells.length >= 5 && sells.reduce((a, t) => a + t.pnl, 0) < 0) {
    scale = 0.75;
    reason = "최근 청산 합산 손실: 신규 투자 규모 75%로 축소";
  } else if (
    sells.length >= 5 &&
    sells.reduce((a, t) => a + t.pnl, 0) > 0 &&
    sells.filter((t) => t.pnl > 0).length / sells.length >= 0.6
  ) {
    scale = 1;
    reason = "최근 5건 이상에서 합산 이익·승률 60% 이상: 기본 규모 복귀";
  }
  s.policy = {
    version: (s.policy?.version ?? 1) + (scale !== old ? 1 : 0),
    riskScale: scale,
    reason,
    reviewedAt: new Date().toISOString(),
  };
  if (scale !== old)
    s.events.unshift({
      date: s.date,
      text: `운용 기준 v${s.policy.version}: ${reason}`,
    });
  return s.policy;
}
export function autonomousCycle(s, researchInput, now = Date.now(),snapshot=null,financials=null,session=null,logicReview={approved:true}) {
  if(!logicReview.approved)researchInput=null;
  const decisionPhase=!session||session.phase==='pre';
  const before = { equity: equity(s), trades: s.trades.length, date: s.date };
  const reviewedExitIds=new Set();
  let rejectedResearch=null;
  if (researchInput) {
    try{s.externalResearch = cleanResearch(researchInput)}
    catch(e){
      if(!snapshot||!s.holdings.length)throw e;
      rejectedResearch=researchCheck(s,researchInput,now);s.externalResearch=null;
    }
    for (const p of s.plans)
      if (["대기", "보류"].includes(p.status)) p.status = "만료";
    if(s.externalResearch&&decisionPhase)markManualReviewed(s,s.externalResearch,now);
  }
  const previousQuotes=s.marketData?.quotes;
  if(snapshot&&!researchInput&&decisionPhase&&logicReview.approved)s.externalResearch=null;
  if(snapshot){s.investmentProcessVersion=5;s.data=snapshot.data;s.fx=snapshot.fx;s.marketData=snapshot;s.mode='live';if(snapshot.universeVersion)s.universeVersion=snapshot.universeVersion;if(snapshot.activeSymbols){s.universeVersion='indexCatalog';s.activeSymbols=snapshot.activeSymbols;}s.date=new Date(now+OFFSET).toISOString().slice(0,10);if(s.day===0)s.history=[{date:s.date,equity:equity(s),benchmark:equity(s)}]}
  if(snapshot&&logicReview.approved){
    const stamp=Date.parse(s.externalResearch?.asOf),fresh=Number.isFinite(stamp)&&Math.abs(now-stamp)<36*3600000;
    if(s.externalResearch)s.externalResearch.fresh=fresh;
    if(decisionPhase)refreshFundamentals(s,financials,snapshot,now);
    for(const x of s.externalResearch?.screening||[]){
      const f=s.fundamentals[x.symbol];if(!f)continue;x.fundamentalPass=f.pass;x.fundamentalReview=(businessResearch(s,x.symbol)?.reason||x.bottomUpReason)+' · '+f.text+' '+f.limitations;
      if(!fresh||!x.sourceUrls?.length){x.stance='watch';x.reason+=' · 조사 시점 또는 기업별 출처 미확인';}
    }
    if(logicReview.approved&&researchInput&&!rejectedResearch)for(const h of s.holdings){const x=s.externalResearch?.screening?.find(c=>c.symbol===h.symbol);if(x?.exit&&x.sourceUrls?.length&&!s.plans.some(p=>p.symbol===h.symbol&&['sell','cover'].includes(p.side)&&['대기','승인'].includes(p.status))){requestExit(s,h.symbol);reviewedExitIds.add(s.plans.at(-1).id);}}
  }
  const readiness=snapshot?(rejectedResearch||researchCheck(s,s.externalResearch,now)):null;
  const holdIncompleteEntries=()=>{if(readiness&&!readiness.complete)for(const p of s.plans)if(['buy','short'].includes(p.side)&&['대기','승인'].includes(p.status)&&!readiness.readyUnitIds?.includes(p.unitId)){p.status='보류';p.reason='조사 미완료: 누락 근거를 채운 뒤 신규 편입 재심사';}};
  reviewPolicy(s);const learning=learningReview(s,now);if(decisionPhase&&logicReview.approved){analyze(s,now);holdIncompleteEntries();}
  let approved = 0,
    held = 0;
  for (const p of s.plans.filter(
    (p) => logicReview.approved&&decisionPhase&&p.status === "대기"&&(['buy','short'].includes(p.side)||reviewedExitIds.has(p.id))&&(!session||session.countries.includes(companies.find(c=>c.symbol===p.symbol).country)),
  )) {
    try {
      approve(s, p.id,now);
      if(snapshot)p.signalTimestamp=snapshot.quotes[p.symbol].time;
      approved++;
    } catch {
      held++;
    }
  }
  const entryAtClose=executionBasis('buy',s)==='regularClose',entryPhase=entryAtClose?'close':'open';
  advance(s,snapshot?{quotes:snapshot.quotes,previousQuotes,date:s.date,now,riskOnly:!logicReview.approved,researchReviewed:logicReview.approved&&!!researchInput&&!rejectedResearch,...(session?{execute:session.phase!=='pre',executeEntries:logicReview.approved&&session.phase===entryPhase,countries:session.countries,sessionDate:session.date}:{executeEntries:logicReview.approved})}:{});
  if(decisionPhase&&logicReview.approved)holdIncompleteEntries();if(readiness)s.analysis.researchReadiness=readiness;
  reviewPolicy(s);learningReview(s,now);
  const waitingEntry=session?.phase===entryPhase&&(s.plans.some(p=>p.status==='승인'&&['buy','short'].includes(p.side)&&session.countries.includes(companies.find(c=>c.symbol===p.symbol)?.country))||Object.values(s.assetAllocation?.positions??{}).some(a=>a.pending?.side==='buy'&&session.countries.includes(ETF_ASSETS.find(x=>x.symbol===a.symbol)?.country)));
  const summary = {
    status:!logicReview.approved?'logicReviewHeld':decisionPhase&&readiness&&!readiness.complete?'researchIncomplete':waitingEntry?(entryAtClose?'awaitingClose':'awaitingOpen'):'complete',
    logicReview,
    ...(session?{session}:{ }),
    ...(readiness?{researchReadiness:readiness}:{}),
    startedAt: new Date(now).toISOString(),
    fromDate: before.date,
    toDate: s.date,
    approved,
    held,
    newExecutions: s.trades.length - before.trades,
    executions: s.trades.slice(0,s.trades.length-before.trades).map(t=>({symbol:t.symbol,side:t.side,qty:t.qty,price:t.price,pnl:t.pnl,borrowFee:t.borrowFee||0,reason:t.reason})),
    equity: equity(s),
    exposure: exposure(s),
    pnl: equity(s) - before.equity,
    maxDrawdown: drawdown(s.history.map((h) => h.equity)),
    policy: s.policy,
    sourceCount: s.externalResearch?.sources?.length ?? 0,
    screened:s.externalResearch?.screening?.length||0,
    fundamentalPass:Object.values(s.fundamentals||{}).filter(x=>x.pass).length,
    nominated:s.analysis.reports.filter(x=>x.candidateDepartments.length).length,
    nominationsByDepartment:Object.fromEntries(researchDepartments.map(d=>[d,s.analysis.reports.filter(x=>x.candidateDepartments.includes(d)).length])),
    learning,
    trendUnits:(s.trendUnits||[]).map(u=>unitSnapshot(s,u,{unrealized})),
    unitPerformance:unitPerformance(s),
    portfolioUnitRisk:s.analysis.portfolioUnitRisk,
    strategySnapshot:weeklyStrategySnapshot(s,now),
    noTradeReason:waitingEntry?`장전 승인 주문의 정규장 ${entryAtClose?'확정 종가':'시가'} 수집 대기`:s.trades.length===before.trades?'새 가격·유닛·거시·지수·기업 근거·재무·전략·위험 기준을 모두 통과한 체결 대상 없음':null,
    pipelineVersion:PIPELINE_VERSION,
  };
  s.lastCycle = summary;
  s.departments=departmentReviews(s,summary,now);
  s.events.unshift({
    date: s.date,
    text: `${summary.status==='researchIncomplete'?'기존 보유 위험 점검 · 조사 보완 대기':waitingEntry?`정규장 ${entryAtClose?'확정 종가':'시가'} 수집 대기`:'자동 운용 완료'} · 신규 체결 ${summary.newExecutions}건 · 위험 규모 ${(s.policy.riskScale * 100).toFixed(0)}%`,
  });
  return summary;
}
export async function runScheduled(db, researchInput, now = Date.now(),snapshot=null,financials=null,session=null,logicReview={approved:true},expectedRevision=null) {
  if(session)session=sessionFor(session.market,session.phase,now,!logicReview.approved);
  if(!session&&snapshot&&!isTradingWeekday(now))return {skipped:true,reason:'weekend',nextRun:nextRun(now)};
  const slot = session?.slot??slotFor(now);
  for (let retry = 0; retry < 3; retry++) {
    const current = await readAccount(db);
    if(expectedRevision!==null&&expectedRevision!==current.revision){const e=Error('검토 이후 계좌가 변경됐습니다. 최신 계좌로 재검토하세요.');e.status=409;throw e;}
    if(current.metadata.sessionMode&&!session)return {...current,skipped:true,reason:'sessionPhaseRequired'};
    if(session&&current.metadata.sessionRuns?.[session.key]?.complete)return {...current,reused:true,summary:current.metadata.sessionRuns[session.key].summary};
    if (!session&&current.metadata.lastSlot >= slot && current.metadata.lastSlot !== null&&current.state.lastCycle?.status!=='logicReviewHeld')
      {if(snapshot)await saveRun(db,slot,current.state.lastCycle?.status||'complete',{summary:current.state.lastCycle,departments:current.state.departments,research:current.state.externalResearch,learning:current.state.strategyLearning},now);return { ...current, reused: true, summary: current.state.lastCycle };}
    if (current.metadata.paused) return { ...current, paused: true };
    if(snapshot&&current.state.mode!=='live'){
      const archivedId='simulation-'+current.revision;
      const archive=statePieces(JSON.stringify(current.state));await storeParts(db,archivedId,archive.stored,archive.parts);
      await db.prepare('INSERT OR IGNORE INTO paper_account (id,state,revision,metadata,updated_at) VALUES (?,?,?,?,?)').bind(archivedId,archive.stored,current.revision,JSON.stringify(current.metadata),new Date(now).toISOString()).run();
      current.metadata.simulationArchive=archivedId;current.state=createState();current.state.plans=[];current.state.events=[];
    }
    if(snapshot)enableRegularExecution(current.state,now);
    const summary = autonomousCycle(current.state, researchInput, now,snapshot,financials,session,logicReview);
    recordOperatorException(current,logicReview,'/api/run',session,summary.status==='complete');
    const sessionRuns=session?{...current.metadata.sessionRuns,[session.key]:{complete:summary.status==='complete',summary:{status:summary.status,session,approved:summary.approved,newExecutions:summary.newExecutions,equity:summary.equity},at:new Date(now).toISOString()}}:null;
    const metadata = {
      ...current.metadata,
      lastSlot: slot,
      pipelineVersion:snapshot?PIPELINE_VERSION:current.metadata.pipelineVersion,
      lastRun: new Date(now).toISOString(),
      nextRun: nextRun(now,!!session||current.metadata.sessionMode),
      ...(session?{sessionMode:true,lastSession:session,sessionRuns:Object.fromEntries(Object.entries(sessionRuns).slice(-30))}:{}),
      runCount: (current.metadata.runCount || 0) + 1,
    };
    try {
      const saved=await writeAccount(db,current,current.state,metadata);
      if(snapshot)await saveRun(db,slot,summary.status,{summary,departments:current.state.departments,research:current.state.externalResearch,learning:current.state.strategyLearning},now);
      return {...saved,reused:false,summary};
    } catch (e) {
      if (e.status !== 409 || retry === 2) throw e;
    }
  }
}
export function applyAction(s, input) {
  switch (input.action) {
    case "approve":
      return approve(s, input.id);
    case "reject":
    case "cancel": {
      const p = s.plans.find((p) => p.id === input.id);
      if (
        !p ||
        !(input.action === "cancel" ? ["승인"] : ["대기", "보류"]).includes(
          p.status,
        )
      )
        throw Error("변경할 수 없는 계획입니다.");
      p.status = input.action === "cancel" ? "취소" : "거절";
      s.events.unshift({
        date: s.date,
        text: `${companies.find((c) => c.symbol === p.symbol).name} 계획 ${p.status}`,
      });
      return s;
    }
    case "exit":
      return requestExit(s, input.symbol);
    case "advance":
      autonomousCycle(s);
      return s;
    case "note":
      if (typeof input.note !== "string" || input.note.length > 20000)
        throw Error("메모는 20,000자 이하로 작성하세요.");
      s.note = input.note;
      return s;
    case "reset":
      return createState();
    case "import":
      validateState(input.state);
      analyze(input.state);
      return input.state;
    default:
      throw Error("지원하지 않는 작업입니다.");
  }
}

export async function saveRun(db,slot,status,report,now=Date.now()){
 await db.prepare('INSERT INTO run_log (id,started_at,status,report) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, report = excluded.report').bind(slot,new Date(now).toISOString(),status,JSON.stringify(report)).run();
}
// One-shot migration of an exported ledger. Only an empty database accepts it, so it can never replace or alter a live account.
export async function importLedger(db,input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('가져오기 형식이 올바르지 않습니다.');
  if(input.account){
    const a=input.account;
    if(await db.prepare('SELECT id FROM paper_account WHERE id = ?').bind('main').first())throw Object.assign(Error('계좌가 이미 있어 가져올 수 없습니다.'),{status:409});
    if(!Number.isInteger(a.revision)||a.revision<1||!a.metadata||typeof a.metadata!=='object'||typeof a.updatedAt!=='string'||!Number.isFinite(Date.parse(a.updatedAt)))throw Error('계좌 메타데이터가 올바르지 않습니다.');
    validateState(a.state);
    const {stored,parts}=statePieces(JSON.stringify(a.state));await storeParts(db,'main',stored,parts);
    await db.prepare('INSERT INTO paper_account (id,state,revision,metadata,updated_at) VALUES (?,?,?,?,?)').bind('main',stored,a.revision,JSON.stringify(a.metadata),a.updatedAt).run();
    return {imported:'account',revision:a.revision,parts:parts.length};
  }
  if(Array.isArray(input.runs)){
    if((await db.prepare('SELECT count(*) AS n FROM run_log').first()).n>0)throw Object.assign(Error('운용 기록이 이미 있어 가져올 수 없습니다.'),{status:409});
    if(input.runs.length>1000)throw Error('운용 기록은 1000개 이하로 가져옵니다.');
    for(const r of input.runs){
      if(!Number.isSafeInteger(r.id)||typeof r.started_at!=='string'||!Number.isFinite(Date.parse(r.started_at))||typeof r.status!=='string'||r.status.length>40||!r.report||typeof r.report!=='object')throw Error('운용 기록 형식이 올바르지 않습니다.');
      await db.prepare('INSERT OR IGNORE INTO run_log (id,started_at,status,report) VALUES (?,?,?,?)').bind(r.id,r.started_at,r.status,JSON.stringify(r.report)).run();
    }
    return {imported:'runs',count:input.runs.length};
  }
  throw Error('account 또는 runs가 필요합니다.');
}
export async function recentRuns(db){const r=await db.prepare('SELECT * FROM run_log ORDER BY id DESC LIMIT 20').all();return r.results.map(x=>({...x,report:JSON.parse(x.report)}))}
export function prepareAllocation(current,input,now=Date.now(),logicReview={approved:true}){
 const s=current.state;
 const session=input.phase||input.market?sessionFor(input.market,input.phase,now,!logicReview.approved):null;
 if((!session&&!isTradingWeekday(now))||current.metadata.paused||(current.metadata.sessionMode&&!session))throw Error('시장별 운용 단계 및 일시정지 상태 확인 필요');
 if(!Array.isArray(input.snapshots)||!input.snapshots.length||input.snapshots.length>ETF_ASSETS.length||new Set(input.snapshots.map(x=>x.symbol)).size!==input.snapshots.length)throw Error('채권 ETF 자료 형식 확인 필요');
 const snapshots=input.snapshots.map(x=>validateAssetSnapshot(x,now,logicReview.approved&&session?.phase==='pre'?logicReview.reviewStartedAt??null:null));
 if(input.decision&&logicReview.approved){if(session&&session.phase!=='pre')throw Error('새 ETF 판단은 장전에만 승인합니다.');const decision=allocationDecision(input.decision,now);s.assetAllocation??={version:1,positions:{}};s.assetAllocation.decision=decision;}
 enableRegularExecution(s,now);
 const reserved=s.plans.filter(p=>p.status==='승인'&&['buy','short'].includes(p.side)).reduce((n,p)=>n+p.qty*markPrice(s,p.symbol)*fxOf(p.symbol,s)*1.001*1.00015,0);
 const summary=snapshots.filter(snapshot=>!session||session.countries.includes(ETF_ASSETS.find(a=>a.symbol===snapshot.symbol).country)).map(snapshot=>allocateAssets(s,snapshot,now,exposure(s),reserved,session,logicReview));
 if(summary.length&&logicReview.reviewer==='operator-exception')recordOperatorException(current,logicReview,'/api/allocation',session,!Object.values(s.assetAllocation.positions).some(p=>p.pending?.side==='buy'&&session.countries.includes(ETF_ASSETS.find(a=>a.symbol===p.symbol)?.country)));
 s.assetAllocation.logicReview=logicReview;
 s.assetAllocation.collectionFailures=Array.isArray(input.failures)?input.failures.filter(f=>ETF_ASSETS.some(a=>a.symbol===f?.symbol)).map(f=>({symbol:f.symbol,status:'unavailable'})):[];
 s.assetAllocation.policy=ALLOCATION_POLICY;
 s.date=new Date(now+OFFSET).toISOString().slice(0,10);
 s.history.push({date:s.date,timestamp:new Date(now).toISOString(),equity:equity(s),benchmark:s.history.at(-1).benchmark});
 return summary;
}
export function context(a){return {manualCandidates:manualContext(a.state),assetAllocation:{assets:ETF_CANDIDATES,retiringAssets:ETF_ASSETS.filter(asset=>asset.enabled===false&&a.state.assetAllocation?.positions[asset.symbol]?.qty>0),policy:ALLOCATION_POLICY,decisionFields:"decision:{asOf,weights:{symbol:idleWeight},reason,risks,sourceUrls[]} · ETF 총90%, 중장기·회사채 합산40%, 개별20% 또는 하이일드10%. weights는 유휴자금 비중이며 미지정 종목0%. 채권 ETF 합계는 계좌 자본의 50% 이내로 서버가 비중을 같은 비율로 축소. 단기채 기본 배분 이외 신규 매수는36시간 이내 근거 필요. 분배율만으로 선택하지 말고 return20/60·가격변동성·추세·금리/신용/FX를 비교. ETF 신규 편입은 채권10개만 허용. retiringAssets는 신규 매수 금지, 실제 가격 수집 후 승인 이후 정규장 시가로 기존 보유 청산",state:a.state.assetAllocation?{...a.state.assetAllocation,positions:Object.fromEntries(Object.entries(a.state.assetAllocation.positions).map(([symbol,p])=>[symbol,{...p,trades:p.trades.slice(0,5)}]))}:null},marketReports:compactReports(a.state.marketReports),marketReportWorkflow:{source:"https://fdo2a.github.io/",refresh:"/api/market-reports",body:"/api/account",usage:"brief.ratesAndFx와 논지·반증 조건을 먼저 활용. 같은 금리·환율을 중복 조회하지 않음. 원문은 필요한 경우에만 확인. marketReportReview(문자열, 최대 6000자)에 보고서 기준일·출처와 채택 또는 반대 이유를 기록. 현재 체결 환율은 별도 수집."},revision:a.revision,universeVersion:a.state.universeVersion??'core24',activeSymbols:activeCompanies(a.state).map(c=>c.symbol),fundamentalsAsOf:Object.fromEntries(Object.entries(a.state.fundamentals??{}).filter(([,f])=>typeof f?.fetchedAt==='string').map(([symbol,f])=>[symbol,f.fetchedAt])),fundamentalsPolicy:{recheckDays:FUNDAMENTALS_RECHECK_DAYS,maxAgeDays:FUNDAMENTALS_MAX_AGE_DAYS,note:'연간 재무는 주 1회 재조회하고 저장값은 '+FUNDAMENTALS_MAX_AGE_DAYS+'일 유효. 수집 경과만으로 보류하지 않음.'},executionPolicy:a.state.executionPolicy??null,metadata:{...a.metadata,nextRun:nextRun(Date.now(),a.metadata.sessionMode)},sessionWorkflow:{phases:['pre','open','close'],markets:['asia','us'],identify:'/api/session?market=asia|us',timing:'한국·일본 08:00/09:20/16:00 KST, 미국 08:30/09:50/16:30 America/New_York. 실제 거래일·정규장 가격 확인 필수.',rules:'장전만 리서치·신규 판단·승인. 개장에는 장전 승인된 주식·ETF를 해당 거래일 정규장 시가로 그대로 모의 편입하고 위험 점검·기존 청산. 승인 종목은 시가가 기준가와 얼마나 다르든 보류하지 않으며 계좌 하드 한도(현금·노출·손실)만 재검사. 마감에는 평가·위험 점검만. awaitingOpen이면 같은 개장 단계에서 실제 시가 갱신 후 재시도 가능. 승인 이전 시가 소급 체결 금지. 위험 청산은 이후 시가 사용. 미국 금요일 마감은 한국 토요일 새벽 허용.'},lastCycle:a.state.lastCycle,researchReadiness:researchCheck({...a.state,investmentProcessVersion:5}),researchPreparedAt:a.state.researchPreparedAt??null,departments:a.state.departments||[],strategyLearning:a.state.strategyLearning||{},allowedIndices:universeCatalog().indices,eligibleUniverseUrl:'/api/universe',companies:activeCompanies(a.state).map(c=>({symbol:c.symbol,name:c.name,country:c.country,sector:c.sector,currency:c.currency,sizeClass:c.sizeClass??null,sizeEvidence:c.sizeEvidence??null})),plans:a.state.plans.filter(p=>p.status==='승인').map(({id,symbol,side,status,riskExit})=>({id,symbol,side,status,riskExit})),holdings:a.state.holdings.map(h=>({symbol:h.symbol,direction:h.direction||'long',qty:h.qty,unitId:h.unitId,ideaId:h.ideaId,stop:h.stop,target:h.target,strategy:h.strategy})),lastResearch:a.state.externalResearch,technical:a.state.analysis?.reports?.map(x=>({symbol:x.symbol,trend:x.trend,momentum:x.momentum,technicalScore:x.technicalScore,style:x.style,riskMetrics:x.riskMetrics})),exposure:exposure(a.state),shortModel:{enabled:true,borrowRate:0.03,additionalMargin:1,totalLimit:0.3,perStockLimit:0.1,method:'시장 하락 헤지: 바텀업 검증 기업의 하락 추세; 가정 대차 가능'},investmentProcess:{version:5,method:'매크로·산업 컨셉을 기업 검증·계량 순위·기술 검토 후 1~3개월 Trend Unit으로 운용',quantMethod,entryPolicy:{strategyScope:'Trend Unit 최종 구성종목',training:'앞선 max(220,floor(가격자료 거래일×70%)) 구간, 청산 최소 max(3,구성종목수)건·평균 수익 양수',validation:'이후 분리 구간, 청산 최소 max(2,ceil(구성종목수/2))건·평균 수익 양수·최대낙폭15% 이하',execution:'퀀트·기술 점수(검증 전략 진입 신호는 가산점)로 선정 순위를 정하고 상위부터 수량 배정, 리스크관리부가 남은 한도에 맞춰 축소. 기업·재무 자료 신선도와 계좌 하드 한도·정규장 체결 기준 필수. 전체 관찰종목 검증은 비교용이며 해당 바스켓 편입의 선행조건이 아님'},quantResearch:a.state.analysis?.quantResearch??[],portfolioUnitRisk:a.state.analysis?.portfolioUnitRisk??null,unitPerformance:unitPerformance(a.state),ideaFields:'investmentIdeas:[{id,name,sourceDepartments:[screening|market],region,category:theme|macro|deepValue|momentum,asOf,thesis,universeReason,catalyst,whatToWatch,invalidation,candidates:[{symbol,reason}],referenceIndex:{name,asOf,constituents:[],sourceUrls:[]},sourceUrls:[],opposingViews:[{department:screening|market,reason,sourceUrls:[]}],action:review|withdraw,withdrawalReason,managementReview(optional):{status:watch,reason,sourceUrls:[]}}]',unitRisk:a.state.analysis?.unitRisk??[],macroFactors:['leading','growth','inflation','policy','liquidity'],proposalFields:'trendUnits:[{id,ideaId,name,category:theme|macro|deepValue|momentum,riskProfile:riskOn|defensive,regime:bull|sideways|shortBear|longBear|unknown,direction:long|short,region,thesis,catalyst,invalidation,allocationReason,riskBasis,targetReturn,lossLimit,maxWeight,horizonMonths:1~3,members:[{symbol,weight,reason}],reserves:[],excluded:[{symbol,reason}],referenceIndex:{name,asOf,constituents:[],sourceUrls:[]},sourceUrls:[],action:hold|exit,exitReason}]',macroFields:'macroScorecard:[{factor,region,signal:positive|neutral|negative|unknown,observedAt,reason,sourceUrls:[]}]',rules:['구성 종목 국가별 5종 매크로 근거 확인(한 아이디어·바스켓에 여러 나라 종목 혼합 가능, region은 라벨), 누락·미확인 시 신규 편입 보류','참조지수 확인, 2~20개 바스켓과 예비종목 10개 이하','유닛 예산 상한 40%, 기존 계좌·업종·손실 한도 우선','첫 체결 시 조건·기한 고정, 손실 한도 절반 도달 시 1회 절반 축소, 전체 한도·목표·기한 도달 시 청산','회복·주간 리밸런싱은 재심사 후 새 ID로 교체, 동일 ID의 기한·손실 한도 확대 금지'],episodes:(a.state.trendUnits||[]).map(u=>unitSnapshot(a.state,u,{unrealized}))},researchWorkflow:{version:5,departments:researchDepartments,computedDepartments:['quant'],departmentRoles:{market:'성장·물가·정책·유동성·국면과 현금 배분 판단',screening:'향후1~3개월 컨셉·촉매·직접/간접 수혜와 공급망·장비·소재 후보군을 폭넓게 발굴',fundamental:'후보의 사업·공시·재무 숫자와 투자논리 연결 검증',quant:'서버 계산 팩터 점수·후보 순위·위험값·유닛 성과로 어떤 후보를 살지 선정 순위에 참여, 매수 거부권·테마 선택·사업 승인 권한 없음',technical:'추세·모멘텀·진입 시점 점수로 어떤 후보를 살지 선정 순위에 참여, 매수 거부권 없음',management:'계량·기업·기술 검토를 종합해 선정·예비·제외·비중·목표·손절·기한 결정',risk:'선정 순위대로 현금·노출·증거금·손실 한도 안에서 수량 배정·축소, 유닛 간 상관·중복 점검. 계좌 하드 한도만 최종 상한'},departmentNames:{screening:'산업·테마분석부',market:'마켓부',fundamental:'펀더멘탈부',technical:'기술적 분석부',quant:'퀀트리서치부',management:'운용부',risk:'리스크관리부'},preflight:'/api/research-check',prepare:'/api/research',sequence:['산업·테마분석부·마켓부가 먼저 컨셉을 정의하고 등록 Universe에서 직접·간접 수혜 후보20~60개 목표, 최대100개 발굴','펀더멘탈부가 넓은 후보군의 기업 분석·사업·공시·재무와 수혜 연결·반대 근거를 순차 검증','퀀트리서치부가 서버 재무·가격으로 같은 후보의 스타일 점수·순위·위험값 계산','별도 기술적 분석부가 같은 후보의 추세와 진입 시점을 점수화해 선정 순위에 참여','운용부가 기업·계량·기술 검토와 반대 의견을 종합해 최종 종목·비중·전략·손절·목표·기한 결정','리스크관리부가 선정 순위대로 한도 안 수량을 배정·축소하고 체결 직전 하드 한도 재검사','장전 리서치·승인 후 개장에 해당 거래일 정규장 시가로 모의 편입'],input:'departmentResearch.{fundamental,technical}:[{ideaId,symbol,stance:allow|watch|avoid,score:0~100|null,reason,sourceUrls:[],risks,businessPass(펀더멘탈만),revisedStance(선택),revisionReason(수정 시 필수)}]',rules:['퀀트부는 외부 점수 입력을 요구하지 않으며 서버 계산만 사용, 4개 필수 팩터·'+FUNDAMENTALS_MAX_AGE_DAYS+'일 이내 재무 확인 후 순위화','최대100개 조사 후보 전체를 비교하고 상위30개를 압축 후보로 표시, 최종5~20개 권장·서버2~20개 허용, 미선정 후보는 관찰 유지','산업·마켓만 원본 투자 컨셉과 후보를 발굴, 내부 screening 키 유지','가격 미수집 등록 종목도 발굴 가능. /api/universe 전체 등록 후보를 확인하고 직접·간접 수혜 연결 이유와 원문을 남김. 같은 지역의 지수/여러 지수/자체 테마 Universe를 정확히 명명하고 출처 있는 구성 목록 사용','출처는 전체 최대300개. 분석은 작은 완료 묶음에서 끝내지 않고 남은 관찰 후보로 이어감. /api/research로 부분 조사 저장 후 누락을 보완하며 기존 연구·타임스탬프를 실제 갱신 없이 재사용하지 않음','모든 발굴 후보의 기업·기술 분석을 순차 진행하고 coverage에 완료·대기 건수 표시, 최종 편입 종목은 두 검토 필수','businessPass와 서버 numericPass 모두 통과해야 편입, 다른 아이디어의 통과는 대체 불가','기술 watch/avoid는 기록된 운용 판단을 지원하며 자동 거절은 아님, 서버 진입 신호는 선정 가산점이며 필수 아님','최종·예비·제외 종목은 원본 후보에서 선택, 명시적 제외는 이유 필요, 미선정·미완료 후보를 억지로 제외하지 않음','검토 후 편입 없음은 출처 있는 managementReview:watch로 기록','readyUnitIds 바스켓은 다른 아이디어 및 같은 컨셉의 미선정 후보 조사 누락과 독립 심사, 전체 complete:false와 누락 목록 유지','최종 편입 종목 자료 누락·36시간 이상 조사·숫자 검증·위험 실패는 해당 바스켓 신규 편입 차단','상승·횡보 시장은 롱, 하락 시장은 숏으로 편입하며 국면에 맞는 검증 전략 진입 신호가 있으면 선정 가산',
'PER 기본60배, 매출성장15% 이상·ROE10% 이상·영업현금흐름 양수이면80배 이내 허용, 차입금/자기자본4배 이하(미제공이면 흑자·영업현금흐름 양수로 대체), 다른 재무·위험 심사는 유지','기존 v4 바스켓·승인 주문은 새 조사로 재심사, 기존 보유 청산은 유지']},pipelineVersion:PIPELINE_VERSION}}

export function universeCatalog(){return {indices:[...new Set(eligibleCatalog.map(c=>c.country))].map(country=>{const rows=eligibleCatalog.filter(c=>c.country===country),m=rows[0].indexMembership;return {name:m.index,country,count:rows.length,asOf:m.asOf,source:m.sourceUrl,sourceType:m.sourceType,limitations:m.limitations??[]};}),companies:eligibleCatalog};}
