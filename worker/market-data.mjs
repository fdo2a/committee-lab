import {companies,validateState,createState} from '../web/engine.mjs';
import {coreCompanies,eligibleCatalog} from '../web/universe.mjs';
import {cleanFactors} from '../web/fama-french.mjs';

const zones={'한국':'Asia/Seoul','미국':'America/New_York','일본':'Asia/Tokyo'};
const localDate=(time,zone)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time)).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`};
export function hasRegularMarketSession(snapshot,now=Date.now(),countries=null){
 return companies.some(c=>{
  if(countries&&!countries.includes(c.country))return false;
  const q=snapshot?.quotes?.[c.symbol],date=localDate(now,zones[c.country]);
  return q?.regularSessions?.some(s=>s.date===date&&s.openTime<=now/1000&&q.time>=s.openTime);
 });
}
function cleanSessions(input,company,fetchedAt,now,bars){
 const sessions=input??[];
 if(!Array.isArray(sessions)||sessions.length>5)throw Error('정규장 세션은 최근 5개 이하여야 합니다.');
 const seen=new Set();
 return sessions.map(s=>{
  if(!s||typeof s.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||seen.has(s.date)||!Number.isFinite(s.open)||s.open<=0||!Number.isFinite(s.openTime)||!Number.isFinite(s.closeTime)||s.openTime<=0||s.openTime>=s.closeTime||s.closeTime-s.openTime>86400||s.openTime>now||s.openTime>fetchedAt||localDate(s.openTime*1000,zones[company.country])!==s.date||typeof s.complete!=='boolean')throw Error('정규장 시가·날짜·제공기관 시작/종료 시각 확인 실패');
  if(s.complete?(!Number.isFinite(s.close)||s.close<=0||s.closeTime>fetchedAt||s.closeTime>now):s.close!==null)throw Error('확정 정규장 종가 또는 미확정 null 확인 실패');
  const daily=bars.find(b=>b.time===s.openTime);
  if(!daily||daily.open!==s.open||(s.complete&&daily.close!==s.close))throw Error('정규장 이벤트는 수집한 실제 일봉 시가·종가와 일치해야 합니다.');
  seen.add(s.date);
  return {date:s.date,open:s.open,close:s.close,openTime:s.openTime,closeTime:s.closeTime,complete:s.complete};
 }).sort((a,b)=>a.openTime-b.openTime);
}
export function validateMarket(snapshot,now=Date.now(),reviewStartedAt=null){
 const fetchedAt=Date.parse(snapshot?.fetchedAt);
 if(!snapshot||snapshot.provider!=='Yahoo Finance / Python'||typeof snapshot.fetchedAt!=='string'||!Number.isFinite(fetchedAt))throw Error('Python 가격 수집 결과가 필요합니다.');
 // Only verified preopen queue evidence uses the fixed review clock; executions use fetchedAt.
 const fresh=reviewStartedAt===null?Math.abs(now-fetchedAt)<=30*60000:Number.isSafeInteger(reviewStartedAt)&&fetchedAt<=reviewStartedAt&&reviewStartedAt-fetchedAt<=30*60000&&reviewStartedAt<=now&&now-reviewStartedAt<30*60000;
 if(!fresh)throw Object.assign(Error('가격 자료 또는 검토 창이 만료됐습니다.'),{reason:'priceEvidenceStale'});
 const {data,quotes,fx}=snapshot;
 if(!quotes||!fx||!Number.isFinite(fx.USD)||fx.USD<500||fx.USD>3000||!Number.isFinite(fx.JPY)||fx.JPY<3||fx.JPY>30||fx.KRW!==1)throw Error('환율 확인 실패');
 const symbols=Object.keys(data??{}),core=symbols.length===coreCompanies.length&&coreCompanies.every(c=>symbols.includes(c.symbol));
 const universe=core?coreCompanies:symbols.map(symbol=>eligibleCatalog.find(c=>c.symbol===symbol));
 if(!symbols.length||universe.some(c=>!c))throw Error('허용 지수 내 가격 유니버스 전체 종목 확인 실패');
 if(snapshot.activeSymbols&&(snapshot.activeSymbols.length!==symbols.length||new Set(snapshot.activeSymbols).size!==symbols.length||snapshot.activeSymbols.some(symbol=>!symbols.includes(symbol))))throw Error('선정 종목과 가격 목록 불일치');
 const validation=createState();validation.plans=[];validation.holdings=[];validation.trades=[];validation.mode='live';validation.universeVersion=core?'core24':'indexCatalog';if(!core)validation.activeSymbols=symbols;validation.data=data;validateState(validation);
 const checkedQuotes={};
 for(const c of universe){
  const q=quotes[c.symbol];
  if(!q||!Number.isFinite(q.price)||q.price<=0||!Number.isFinite(q.time)||q.time<=0||q.time>now/1000+300||q.currency!==c.currency)throw Error('최근 가격 시점 확인 실패');
  checkedQuotes[c.symbol]={...q,regularSessions:cleanSessions(q.regularSessions,c,fetchedAt/1000,now/1000,data[c.symbol])};
 }
 return {data,quotes:checkedQuotes,fx,factors:cleanFactors(snapshot.factors),activeSymbols:symbols,universeVersion:validation.universeVersion,fetchedAt:snapshot.fetchedAt,provider:snapshot.provider,notes:'실제 일봉·정규장 세션. 미확정 종가·세션 시각 누락은 체결 대기. 최근 가격은 평가용. 지연·휴장 가능. 배당 미반영.'};
}
