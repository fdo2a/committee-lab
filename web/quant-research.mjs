import {styleScore,researchLimits} from './trend-units.mjs';
import {companies} from './universe.mjs';
import {ff3Exposure,ff3AlphaScore,FF3_LIMITATIONS} from './fama-french.mjs';
import {FUNDAMENTALS_CHECK_NAME,fundamentalsCurrent} from './fundamentals-freshness.mjs';

export const ff3For=(s,symbol)=>ff3Exposure(s.data?.[symbol],companies.find(c=>c.symbol===symbol)?.country,s.marketData?.factors);

export const quantMethod={version:2,owner:'퀀트리서치부',factors:['value','quality','growth','momentum'],optionalFactors:['ff3Alpha'],weights:{value:.2,quality:.2,growth:.2,momentum:.2,ff3Alpha:.2},weightRule:'가용 요소 동등가중: 알파가 없으면 필수 4요소 각 25%',
 ff3:{model:'Fama-French 3팩터(시장·규모 SMB·가치 HML)',source:'Kenneth French Data Library',regions:{미국:'미국 일별',일본:'일본 일별',한국:'미적용(필수 4요소)'},window:'최근 252거래일(최소 120일)',score:'알파 t값 선형 환산(t=+2.5 → 100, 0 → 50), 숏은 부호 반전',limitations:FF3_LIMITATIONS},...researchLimits,preferredMembers:{min:5,max:20},reserveLimit:10,
 method:'아이디어 후보 안에서 가치·ROE·매출성장·방향별 가격모멘텀과 Fama-French 3팩터 알파의 동등가중 점수로 순위화',
 limitations:'MSCI 공식 방법론 아님. 규모·배당·EPS 전망 수정치 미수집. 작은 후보군 순위는 전체 시장 순위가 아니며 점수는 사업 검증·진입 신호·위험 심사를 대체하지 않습니다.'};

export function quantEvidence(s,symbol,technicalScore,now=Date.now(),direction='long'){
 const f=s.fundamentals?.[symbol],ff3=ff3For(s,symbol),style=styleScore(f?.metrics,direction==='short'?100-technicalScore:technicalScore,ff3AlphaScore(ff3,direction));
 const numericChecks=(f?.checks??[]).filter(c=>c.name!=='최신 바텀업 사업·공시 검토');
 const numeric=f?.numericPass??(numericChecks.length>0&&numericChecks.every(c=>c.pass));
 const checks=[[FUNDAMENTALS_CHECK_NAME,fundamentalsCurrent(f,now)],['서버 재무 숫자 검증',numeric===true],
  ...quantMethod.factors.map(k=>[k+' 팩터 확인',Number.isFinite(style.values[k])])];
 return {ready:checks.every(c=>c[1]),style,ff3,checks,fetchedAt:f?.fetchedAt??null,periodEnd:f?.periodEnd??null,sourceUrls:(f?.sources??[]).map(x=>x.url)};
}

// Why a candidate is selected, reserve, excluded, exited or only watched. selectionReason is that
// decision's reason; candidateReason keeps why it was nominated, which is not a reason for selection.
export function candidateSelection(baskets,idea,candidate){
 const live=baskets.filter(u=>(u.action??'hold')==='hold'&&!['closing','closed'].includes(u.status)),ended=baskets.filter(u=>!live.includes(u)),symbol=candidate.symbol;
 const member=live.flatMap(u=>u.members??[]).find(m=>m.symbol===symbol),excluded=live.flatMap(u=>u.excluded??[]).find(m=>m.symbol===symbol);
 const endedUnit=ended.find(u=>(u.members??[]).some(m=>m.symbol===symbol)),base={candidateReason:candidate.reason??null};
 if(member)return {...base,selection:'selected',selectionReason:member.reason};
 if(live.some(u=>u.reserves?.includes(symbol)))return {...base,selection:'reserve',selectionReason:'최종 바스켓의 예비 후보: 편입 종목이 빠지면 대체 검토'};
 if(excluded)return {...base,selection:'excluded',selectionReason:excluded.reason};
 if(endedUnit)return {...base,selection:'exited',selectionReason:endedUnit.exitReason?.trim()||endedUnit.reviewLog?.at(-1)?.reason?.trim()||'바스켓 청산·교체'};
 return {...base,selection:'watch',selectionReason:idea?.managementReview?.reason?.trim()||(live.length?'운용부가 최종 바스켓에 넣지 않음':'운용부 최종 바스켓 미구성')};
}
export function quantScreening(s,reports,now=Date.now()){
 const bySymbol=new Map(reports.map(r=>[r.symbol,r]));
 return (s.externalResearch?.investmentIdeas??[]).filter(i=>i.action==='review').map(idea=>{
  const units=(s.externalResearch.trendUnits??[]).filter(u=>u.ideaId===idea.id&&u.action==='hold'),direction=units[0]?.direction??'long';
  const candidates=idea.candidates.map(c=>{
   const r=bySymbol.get(c.symbol),evidence=quantEvidence(s,c.symbol,r?.technicalScore,now,direction);
   return {symbol:c.symbol,...evidence,rank:null,riskMetrics:r?.riskMetrics??null,...candidateSelection(units,idea,c)};
  }).sort((a,b)=>Number(b.ready)-Number(a.ready)||(b.style.score??-1)-(a.style.score??-1)||a.symbol.localeCompare(b.symbol));
  let rank=0;for(const c of candidates){if(c.ready)c.rank=++rank;c.shortlisted=c.rank!==null&&c.rank<=quantMethod.shortlistLimit;}
  return {ideaId:idea.id,asOf:new Date(now).toISOString(),direction,candidateCount:candidates.length,rankedCount:rank,shortlistCount:Math.min(rank,quantMethod.shortlistLimit),candidates,method:quantMethod.method,limitations:quantMethod.limitations};
 });
}
