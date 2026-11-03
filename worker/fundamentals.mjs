import {companies} from '../web/engine.mjs';
import {FUNDAMENTALS_CHECK_NAME,fundamentalsCurrent} from '../web/fundamentals-freshness.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
// Re-reviewing a stored review must give the same verdict: the output keeps the collected currency, period,
// metrics, sources and fetchedAt under the names this function reads.
export function fundamentalReview(symbol,input,quote,now=Date.now()){
 const c=companies.find(x=>x.symbol===symbol),checks=[],f=input||{},m=f.metrics||{};
 const add=(name,pass)=>checks.push({name,pass:!!pass});
 const age=(now-Date.parse(f.periodEnd))/86400000;
 add(FUNDAMENTALS_CHECK_NAME,fundamentalsCurrent(f,now));
 add('연간 재무 기간·통화 확인',f.periodType==='12M'&&f.currency===c.currency&&age>=0&&age<=550);
 add('재무 출처 확인',Array.isArray(f.sources)&&f.sources.some(x=>/^https:\/\/finance\.yahoo\.com\//.test(x.url)));
 add('동일 기간 필수 계정 확인',['revenue','priorRevenue','netIncome','equity','eps'].every(k=>finite(m[k]))&&m.revenue>0&&m.priorRevenue>0&&m.equity>0&&m.eps>0);
 const revenueGrowth=finite(m.revenue)&&m.priorRevenue>0?m.revenue/m.priorRevenue-1:null;
 const pe=m.eps>0?quote.price/m.eps:null;
 const roe=m.equity>0?m.netIncome/m.equity:null;
 add('흑자·매출 급감 아님',m.netIncome>0&&finite(revenueGrowth)&&revenueGrowth>=-0.15);
 const growthValuation=m.revenue>=m.priorRevenue*1.15&&finite(roe)&&roe>=.1&&finite(m.operatingCashFlow)&&m.operatingCashFlow>0;
 // User-requested loosening 2026-10-25: 45/60 -> 60/80 (6981 at 50x, 6857 at 63x with growth were held).
 const peLimit=growthValuation?80:60;
 add(`연간 EPS 기준 PER ${peLimit}배 이하${growthValuation?' (성장15%·ROE10%·양수 영업현금흐름)':''}`,finite(pe)&&pe>0&&pe<=peLimit);
 if(c.sector==='금융')add('금융업 자기자본 이익률 5% 이상',finite(roe)&&roe>=0.05);
 else{
  add('영업현금흐름 양수',finite(m.operatingCashFlow)&&m.operatingCashFlow>0);
  // Yahoo omits totalDebt for some low-debt filers (8035, 6146, 6920, 6526); a missing figure no longer fails on its own.
  add(finite(m.debt)?'총차입금/자기자본 4배 이하':'총차입금 미제공 (흑자·영업현금흐름 양수 조건으로 대체)',finite(m.debt)?m.debt>=0&&m.equity>0&&m.debt/m.equity<=4:m.debt==null);
 }
 const failed=checks.filter(x=>!x.pass).map(x=>x.name);
 return {symbol,pass:failed.length===0,checks,metrics:{...Object.fromEntries(['revenue','priorRevenue','netIncome','operatingCashFlow','freeCashFlow','equity','debt','eps'].map(k=>[k,finite(m[k])?m[k]:null])),revenueGrowth,pe,roe,peLimit},periodEnd:typeof f.periodEnd==='string'?f.periodEnd:null,periodType:f.periodType==='12M'?'12M':null,fetchedAt:typeof f.fetchedAt==='string'?f.fetchedAt:null,currency:typeof f.currency==='string'?f.currency:c.currency,sources:Array.isArray(f.sources)?f.sources.filter(x=>typeof x.url==='string'&&x.url.startsWith('https://')).slice(0,4):[],text:failed.length?`재무 보류: ${failed.join(', ')}`:`${f.periodEnd} 연간 재무 · 매출 ${m.revenue.toLocaleString('ko-KR')} ${c.currency}, 전년 대비 ${(revenueGrowth*100).toFixed(1)}%, 순이익 ${m.netIncome.toLocaleString('ko-KR')}, 영업현금흐름 ${finite(m.operatingCashFlow)?m.operatingCashFlow.toLocaleString('ko-KR'):'미제공'}, EPS ${m.eps}, 수집 가격 기준 연간 PER ${pe.toFixed(1)}배 (한도 ${peLimit}배). 연구용 기준 통과.`,limitations:'Yahoo 집계 연간 재무 기준. 최신 분기·공시 원문과 회계 차이의 추가 검토가 필요하며 현재 수익가치를 보장하지 않습니다.'};
}
