import {ideaEntryCheck,ideaFor} from './committee.mjs';
import {companies} from './universe.mjs';
// Research proposals and paper basket episodes. This is an adapted method, not MSCI replication.
export const macroFactors=['leading','growth','inflation','policy','liquidity'];
// An idea or basket may mix countries (2026-10-29 user instruction); region is a label, countries come from the symbols.
export const memberCountries=rows=>[...new Set(rows.map(m=>companies.find(c=>c.symbol===m.symbol)?.country).filter(Boolean))];
export const researchLimits={candidateLimit:100,shortlistLimit:30,preferredCandidates:{min:20,max:60}};
export function cleanInvestmentProcess(input,knownSymbols,sources,text){
 const urls=xs=>{
  if(!Array.isArray(xs)||!xs.length||xs.length>6)throw Error('투자 프로세스 출처 오류: sourceUrls는 1~6개여야 합니다.');
  // Name the URL so the research model can register it instead of guessing.
  const bad=xs.find(u=>!/^https:\/\//.test(u)||!sources.some(s=>s.url===u));
  if(bad!==undefined)throw Error('투자 프로세스 출처 오류: 최상위 sources에 없는 URL '+String(bad).slice(0,200));
  return [...xs];
 };
 const rows=input.macroScorecard??[];
 if(!Array.isArray(rows)||rows.length>25)throw Error('매크로 스코어카드 형식 오류');
 const macroScorecard=rows.map(r=>{
  if(!r||!macroFactors.includes(r.factor)||!['positive','neutral','negative','unknown'].includes(r.signal)||!Number.isFinite(Date.parse(r.observedAt)))throw Error('매크로 지표 값 오류');
  return {factor:r.factor,region:text(r.region,100),signal:r.signal,observedAt:r.observedAt,reason:text(r.reason,2000),sourceUrls:urls(r.sourceUrls)};
 });
 if(new Set(macroScorecard.map(r=>r.region+':'+r.factor)).size!==rows.length)throw Error('매크로 지표 중복');
 const ideas=input.investmentIdeas??[];
 if(!Array.isArray(ideas)||ideas.length>12)throw Error('투자 아이디어 수 오류');
 const investmentIdeas=ideas.map(i=>{
  if(!i||!/^[-a-zA-Z0-9_]{1,80}$/.test(i.id)||!['theme','macro','deepValue','momentum'].includes(i.category)||!Number.isFinite(Date.parse(i.asOf))||!['review','withdraw'].includes(i.action??'review'))throw Error('투자 아이디어 분류 오류');
  if(!Array.isArray(i.sourceDepartments)||!i.sourceDepartments.length||i.sourceDepartments.length>2||new Set(i.sourceDepartments).size!==i.sourceDepartments.length||i.sourceDepartments.some(d=>!['screening','market'].includes(d)))throw Error('컨셉 제안 부서 확인 필요');
  const candidates=i.candidates,index=i.referenceIndex;
  if(!Array.isArray(candidates)||!candidates.length||candidates.length>researchLimits.candidateLimit||new Set(candidates.map(c=>c.symbol)).size!==candidates.length||candidates.some(c=>!knownSymbols.includes(c.symbol)))throw Error('컨셉 후보 종목 오류');
  if(!index||!Array.isArray(index.constituents)||index.constituents.length>knownSymbols.length||new Set(index.constituents).size!==index.constituents.length||index.constituents.some(s=>!knownSymbols.includes(s))||candidates.some(c=>!index.constituents.includes(c.symbol))||!Number.isFinite(Date.parse(index.asOf)))throw Error('컨셉 참조지수 확인 필요');
  const opposingViews=i.opposingViews??[];
  if(!Array.isArray(opposingViews)||opposingViews.length>6||opposingViews.some(v=>!['screening','market'].includes(v.department)))throw Error('컨셉 반대 의견 오류');
  const clean={id:i.id,name:text(i.name,200),sourceDepartments:[...i.sourceDepartments],region:text(i.region,100),category:i.category,asOf:i.asOf,...Object.fromEntries(['thesis','catalyst','whatToWatch','invalidation'].map(k=>[k,text(i[k],3000)])),candidates:candidates.map(c=>({symbol:c.symbol,reason:text(c.reason,1500)})),referenceIndex:{name:text(index.name,300),asOf:index.asOf,constituents:[...index.constituents],sourceUrls:urls(index.sourceUrls)},sourceUrls:urls(i.sourceUrls),opposingViews:opposingViews.map(v=>({department:v.department,reason:text(v.reason,2000),sourceUrls:urls(v.sourceUrls)})),action:i.action??'review',withdrawalReason:text(i.withdrawalReason??'',2000)};
  if(i.managementReview!==undefined){const m=i.managementReview;if(!m||m.status!=='watch')throw Error('운용 관찰 결정 오류');clean.managementReview={status:'watch',reason:text(m.reason,2000),sourceUrls:urls(m.sourceUrls)};}
  if(i.universeReason!==undefined)clean.universeReason=text(i.universeReason,3000);
  if(clean.action==='withdraw'&&!clean.withdrawalReason.trim())throw Error('아이디어 철회 사유 필요');
  return clean;
 });
 if(new Set(investmentIdeas.map(i=>i.id)).size!==investmentIdeas.length)throw Error('아이디어 ID 중복');
 const proposals=input.trendUnits??[];
 if(!Array.isArray(proposals)||proposals.length>12)throw Error('트렌드 유닛 수 오류');
 const trendUnits=proposals.map(u=>{
  if(!u||!/^[-a-zA-Z0-9_]{1,80}$/.test(u.id)||!['theme','macro','deepValue','momentum'].includes(u.category)||!['riskOn','defensive'].includes(u.riskProfile)||!['bull','sideways','shortBear','longBear','unknown'].includes(u.regime)||!['long','short'].includes(u.direction)||!['hold','exit'].includes(u.action??'hold'))throw Error('트렌드 유닛 분류 오류');
  if(!(u.targetReturn>=.01&&u.targetReturn<=.2&&u.lossLimit>=.01&&u.lossLimit<=.15&&u.maxWeight>0&&u.maxWeight<=.4&&Number.isInteger(u.horizonMonths)&&u.horizonMonths>=1&&u.horizonMonths<=3))throw Error('유닛 목표·손실·비중·기한 오류');
  const members=u.members;
  if(!Array.isArray(members)||members.length<2||members.length>20||new Set(members.map(m=>m.symbol)).size!==members.length||members.some(m=>!knownSymbols.includes(m.symbol)||!Number.isFinite(m.weight)||m.weight<=0||m.weight>1)||Math.abs(members.reduce((n,m)=>n+m.weight,0)-1)>.001)throw Error('유닛 바스켓은 2~20개, 합계 비중 100%이어야 합니다.');
  const index=u.referenceIndex;
  if(!index||!Array.isArray(index.constituents)||index.constituents.length>knownSymbols.length||new Set(index.constituents).size!==index.constituents.length||index.constituents.some(s=>!knownSymbols.includes(s))||members.some(m=>!index.constituents.includes(m.symbol))||!Number.isFinite(Date.parse(index.asOf)))throw Error('참조지수·구성종목 확인 필요');
  const reserves=u.reserves??[];
  if(!Array.isArray(reserves)||reserves.length>10||new Set(reserves).size!==reserves.length||reserves.some(s=>!index.constituents.includes(s)||members.some(m=>m.symbol===s)))throw Error('예비종목 오류');
  const excluded=u.excluded??[];
  if(!Array.isArray(excluded)||excluded.length>researchLimits.candidateLimit||new Set(excluded.map(x=>x.symbol)).size!==excluded.length||excluded.some(x=>!knownSymbols.includes(x.symbol)||members.some(m=>m.symbol===x.symbol)||reserves.includes(x.symbol)))throw Error('제외 종목 오류');
  return {id:u.id,...(u.ideaId!==undefined?{ideaId:text(u.ideaId,80)}:{}),excluded:excluded.map(x=>({symbol:x.symbol,reason:text(x.reason,1500)})),name:text(u.name,200),category:u.category,riskProfile:u.riskProfile,regime:u.regime,direction:u.direction,region:text(u.region,100),thesis:text(u.thesis,3000),catalyst:text(u.catalyst,2000),invalidation:text(u.invalidation,2000),allocationReason:text(u.allocationReason,2000),riskBasis:text(u.riskBasis,2000),targetReturn:u.targetReturn,lossLimit:u.lossLimit,maxWeight:u.maxWeight,horizonMonths:u.horizonMonths,members:members.map(m=>({symbol:m.symbol,weight:m.weight,reason:text(m.reason,1500)})),reserves:[...reserves],referenceIndex:{name:text(index.name,300),asOf:index.asOf,constituents:[...index.constituents],sourceUrls:urls(index.sourceUrls)},sourceUrls:urls(u.sourceUrls),action:u.action??'hold',exitReason:text(u.exitReason??'',2000)};
 });
 const assigned=trendUnits.filter(u=>u.action!=='exit').flatMap(u=>u.members.map(m=>m.symbol));
 if(new Set(assigned).size!==assigned.length)throw Error('한 종목은 하나의 신규 유닛에만 배정합니다.');
 if(new Set(trendUnits.map(u=>u.id)).size!==trendUnits.length)throw Error('유닛 ID 중복');
 if(trendUnits.filter(u=>u.action!=='exit').reduce((n,u)=>n+u.maxWeight,0)>1+.0001)throw Error('유닛 예산 합계는 100% 이하이어야 합니다.');
 if(trendUnits.some(u=>u.action==='exit'&&!u.exitReason.trim()))throw Error('유닛 청산 근거 필요');
 return {investmentIdeas,macroScorecard,trendUnits};
}
const age=(date,asOf)=>Date.parse(date+'T23:59:59Z')-Date.parse(asOf);
export function macroComplete(s,region){
 return macroFactors.every(f=>s.externalResearch?.macroScorecard?.some(r=>r.region===region&&r.factor===f&&r.signal!=='unknown'&&r.reason.trim()&&r.sourceUrls.length&&age(s.date,r.observedAt)>=-86400000&&age(s.date,r.observedAt)<=120*86400000));
}
export function proposalFor(s,symbol){
 return s.externalResearch?.trendUnits?.find(u=>u.action!=='exit'&&u.members.some(m=>m.symbol===symbol));
}
export function unitEntryCheck(s,symbol,direction,unitId,now=Date.now()){
 if(s.mode!=='live'||!(s.investmentProcessVersion>=4))return {pass:true,reason:'기존 방식'};
 const u=unitId?s.externalResearch?.trendUnits?.find(u=>u.id===unitId):proposalFor(s,symbol);
 const episode=s.trendUnits?.find(x=>x.id===u?.id);
 const idea=ideaFor(s,u?.ideaId);
 const concept=s.investmentProcessVersion<5||(ideaEntryCheck(s,symbol,u?.ideaId,now).pass&&idea.referenceIndex.name.trim()&&age(s.date,idea.referenceIndex.asOf)>=-86400000&&age(s.date,idea.referenceIndex.asOf)<=120*86400000);
 const pass=concept&&!!u&&u.referenceIndex.name.trim()&&u.members.every(m=>m.reason.trim())&&s.externalResearch?.fresh!==false&&u.action==='hold'&&u.direction===direction&&u.members.some(m=>m.symbol===symbol)&&memberCountries(u.members).every(region=>macroComplete(s,region))&&u.thesis.trim()&&u.catalyst.trim()&&u.invalidation.trim()&&u.riskBasis.trim()&&u.allocationReason.trim()&&age(s.date,u.referenceIndex.asOf)>=-86400000&&age(s.date,u.referenceIndex.asOf)<=120*86400000&&u.regime!=='unknown'&&(u.regime!=='longBear'||u.riskProfile==='defensive')&&(!episode||(episode.status==='active'&&episode.direction===direction&&episode.members.some(m=>m.symbol===symbol)));
 return {pass:!!pass,reason:pass?'유닛·매크로·참조지수 근거 확인':'유닛·매크로·참조지수 근거 미충족 또는 축소·종료된 유닛',unit:u};
}
export function episodeFor(s,p){return s.trendUnits?.find(u=>u.id===p.unitId);}
export function unitWeightLimit(s,p){return episodeFor(s,p)?.maxWeight??s.externalResearch?.trendUnits?.find(u=>u.id===p.unitId)?.maxWeight??0;}
export function addMonths(date,n){const d=new Date(date+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);}
export function recordUnitEntry(s,p,cost){
 if(!p.unitId)return;
 s.trendUnits??=[];
 let u=episodeFor(s,p);
 if(!u){const proposal=s.externalResearch.trendUnits.find(u=>u.id===p.unitId);u={...structuredClone(proposal),status:'active',openedAt:s.date,expiresAt:addMonths(s.date,proposal.horizonMonths),capital:0,realizedPnl:0,softTriggered:false,reviewLog:[]};s.trendUnits.push(u);}
 u.capital+=cost;
}
export function unitSnapshot(s,u,{unrealized}){
 const holdings=s.holdings.filter(h=>h.unitId===u.id),pnl=(u.realizedPnl||0)+holdings.reduce((n,h)=>n+unrealized(s,h),0);
 return {id:u.id,name:u.name,status:u.status,capital:u.capital,pnl,return:u.capital>0?pnl/u.capital:0,holdings:holdings.map(h=>h.symbol),targetReturn:u.targetReturn,lossLimit:u.lossLimit,maxWeight:u.maxWeight,openedAt:u.openedAt,expiresAt:u.expiresAt,softTriggered:u.softTriggered,reviewLog:u.reviewLog??[]};
}
export function monitorUnits(s,{unrealized,now,quotes,riskOnly=false,researchReviewed=false}){
 for(const u of s.trendUnits||[]){
  if(u.status==='closed')continue;
  const holdings=s.holdings.filter(h=>h.unitId===u.id);
  if(!holdings.length)continue;
  const proposal=s.externalResearch?.trendUnits?.find(x=>x.id===u.id);
  const idea=ideaFor(s,u.ideaId),research=s.externalResearch;
  const withdrawn=idea?.action==='withdraw'&&idea.withdrawalReason?.trim()&&idea.sourceUrls?.length&&Math.abs(now-Date.parse(idea.asOf))<36*3600000;
  const thesisExit=researchReviewed&&!riskOnly&&research?.fresh===true&&Math.abs(now-Date.parse(research.asOf))<36*3600000&&(proposal?.action==='exit'||withdrawn);
  const fresh=!quotes||holdings.every(h=>quotes[h.symbol].time>(u.lastQuoteTimes?.[h.symbol]??h.lastCheckedQuoteTime??h.signalTimestamp??0));
  const expired=s.date>=u.expiresAt;
  if(!fresh&&!expired&&!thesisExit)continue;
  const stats=unitSnapshot(s,u,{unrealized});
  const hard=fresh&&stats.return<=-u.lossLimit,target=fresh&&stats.return>=u.targetReturn;
  const soft=fresh&&!u.softTriggered&&stats.return<=-u.lossLimit/2;
  const full=hard||target||expired||thesisExit;
  if(full||soft){
   const riskExit=!!(hard||target||expired||!thesisExit);
   const reason=hard?'유닛 손실 한도 전액 도달':target?'유닛 목표수익 도달':expired?'유닛 투자기한 도래':thesisExit?'유닛 투자논리 훼손: '+(withdrawn?idea.withdrawalReason:proposal.exitReason):'유닛 손실 한도 50% 도달: 절반 축소';
   u.status=full||u.status==='closing'?'closing':'reduced';if(soft)u.softTriggered=true;
   u.reviewLog.push({date:s.date,reason,return:stats.return});
   for(const h of holdings){
    if(s.plans.some(p=>p.symbol===h.symbol&&['sell','cover'].includes(p.side)&&p.status==='승인'&&p.qty>=h.qty&&(!riskExit||p.riskExit)))continue;
    // Keep the reviewed full exit separate so risk-only execution cannot inherit its discretionary quantity.
    for(const p of s.plans.filter(p=>p.symbol===h.symbol&&['sell','cover'].includes(p.side)&&['대기','승인','보류'].includes(p.status))){
     if(!full&&p.status==='승인'&&p.riskExit===false&&p.qty>=h.qty)continue;
     p.status='취소';
    }
    s.plans.push({id:`P${s.nextId++}`,symbol:h.symbol,unitId:u.id,ideaId:h.ideaId,qty:full?h.qty:Math.max(1,Math.floor(h.qty/2)),date:s.date,side:h.direction==='short'?'cover':'sell',reference:h.entry,stop:h.stop,target:h.target,strategy:h.strategy,status:'승인',reason,unitExit:true,riskExit,signalTimestamp:h.lastCheckedQuoteTime??h.signalTimestamp??0});
   }
   for(const p of s.plans.filter(p=>p.unitId===u.id&&['buy','short'].includes(p.side)&&['대기','승인','보류'].includes(p.status))){p.status='만료';p.reason=reason;}
  }else if(u.softTriggered&&fresh&&stats.return>-u.lossLimit/2&&!u.recoveryReview){u.recoveryReview={date:s.date,reason:'손실 반회복: 재확대는 새 유닛 편입 심사 필요'};u.reviewLog.push(u.recoveryReview);}
  if(fresh)u.lastQuoteTimes=Object.fromEntries(holdings.map(h=>[h.symbol,quotes?.[h.symbol]?.time??now]));
 }
}
export function styleScore(metrics,technicalScore,ff3Alpha=null){
 const clamp=x=>Math.max(0,Math.min(100,x));
 const values={value:Number.isFinite(metrics?.pe)&&metrics.pe>0?clamp(100-metrics.pe*2):null,quality:Number.isFinite(metrics?.roe)?clamp(metrics.roe*500):null,growth:Number.isFinite(metrics?.revenueGrowth)?clamp(50+metrics.revenueGrowth*200):null,momentum:Number.isFinite(technicalScore)?clamp(technicalScore):null,ff3Alpha:Number.isFinite(ff3Alpha)?clamp(ff3Alpha):null,size:null,dividend:null,earningsRevision:null};
 const available=Object.values(values).filter(Number.isFinite);
 return {values,score:available.length>=3?available.reduce((a,b)=>a+b,0)/available.length:null,method:'가용 요소 단순 동등가중(quantMethod 참조), MSCI 공식 점수 아님'};
}
export function historicalRisk(bars){
 const closes=bars.map(b=>b.close).filter(x=>Number.isFinite(x)&&x>0);
 const daily=closes.slice(1).map((x,i)=>x/closes[i]-1),sample=daily.slice(-252);
 const avg=sample.reduce((a,b)=>a+b,0)/sample.length;
 const volatility=sample.length>=60?Math.sqrt(sample.reduce((n,r)=>n+(r-avg)**2,0)/sample.length)*Math.sqrt(252):null;
 const losses=closes.slice(60).map((x,i)=>1-x/closes[i]).sort((a,b)=>a-b),q=p=>losses.length>=120?Math.max(0,losses[Math.ceil(losses.length*p)-1]):null;
 return {volatility,var60d90:q(.9),var60d95:q(.95),samples:losses.length,method:'과거 중첩 60거래일 수익률의 손실 분위수. 독립 표본·미래 최대손실 보장 아님'};
}
export function basketRisk(s,u,barsFor){
 const statistics=u.members.map(m=>({symbol:m.symbol,weight:m.weight,...historicalRisk(barsFor(s,m.symbol))}));
 const weighted=key=>statistics.every(m=>Number.isFinite(m[key]))?statistics.reduce((n,m)=>n+m.weight*m[key],0):null;
 const correlations=[];
 for(let i=0;i<u.members.length;i++)for(let j=i+1;j<u.members.length;j++){
  const a=barsFor(s,u.members[i].symbol),b=barsFor(s,u.members[j].symbol);
  const map=new Map(b.filter(x=>typeof x.date==='string').map(x=>[x.date,x.close]));
  const aligned=a.filter(x=>typeof x.date==='string'&&map.has(x.date)).slice(-253);
  if(aligned.length<61)continue;
  const x=[],y=[];for(let k=1;k<aligned.length;k++){x.push(aligned[k].close/aligned[k-1].close-1);y.push(map.get(aligned[k].date)/map.get(aligned[k-1].date)-1);}
  const avg=v=>v.reduce((n,r)=>n+r,0)/v.length,mx=avg(x),my=avg(y);
  const covariance=x.reduce((n,r,k)=>n+(r-mx)*(y[k]-my),0),den=Math.sqrt(x.reduce((n,r)=>n+(r-mx)**2,0)*y.reduce((n,r)=>n+(r-my)**2,0));
  if(den>0)correlations.push({a:u.members[i].symbol,b:u.members[j].symbol,correlation:covariance/den,samples:x.length});
 }
 return {id:u.id,weightedIndividualVolatility:weighted('volatility'),weightedIndividualVar60d95:weighted('var60d95'),correlations,concentrationPairs:correlations.filter(x=>x.correlation>=.8),limitations:'종목별 위험값의 가중평균은 바스켓 VaR와 다릅니다. 공통 관측일의 상관은 참고치이며 미관측 시 계산하지 않습니다.'};
}

// Dated return intervals prevent a missing trading day from becoming a one-day return.
function datedReturns(bars){
 const valid=bars.filter(b=>/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&Number.isFinite(b.close)&&b.close>0).sort((a,b)=>a.date.localeCompare(b.date)).slice(-253),result=new Map();
 for(let i=1;i<valid.length;i++)if(valid[i].date>valid[i-1].date)result.set(valid[i-1].date+':'+valid[i].date,valid[i].close/valid[i-1].close-1);
 return result;
}
function returnCorrelation(a,b){
 const keys=[...a.keys()].filter(k=>b.has(k));if(keys.length<60)return null;
 const x=keys.map(k=>a.get(k)),y=keys.map(k=>b.get(k)),mean=v=>v.reduce((n,r)=>n+r,0)/v.length,mx=mean(x),my=mean(y);
 const den=Math.sqrt(x.reduce((n,r)=>n+(r-mx)**2,0)*y.reduce((n,r)=>n+(r-my)**2,0));
 return den>0?{correlation:Math.max(-1,Math.min(1,x.reduce((n,r,i)=>n+(r-mx)*(y[i]-my),0)/den)),samples:keys.length}:null;
}
export function portfolioUnitRisk(s,barsFor){
 const configured=new Map((s.trendUnits??[]).filter(u=>u.status!=='closed').map(u=>[u.id,u]));
 for(const u of s.externalResearch?.trendUnits??[])if(u.action==='hold'&&!configured.has(u.id)&&!s.trendUnits?.some(e=>e.id===u.id&&e.status==='closed'))configured.set(u.id,u);
 const units=[...configured.values()],returns=new Map(units.map(u=>{
  const series=(u.members??[]).map(m=>({weight:m.weight,returns:datedReturns(barsFor(s,m.symbol)??[])})),keys=series.length?[...series[0].returns.keys()].filter(k=>series.every(x=>x.returns.has(k))):[];
  return [u.id,new Map(keys.map(k=>[k,series.reduce((n,x)=>n+x.weight*x.returns.get(k),0)*(u.direction==='short'?-1:1)]))];
 })),correlations=[],overlaps=[];
 for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){
  const a=units[i],b=units[j],corr=returnCorrelation(returns.get(a.id),returns.get(b.id));
  if(corr)correlations.push({a:a.id,b:b.id,...corr});
  const shared=(a.members??[]).filter(m=>(b.members??[]).some(x=>x.symbol===m.symbol)).map(m=>m.symbol);if(shared.length)overlaps.push({a:a.id,b:b.id,symbols:shared});
 }
 return {unitCount:units.length,correlations,concentrationPairs:correlations.filter(c=>c.correlation>=.8),overlaps,unavailablePairs:units.length*(units.length-1)/2-correlations.length,unavailableUnitIds:units.filter(u=>returns.get(u.id).size<60).map(u=>u.id),
  limitations:'현재 구성비 고정·공통 관측구간 60개 이상에서 계산한 참고 상관. 실제 유닛 운용 실적·역사적 환율·팩터 모델이 아니며 낮은 상관도 분산을 보장하지 않습니다.'};
}
export function unitPerformance(s){
 const episodes=[...new Map((s.trendUnits??[]).map(u=>[u.id,u])).values()],closed=episodes.filter(u=>u.status==='closed'&&u.capital>0&&Number.isFinite(u.realizedPnl));
 const average=xs=>xs.length?xs.reduce((n,x)=>n+x,0)/xs.length:null,days=(a,b)=>{const d=(Date.parse(b)-Date.parse(a))/86400000;return Number.isFinite(d)&&d>=0?d:null;};
 const returns=closed.map(u=>u.realizedPnl/u.capital),wins=returns.filter(r=>r>0),losses=returns.filter(r=>r<0),targets=closed.filter(u=>u.reviewLog?.some(x=>x.reason==='유닛 목표수익 도달'));
 return {closed:closed.length,active:episodes.filter(u=>u.status!=='closed').length,wins:wins.length,losses:losses.length,hitRatio:closed.length?wins.length/closed.length:null,targetHitRatio:closed.length?targets.length/closed.length:null,
  averageWin:average(wins),averageLoss:average(losses),averageReturn:average(returns),netPnl:closed.reduce((n,u)=>n+u.realizedPnl,0),
  averageHoldingDays:average(closed.map(u=>days(u.openedAt,u.closedAt)).filter(Number.isFinite)),averageDaysToTarget:average(targets.map(u=>days(u.openedAt,u.reviewLog.find(x=>x.reason==='유닛 목표수익 도달').date)).filter(Number.isFinite)),
  limitations:'종료 유닛 1개를 1회로 집계, 부분 청산 중복 제외. 실현손익에는 수수료·슬리피지·숏 대차료 반영. 목표 도달 관측과 실제 청산 수익을 구분하며 과거 성공률은 미래 확률이 아닙니다.'};
}
