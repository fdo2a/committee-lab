import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,approve,risk,equity,researchForUnit} from '../web/engine.mjs';
import * as process from '../web/trend-units.mjs';
import {eligibleIdeaAccount,testNow} from './idea-fixtures.mjs';
import {companies} from '../web/universe.mjs';
import {quantScreening,quantMethod} from '../web/quant-research.mjs';

test('quant compares the whole discovery pool and marks 30 for deeper selection without deleting others',()=>{
 const s=eligibleIdeaAccount(),idea=s.externalResearch.investmentIdeas[0],symbols=companies.filter(c=>c.country==='한국').slice(0,40).map(c=>c.symbol);
 idea.candidates=symbols.map(symbol=>({symbol,reason:'직접·간접 수혜 비교'}));
 for(const symbol of symbols)s.fundamentals[symbol]=structuredClone(s.fundamentals['005930']);
 const q=quantScreening(s,symbols.map(symbol=>({symbol,technicalScore:75})),testNow)[0];
 assert.equal(q.candidates.length,40);assert.equal(q.rankedCount,40);assert.equal(q.shortlistCount,30);assert.equal(q.candidates.filter(c=>c.shortlisted).length,30);assert.equal(q.candidates.at(-1).rank,40);
 assert.equal(quantMethod.candidateLimit,100);assert.deepEqual(quantMethod.preferredCandidates,{min:20,max:60});
});

test('quant ranks only the sourced idea candidates and preserves management selection reasons',()=>{
 const s=eligibleIdeaAccount();s.fundamentals['005930'].metrics={pe:8,roe:.2,revenueGrowth:.3};
 analyze(s,testNow);
 const q=s.analysis.quantResearch?.find(q=>q.ideaId==='kr-ai');assert.ok(q);
 assert.deepEqual(q.candidates.map(c=>c.symbol),['005930','000660']);
 assert.equal(q.candidates[0].rank,1);assert.equal(q.candidates[0].selection,'selected');
 assert.equal(q.candidates[0].selectionReason,'최종 선정');
 assert.equal(q.candidates[0].style.values.earningsRevision,null);
 assert.equal(q.candidates[0].style.values.size,null);
 assert.ok(s.plans.find(p=>p.symbol==='005930').managementReview.quant.rank===1);
});
test('quant does not reward missing factors; stale financials still block approval',()=>{
 for(const [mutate,blocked] of [[s=>delete s.fundamentals['005930'].metrics.roe,false],[s=>s.fundamentals['005930'].fetchedAt=new Date(testNow-31*86400000).toISOString(),true]]){
  const s=eligibleIdeaAccount();analyze(s,testNow);const p=s.plans.find(p=>p.symbol==='005930'&&p.status==='대기');assert.ok(p);
  mutate(s);assert.equal(risk(s,p,undefined,testNow).pass,!blocked);
  if(blocked)assert.throws(()=>approve(s,p.id,testNow));
  analyze(s,testNow);const q=s.analysis.quantResearch.find(q=>q.ideaId==='kr-ai');
  assert.equal(q.candidates.find(c=>c.symbol==='005930').rank,null);
  assert.equal(q.candidates.find(c=>c.symbol==='000660').ready,true);
 }
});
test('quant decides which candidate is planned first, not whether: unranked candidates follow ranked ones',()=>{
 const s=eligibleIdeaAccount();delete s.fundamentals['005930'].metrics.roe;analyze(s,testNow);
 const r=s.analysis.reports.find(r=>r.symbol==='005930');
 assert.notEqual(r.managementReason,'퀀트 필수 팩터 또는 최신 재무 숫자 미확인');
 const order=s.plans.filter(p=>['005930','000660'].includes(p.symbol)).map(p=>p.symbol);
 assert.deepEqual(order,['000660','005930']);
});
test('reviewed sourced fresh idea withdrawal queues existing unit liquidation without a proposal exit',()=>{
 const s=eligibleIdeaAccount(),proposal=s.externalResearch.trendUnits[0];
 s.trendUnits=[{...proposal,status:'active',openedAt:'2026-10-01',expiresAt:'2026-12-01',capital:100000,realizedPnl:0,reviewLog:[]}];
 s.holdings=[{symbol:'005930',unitId:proposal.id,qty:1,direction:'short',entry:100000,stop:120000,target:80000}];
 const idea=s.externalResearch.investmentIdeas[0];idea.action='withdraw';idea.withdrawalReason='실제 수요 가정 훼손';
 process.monitorUnits(s,{unrealized:()=>0,now:testNow,quotes:s.marketData.quotes,researchReviewed:true});
 assert.equal(s.trendUnits[0].status,'closing');assert.equal(s.plans[0].side,'cover');assert.match(s.plans[0].reason,/실제 수요 가정 훼손/);
 const stale=eligibleIdeaAccount();stale.trendUnits=structuredClone(s.trendUnits);stale.trendUnits[0].status='active';stale.holdings=structuredClone(s.holdings);stale.externalResearch.investmentIdeas[0]=idea;stale.externalResearch.asOf='2026-09-01';
 process.monitorUnits(stale,{unrealized:()=>0,now:testNow,quotes:stale.marketData.quotes,researchReviewed:true});assert.equal(stale.plans.length,0);
});
test('unit correlation uses common dated returns and detects hidden basket concentration',()=>{
 assert.equal(typeof process.portfolioUnitRisk,'function');
 const bars=Array.from({length:90},(_,i)=>({date:new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10),close:100*Math.exp(.001*i+.02*Math.sin(i))}));
 const units=[{id:'a',action:'hold',direction:'long',maxWeight:.3,members:[{symbol:'x',weight:1}]},{id:'b',action:'hold',direction:'long',maxWeight:.2,members:[{symbol:'y',weight:1}]}];
 const result=process.portfolioUnitRisk({externalResearch:{trendUnits:units}},(_s,symbol)=>symbol==='x'?bars:bars.map(b=>({...b,close:b.close*2})));
 assert.equal(result.correlations.length,1);assert.ok(Math.abs(result.correlations[0].correlation-1)<1e-10);assert.equal(result.concentrationPairs.length,1);
 assert.equal(process.portfolioUnitRisk({externalResearch:{trendUnits:units}},()=>bars.map(b=>({close:b.close}))).correlations.length,0);
});
test('idea KPI counts completed units once and separates profit hit ratio from target attainment',()=>{
 assert.equal(typeof process.unitPerformance,'function');
 const s={trendUnits:[
  {id:'a',status:'closed',capital:100,realizedPnl:10,openedAt:'2026-09-01',closedAt:'2026-09-15',reviewLog:[{date:'2026-09-14',reason:'유닛 목표수익 도달'}]},
  {id:'b',status:'closed',capital:200,realizedPnl:-10,openedAt:'2026-09-01',closedAt:'2026-09-21',reviewLog:[]},
  {id:'c',status:'active',capital:100,realizedPnl:5,openedAt:'2026-09-01',reviewLog:[]}
 ]};
 const k=process.unitPerformance(s);assert.equal(k.closed,2);assert.equal(k.active,1);assert.equal(k.hitRatio,.5);assert.equal(k.targetHitRatio,.5);
 assert.equal(k.averageWin,.1);assert.equal(k.averageLoss,-.05);assert.equal(k.averageHoldingDays,17);assert.equal(k.averageDaysToTarget,13);assert.equal(k.netPnl,0);
 assert.equal(process.unitPerformance({trendUnits:[]}).hitRatio,null);
});
test('legacy units without constituent evidence remain visible as unavailable risk data',()=>{
 const result=process.portfolioUnitRisk({trendUnits:[{id:'legacy',status:'active'},{id:'other',status:'reduced'}]},()=>[]);
 assert.equal(result.unitCount,2);assert.equal(result.unavailablePairs,1);assert.deepEqual(result.unavailableUnitIds,['legacy','other']);assert.deepEqual(result.correlations,[]);
});
test('risk management shrinks a lower-ranked plan to the room left by higher-ranked plans instead of rejecting it',()=>{
 const s=eligibleIdeaAccount(),sector=companies.find(c=>c.symbol==='005930').sector;
 const other=companies.find(c=>c.country==='한국'&&c.sector!==sector&&s.data[c.symbol]),price=s.data[other.symbol].at(-1).close,qty=Math.floor(equity(s)*.85/price);
 s.holdings=[{symbol:other.symbol,direction:'long',qty,entry:price,cost:qty*price,stop:price,target:price*2,strategy:'x'}];s.cash-=qty*price;
 analyze(s,testNow);
 const [first,second]=s.plans.sort((a,b)=>a.selection.rank-b.selection.rank);
 assert.equal(first.status,'대기');assert.equal(second.status,'대기');
 assert.ok(second.qty<first.qty);assert.match(second.reason,/리스크관리부 수량 조정/);
 assert.equal(risk(s,second,undefined,testNow,[first]).pass,true);
 assert.equal(risk(s,{...second,qty:second.qty+1},undefined,testNow,[first]).pass,false);
});
test('technical entry signal ranks candidates but its absence does not block planning or approval',()=>{
 const s=eligibleIdeaAccount();
 s.strategyLearning=Object.fromEntries(researchForUnit(s,s.externalResearch.trendUnits[0].id).map(st=>[st.id,{scale:0}]));
 analyze(s,testNow);const p=s.plans.find(p=>p.symbol==='005930');
 assert.equal(p.status,'대기');assert.equal(p.strategy,'미검증');assert.equal(p.selection.signal,false);
 approve(s,p.id,testNow);assert.equal(p.status,'승인');
});
test('active trading limits: combined stop loss cap is 5% of equity',()=>{
 const s=eligibleIdeaAccount();analyze(s,testNow);const p=s.plans[0];
 assert.ok(risk(s,p,undefined,testNow).checks.some(([name])=>name==='합산 손절 손실 5% 이하'));
});
