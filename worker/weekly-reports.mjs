import {assetPositions} from '../web/asset-allocation.mjs';
import {unitPerformance,memberCountries} from '../web/trend-units.mjs';
import {quantMethod,quantEvidence,candidateSelection} from '../web/quant-research.mjs';
import {companies} from '../web/universe.mjs';
const DAY=86400000,OFFSET=9*3600000;
const writingGuide={
 marketOverview:'Macro Top-down: 지역별 경기·물가·정책·유동성 근거, 시장 국면과 반대 신호, 주식·현금 배분에 미친 영향을 당시 시점·출처와 연결한다.',
 selectionReview:'Macro → Universe 선택 원인 → 직접·간접 수혜와 공급망 후보 비교 → 종목 선정·예비·제외·관찰 이유 순서로 쓴다. 후보 전체 규모와 실제 분석 완료·대기를 구분하고 미선정 후보도 보존한다. 참조지수와 universeReason, 기업·기술 검토, 퀀트 순위와 Value·Size·Quality·Dividend·Growth·Momentum 실측값/점수를 구분한다. 미수집·미확인은 추정하지 않는다.',
 resultsReview:'유닛별 비중·목표수익·손절·1~3개월 기한, 실제 체결/보류·부분 축소·청산/교체 이유, 비용 반영 주간 성과와 종료 유닛 KPI를 연결한다. 연율 변동성과 과거 중첩 60거래일 VaR 90%/95%, 표본·자료 시점을 명시한다. 개별 VaR 가중평균을 바스켓 VaR로 쓰지 않는다.',
 nextWeekPlan:'다음 주 유지·진입·교체·현금 대기 조건, 촉매·확인 일정·반증 조건을 구체적으로 쓴다. 과거 주간에 현재 자료를 소급하지 않으며 조사·승인·체결을 구분한다.'
};
export function weeklyStrategySnapshot(s,now=Date.now()){
 const observed=stamp=>Number.isFinite(Date.parse(stamp))&&Date.parse(stamp)<=now,research=observed(s.externalResearch?.asOf)?s.externalResearch:null;
 const macro={asOf:research?.asOf??null,topDown:research?.topDown??null,scorecard:(research?.macroScorecard??[]).filter(r=>observed(r.observedAt)),sources:research?.sources??[]};
 const units=new Map((research?.trendUnits??[]).map(u=>[u.id,u]));
 for(const u of s.trendUnits??[])if(u.status!=='closed'||Date.parse(u.closedAt)>=now-7*DAY){
  const proposal=units.get(u.id);
  units.set(u.id,proposal?.action==='exit'?{...u,action:'exit',exitReason:proposal.exitReason}:u);
 }
 const ideas=new Map((research?.investmentIdeas??[]).filter(i=>observed(i.asOf)).map(i=>[i.id,i]));
 for(const u of units.values())if(!ideas.has(u.ideaId??u.id))ideas.set(u.ideaId??u.id,{id:u.ideaId??u.id,name:u.name,region:u.region,thesis:u.thesis,catalyst:u.catalyst,invalidation:u.invalidation,referenceIndex:u.referenceIndex,sourceUrls:u.sourceUrls,candidates:(u.members??[]).map(m=>({symbol:m.symbol,reason:m.reason}))});
 const result=[...ideas.values()].map(idea=>{
  const baskets=[...units.values()].filter(u=>(u.ideaId??u.id)===idea.id),direction=baskets[0]?.direction??'long';
  const candidates=new Map((idea.candidates??[]).map(c=>[c.symbol,c]));for(const u of baskets)for(const m of u.members??[])if(!candidates.has(m.symbol))candidates.set(m.symbol,m);
  const stocks=[...candidates.values()].map(candidate=>{
   const symbol=candidate.symbol,company=companies.find(c=>c.symbol===symbol),raw=s.fundamentals?.[symbol],f=observed(raw?.fetchedAt)?raw:null;
   const priceObserved=observed(s.marketData?.fetchedAt),r=priceObserved?s.analysis?.reports?.find(r=>r.symbol===symbol):null;
   const q=s.analysis?.quantResearch?.find(q=>q.ideaId===idea.id)?.candidates.find(c=>c.symbol===symbol);
   const size=observed(company?.sizeEvidence?.asOf)?company.sizeEvidence:null;
   const evidence=quantEvidence({fundamentals:{[symbol]:f},data:priceObserved?s.data:null,marketData:priceObserved?s.marketData:null},symbol,r?.technicalScore,now,direction);
   return {symbol,name:company?.name??symbol,...candidateSelection(baskets,idea,candidate),
    fundamentalReason:research?.departmentResearch?.fundamental?.find(x=>x.ideaId===idea.id&&x.symbol===symbol)?.reason??null,
    technicalReason:research?.departmentResearch?.technical?.find(x=>x.ideaId===idea.id&&x.symbol===symbol)?.reason??null,
    strategyValidation:s.plans?.filter(p=>p.symbol===symbol&&p.ideaId===idea.id).at(-1)?.managementReview?.strategyValidation??null,
    factors:evidence.style.values,ff3:evidence.ff3,
    metrics:{pe:f?.metrics?.pe??null,roe:f?.metrics?.roe??null,revenueGrowth:f?.metrics?.revenueGrowth??null,momentum20d:r?.momentum??null,marketCap:size?.value??null,marketCapCurrency:size?.currency??null,dividendYield:null},sizeEvidence:size,
    rank:q?.ready&&evidence.ready?q.rank:null,quantScore:evidence.ready?evidence.style.score:null,quantReady:q?.ready===true&&evidence.ready,financialAsOf:f?.fetchedAt??null,periodEnd:f?.periodEnd??null,financialSources:f?.sources??[],priceAsOf:r?s.marketData.fetchedAt:null,riskMetrics:r?.riskMetrics??null};
  });
  const regions=new Set([idea.region,...memberCountries([...candidates.values()])]);
  return {...idea,referenceIndex:observed(idea.referenceIndex?.asOf)?idea.referenceIndex:null,macro:{...macro,scorecard:macro.scorecard.filter(r=>regions.has(r.region))},stocks,units:baskets.map(u=>({...u,risk:s.analysis?.unitRisk?.find(r=>r.id===u.id)??null})),capturedAt:new Date(now).toISOString()};
 });
 return structuredClone({capturedAt:new Date(now).toISOString(),macro,ideas:result,quantMethod,portfolioUnitRisk:s.analysis?.portfolioUnitRisk??null});
}
function weeklyStrategyReview(s,runs,period){
 const snapshots=runs.map(r=>({time:Date.parse(r.started_at),snapshot:r.report?.summary?.strategySnapshot}));
 if(s.lastCycle?.strategySnapshot)snapshots.push({time:Date.parse(s.lastCycle.startedAt),snapshot:s.lastCycle.strategySnapshot});
 const valid=[...new Map(snapshots.filter(({time,snapshot})=>time>=period.startAt&&time<=period.endAt&&Array.isArray(snapshot?.ideas)&&Date.parse(snapshot.capturedAt)>=period.startAt&&Date.parse(snapshot.capturedAt)<=time).map(x=>[x.snapshot.capturedAt,x.snapshot])).values()].sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt));
 const ideas=new Map();for(const snapshot of valid)for(const idea of snapshot.ideas)ideas.set(idea.id,{...idea,capturedAt:snapshot.capturedAt});
 return {available:valid.length>0,snapshotCount:valid.length,asOf:valid.at(-1)?.capturedAt??null,macro:valid.at(-1)?.macro??null,ideas:[...ideas.values()],portfolioUnitRisk:valid.at(-1)?.portfolioUnitRisk??null,quantMethod:valid.at(-1)?.quantMethod??null,
  limitation:'해당 주 실행 당시 저장한 근거만 사용합니다. 아이디어별 마지막 관측을 표시하며 주중 종료·제외된 아이디어도 보존합니다. 기록 도입 전 자료는 현재 수치로 소급 작성하지 않습니다.'};
}
export function reportWeek(weekStart,now=Date.now()){
 const current=new Date(now+OFFSET),weekday=current.getUTCDay();
 const monday=new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth(),current.getUTCDate())-((weekday+6)%7)*DAY);
 // Before Saturday09 the latest completed reporting week is the preceding week.
 if(weekday<6&&(weekday!==0)||weekday===6&&current.getUTCHours()<9)monday.setUTCDate(monday.getUTCDate()-7);
 const start=weekStart??monday.toISOString().slice(0,10),parsed=Date.parse(start+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!Number.isFinite(parsed)||new Date(parsed).getUTCDay()!==1||new Date(parsed).toISOString().slice(0,10)!==start)throw Error('보고 시작일은 실제 월요일 날짜여야 합니다.');
 const cutoff=parsed+5*DAY; // Saturday09 KST is Saturday00 UTC.
 if(cutoff>now)throw Error('토요일 오전 9시 이후 완료된 주간만 발행할 수 있습니다.');
 return {start,end:new Date(parsed+4*DAY).toISOString().slice(0,10),startAt:parsed-OFFSET,endAt:cutoff};
}
export function weeklyReportContext(account,runs=[],weekStart,now=Date.now()){
 const s=account.state,period=reportWeek(weekStart,now),stamp=h=>Date.parse(h.timestamp||h.date+'T00:00:00+09:00');
 const history=s.history.filter(h=>Number.isFinite(h.equity)&&Number.isFinite(stamp(h))).sort((a,b)=>stamp(a)-stamp(b));
 const baseline=history.filter(h=>stamp(h)<period.startAt).at(-1),last=history.filter(h=>stamp(h)<=period.endAt).at(-1);
 const trades=[...s.trades,...assetPositions(s).flatMap(a=>a.trades)].filter(t=>t.date>=period.start&&t.date<=period.end&&(!t.recordedAt||Date.parse(t.recordedAt)<=period.endAt));
 const start=baseline?.equity??null,end=last?.equity??null;
 const metrics={startingEquity:start,endingEquity:end,pnl:start!==null&&end!==null?end-start:null,returnRate:start>0&&end!==null?(end-start)/start:null,realizedPnl:trades.reduce((n,t)=>n+(t.pnl??0),0),fees:trades.reduce((n,t)=>n+(t.fee??0),0),closedBorrowFees:trades.reduce((n,t)=>n+(t.borrowFee??0),0),executions:trades.length};
 const coverage={complete:!!baseline&&!!last&&stamp(last)>=period.startAt,firstObservation:history[0]?.timestamp||history[0]?.date||null,lastObservation:last?.timestamp||last?.date||null,limitation:'가상계좌 기록 기준. 자산 변화는 평가손익·실현손익·수수료·대차비용을 포함하며 실현손익과 중복 합산하지 않습니다. 미체결 주문은 성과에 포함하지 않습니다.'};
 return {revision:account.revision,period,metrics,coverage,strategyReview:weeklyStrategyReview(s,runs,period),writingGuide,referenceTiming:'holdings·bonds·plans·marketReports·research는 조회 시점의 현재 참고자료이며 다음 주 계획에만 사용합니다. 주간 시황·선정·위험 근거는 strategyReview와 해당 주 runs만 사용합니다.',unitPerformance:unitPerformance({trendUnits:(s.trendUnits??[]).filter(u=>u.status==='closed'&&u.closedAt>=period.start&&u.closedAt<=period.end)}),executions:trades,holdings:s.holdings,bonds:assetPositions(s),plans:s.plans,marketReports:s.marketReports,research:s.externalResearch,runs:runs.filter(r=>{const time=Date.parse(r.started_at);return time>=period.startAt&&time<=period.endAt;})};
}
export function saveWeeklyReport(account,runs,input,now=Date.now()){
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['weekStart','marketOverview','selectionReview','resultsReview','nextWeekPlan','sources'].includes(k)))throw Error('주간 보고서 형식 확인 필요');
 const sections={};for(const key of ['marketOverview','selectionReview','resultsReview','nextWeekPlan']){
  if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>20000)throw Error('각 보고 항목은 근거 있는 20,000자 이하 텍스트가 필요합니다.');
  sections[key]=input[key].trim();
 }
 if(!Array.isArray(input.sources)||input.sources.length>100)throw Error('보고서 출처 형식 확인 필요');
 const sources=input.sources.map(s=>{if(typeof s?.title!=='string'||!s.title.trim()||s.title.length>500||typeof s.url!=='string'||s.url.length>2000)throw Error('출처 형식 확인 필요');const u=new URL(s.url);if(u.protocol!=='https:'||u.username||u.password)throw Error('HTTPS 공개 출처만 허용합니다.');return {title:s.title,url:u.href};});
 const c=weeklyReportContext(account,runs,input.weekStart,now);
 const report={id:c.period.start,period:c.period,createdAt:new Date(now).toISOString(),accountRevision:account.revision,metrics:c.metrics,coverage:c.coverage,unitPerformance:c.unitPerformance,strategyReview:c.strategyReview,executions:c.executions,...sections,sources};
 const reports=account.state.weeklyReports??=[];
 const existing=reports.find(r=>r.id===report.id);if(existing)return existing;
 reports.unshift(report);return report;
}
