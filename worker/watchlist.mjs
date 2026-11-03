import {eligibleCatalog} from '../web/universe.mjs';
export function validateWatchlist(input,now=Date.now()){
 if(input?.provider!=='Yahoo Finance / Python'||!Number.isFinite(Date.parse(input.fetchedAt))||Math.abs(now-Date.parse(input.fetchedAt))>1800000)throw Error('30분 이내 실제 전체 감시 자료가 필요합니다.');
 if(!Array.isArray(input.observations)||!Array.isArray(input.failures))throw Error('감시 자료 형식 오류');
 const catalog=new Map(eligibleCatalog.map(c=>[c.symbol,c])),seen=new Set();
 const observations=input.observations.map(x=>{
  const c=catalog.get(x?.symbol);
  if(!c||seen.has(x.symbol)||!Number.isFinite(x.price)||x.price<=0||!Number.isFinite(x.time)||x.time<=0||x.time>now/1000+300||x.currency!==c.currency||!Number.isInteger(x.bars)||x.bars<1||!(x.momentum===null||Number.isFinite(x.momentum))||!(x.averageTurnover===null||(Number.isFinite(x.averageTurnover)&&x.averageTurnover>=0)))throw Error('실제 감시 가격·시점·종목 확인 실패');
  seen.add(x.symbol);return {symbol:x.symbol,price:x.price,time:x.time,currency:x.currency,momentum:x.momentum,averageTurnover:x.averageTurnover,bars:x.bars};
 });
 const failures=input.failures.map(x=>{if(!catalog.has(x?.symbol)||seen.has(x.symbol)||typeof x.reason!=='string'||x.reason.length>200)throw Error('감시 누락 형식 오류');seen.add(x.symbol);return {symbol:x.symbol,reason:x.reason};});
 if(seen.size!==catalog.size)throw Error('허용 지수 전체의 수집 결과 또는 누락 사유가 필요합니다.');
 return {provider:input.provider,fetchedAt:input.fetchedAt,observations,failures,count:observations.length,complete:failures.length===0};
}
