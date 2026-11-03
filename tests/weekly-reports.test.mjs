import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyReportContext,saveWeeklyReport} from '../worker/weekly-reports.mjs';
import * as weekly from '../worker/weekly-reports.mjs';
import {weeklyReportsPage} from '../web/weekly-view.mjs';
import {cleanResearch} from '../worker/account.mjs';
import {ideaResearch} from './idea-fixtures.mjs';
import {quantScreening} from '../web/quant-research.mjs';
import {cleanFactors,FF3_SOURCE} from '../web/fama-french.mjs';
const now=Date.parse('2026-10-10T00:00:00Z');
function account(){return {revision:8,state:{history:[{date:'2026-10-04',timestamp:'2026-10-04T11:00:00Z',equity:100000000},{date:'2026-10-09',timestamp:'2026-10-09T23:00:00Z',equity:101200000},{date:'2026-10-10',timestamp:'2026-10-10T01:00:00Z',equity:102000000}],trades:[{id:'T1',symbol:'AAPL',side:'buy',date:'2026-10-05',fee:300,pnl:null},{id:'T2',symbol:'AAPL',side:'sell',date:'2026-10-09',fee:350,pnl:100000,borrowFee:0},{id:'T3',symbol:'MSFT',side:'buy',date:'2026-10-10',fee:500}],holdings:[],plans:[],externalResearch:null},metadata:{}};}
test('weekly results use the week baseline and Saturday09 cutoff without including later records',()=>{
 const c=weeklyReportContext(account(),[],'2026-10-05',now);
 assert.equal(c.metrics.startingEquity,100000000);assert.equal(c.metrics.endingEquity,101200000);
 assert.equal(c.metrics.pnl,1200000);assert.equal(c.metrics.returnRate,.012);
 assert.equal(c.metrics.executions,2);assert.equal(c.metrics.fees,650);assert.equal(c.metrics.realizedPnl,100000);
});
test('a partial first week does not invent an opening value or weekly return',()=>{
 const a=account();a.state.history.shift();const c=weeklyReportContext(a,[],'2026-10-05',now);
 assert.equal(c.metrics.startingEquity,null);assert.equal(c.metrics.pnl,null);assert.equal(c.metrics.returnRate,null);assert.equal(c.coverage.complete,false);
});
test('saving is idempotent by week and cannot change trades, cash or approvals',()=>{
 const a=account(),before=structuredClone(a.state);const input={weekStart:'2026-10-05',marketOverview:'한국·미국·일본 시황 근거',selectionReview:'종목 편입과 보류 이유',resultsReview:'모의 운용 결과와 비용',nextWeekPlan:'다음 주 조건과 일정',sources:[{title:'공식 공시',url:'https://www.sec.gov/'}]};
 const first=saveWeeklyReport(a,[],input,now);saveWeeklyReport(a,[],input,now);
 assert.equal(a.state.weeklyReports.length,1);assert.deepEqual(a.state.trades,before.trades);assert.deepEqual(a.state.plans,before.plans);assert.equal(first.metrics.pnl,1200000);
 assert.throws(()=>saveWeeklyReport(a,[],{...input,weekStart:'2026-10-12'},now));
 assert.throws(()=>saveWeeklyReport(a,[],{...input,sources:[{title:'bad',url:'javascript:alert(1)'}]},now));
});

function strategyState(){
 const s=account().state;s.externalResearch=ideaResearch();s.externalResearch.investmentIdeas[0].universeReason='금리와 AI 출하 환경에 반응하는 한국 반도체 후보군';
 s.fundamentals={'005930':{numericPass:true,metrics:{pe:12,roe:.15,revenueGrowth:.2},fetchedAt:'2026-10-05T00:00:00Z',periodEnd:'2026-03-31',sources:[{url:'https://example.com/financials'}]}};
 s.marketData={fetchedAt:'2026-10-05T00:00:00Z'};s.analysis={reports:[{symbol:'005930',momentum:.08,technicalScore:80,riskMetrics:{volatility:.3,var60d90:.12,var60d95:.18,samples:260}}],quantResearch:[{ideaId:'kr-ai',candidates:[{symbol:'005930',rank:1,ready:true,style:{score:75,values:{value:76,quality:75,growth:90,momentum:20,size:null,dividend:null}}}]}]};return s;
}
test('weekly scores, alpha evidence and ranks use the same five factors in both directions',()=>{
 // FF3 covers only US and Japan (user decision 2026-10-27), so the Korean fixture is renamed to Japanese symbols.
 const s=JSON.parse(JSON.stringify(strategyState()).replaceAll('005930','4062').replaceAll('000660','6479')),capturedAt=Date.parse('2026-10-05T01:00:00Z'),rows=[];
 s.data=Object.fromEntries(['4062','6479'].map(symbol=>[symbol,[{time:Date.UTC(2025,0,1,6)/1000,close:100}]]));
 for(let d=Date.UTC(2025,0,2,6),i=0;i<260;d+=86400000){
  const date=new Date(d);if([0,6].includes(date.getUTCDay()))continue;i++;
  const key=Number(date.toISOString().slice(0,10).replaceAll('-','')),mkt=Math.sin(i)*2,smb=Math.cos(i*.7),hml=Math.sin(i*.3),rf=.01;
  rows.push([key,mkt,smb,hml,rf]);
  for(const [symbol,alpha] of [['4062',.004],['6479',-.004]]){
   const bars=s.data[symbol],ret=rf/100+alpha+1.2*mkt/100+.5*smb/100-.3*hml/100+Math.cos(i*1.7)*.00001;
   bars.push({time:d/1000,close:bars.at(-1).close*(1+ret)});
  }
 }
 s.marketData.factors=cleanFactors({japan:{frequency:'daily',source:FF3_SOURCE+'Japan_3_Factors_Daily_CSV.zip',rows}});
 s.fundamentals['6479']=structuredClone(s.fundamentals['4062']);
 s.analysis.reports.push({...s.analysis.reports[0],symbol:'6479'});
 for(const direction of ['long','short']){
  s.externalResearch.trendUnits[0].direction=direction;
  s.analysis.quantResearch=quantScreening(s,s.analysis.reports,capturedAt);
  const stocks=weekly.weeklyStrategySnapshot(s,capturedAt).ideas[0].stocks;
  for(const stock of stocks){
   const q=s.analysis.quantResearch[0].candidates.find(c=>c.symbol===stock.symbol);
   assert.equal(stock.quantReady,true);assert.equal(stock.rank,q.rank);
   assert.equal(stock.quantScore,q.style.score);assert.deepEqual(stock.factors,q.style.values);assert.deepEqual(stock.ff3,q.ff3);
  }
  const positive=stocks.find(c=>c.symbol==='4062');
  assert.equal(positive.rank,direction==='long'?1:2);
  assert.equal(positive.factors.ff3Alpha,direction==='long'?100:0);
  assert.equal(positive.quantScore,direction==='long'?84.2:52.2);
 }
 const snapshot=weekly.weeklyStrategySnapshot(s,capturedAt),a=account();
 saveWeeklyReport(a,[{started_at:snapshot.capturedAt,report:{summary:{strategySnapshot:snapshot}}}],{weekStart:'2026-10-05',marketOverview:'시황',selectionReview:'선정',resultsReview:'결과',nextWeekPlan:'계획',sources:[]},now);
 const html=weeklyReportsPage(a.state,{esc:x=>String(x??''),num:String,pct:x=>(x*100).toFixed(1)+'%'});
 for(const label of ['FF3','알파 t값','시장 베타 1.20','규모(SMB) 베타 0.50','가치(HML) 베타 -0.30','R²','4요소 각 25%'])assert.ok(html.includes(label),label);
 delete s.marketData.factors;s.analysis.quantResearch=quantScreening(s,s.analysis.reports,capturedAt);
 const fallback=weekly.weeklyStrategySnapshot(s,capturedAt).ideas[0].stocks[0];
 assert.equal(fallback.factors.ff3Alpha,null);assert.equal(fallback.ff3,null);assert.equal(fallback.quantScore,65.25);
 s.marketData.fetchedAt='2026-10-11T00:00:00Z';
 const future=weekly.weeklyStrategySnapshot(s,capturedAt).ideas[0].stocks[0];assert.equal(future.quantReady,false);assert.equal(future.rank,null);
});
test('strategy evidence preserves universe reasons, six factors and risk units without demo data',()=>{
 const s=strategyState(),capturedAt=Date.parse('2026-10-05T01:00:00Z'),snapshot=weekly.weeklyStrategySnapshot(s,capturedAt);
 const idea=snapshot.ideas[0],stock=idea.stocks.find(x=>x.symbol==='005930');
 assert.equal(idea.universeReason,s.externalResearch.investmentIdeas[0].universeReason);assert.equal(idea.macro.topDown,s.externalResearch.topDown);
 assert.equal(stock.metrics.pe,12);assert.equal(stock.factors.size,null);assert.equal(stock.factors.dividend,null);assert.equal(stock.metrics.momentum20d,.08);assert.equal(stock.riskMetrics.var60d95,.18);
 assert.equal(stock.selectionReason,'최종 선정');assert.equal(idea.units[0].horizonMonths,2);
 s.fundamentals['005930'].metrics.pe=99;assert.equal(stock.metrics.pe,12);
 const stale=weekly.weeklyStrategySnapshot(s,Date.parse('2026-11-07T01:00:00Z')).ideas[0].stocks[0];assert.equal(stale.quantReady,false);assert.equal(stale.rank,null);
 s.fundamentals['005930'].fetchedAt='2026-10-11T00:00:00Z';assert.equal(weekly.weeklyStrategySnapshot(s,capturedAt).ideas[0].stocks[0].metrics.pe,null);
 assert.equal(cleanResearch(s.externalResearch).investmentIdeas[0].universeReason,idea.universeReason);
 const bad=structuredClone(s.externalResearch);bad.investmentIdeas[0].universeReason={reason:'invalid'};assert.throws(()=>cleanResearch(bad));
});
test('weekly strategy uses historical run evidence, rejects future snapshots and persists past ideas',()=>{
 const a=account(),s=strategyState(),snapshot=weekly.weeklyStrategySnapshot(s,Date.parse('2026-10-05T01:00:00Z'));
 const runs=[{started_at:snapshot.capturedAt,report:{summary:{strategySnapshot:snapshot}}},{started_at:'2026-10-09T01:00:00Z',report:{summary:{strategySnapshot:{...snapshot,capturedAt:'2026-10-11T01:00:00Z',ideas:[]}}}},{started_at:'2026-10-09T02:00:00Z',report:{summary:{strategySnapshot:{...snapshot,capturedAt:'2026-10-09T02:00:00Z',ideas:[]}}}}];
 a.state.externalResearch={topDown:'미래 시황'};
 const c=weeklyReportContext(a,runs,'2026-10-05',now);assert.equal(c.strategyReview.ideas.length,1);assert.equal(c.strategyReview.ideas[0].stocks[0].metrics.pe,12);assert.ok(c.writingGuide.selectionReview.includes('Universe'));
 const input={weekStart:'2026-10-05',marketOverview:'매크로 판단',selectionReview:'Universe·종목 선정',resultsReview:'운용 결과',nextWeekPlan:'조건부 교체',sources:[]};
 const report=saveWeeklyReport(a,runs,input,now);assert.deepEqual(report.strategyReview,c.strategyReview);
 assert.equal(weeklyReportContext(account(),[],'2026-10-05',now).strategyReview.available,false);
});
test('weekly view shows the strategy chain, missing factors and escapes research text',()=>{
 const a=account(),s=strategyState();s.plans=[{symbol:'005930',ideaId:'kr-ai',managementReview:{strategyValidation:{id:'S1',symbols:['000660','005930'],trainTrades:4,trades:2}}}];
 const snapshot=weekly.weeklyStrategySnapshot(s,Date.parse('2026-10-05T01:00:00Z'));snapshot.ideas[0].universeReason='<script>alert(1)</script>';
 const report=saveWeeklyReport(a,[{started_at:snapshot.capturedAt,report:{summary:{strategySnapshot:snapshot}}}],{weekStart:'2026-10-05',marketOverview:'매크로',selectionReview:'선정',resultsReview:'결과',nextWeekPlan:'계획',sources:[]},now);
 const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const html=weeklyReportsPage(a.state,{esc,num:x=>String(x),pct:x=>(x*100).toFixed(1)+'%'});
 for(const label of ['Macro Top-down','Universe','Value','Size','Quality','Dividend','Growth','Momentum','60거래일','95%','미수집','연율','바스켓 전략 S1','훈련 4건 / 검증 2건'])assert.ok(html.includes(label),label);
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('12.0배'));
 delete report.strategyReview;assert.ok(weeklyReportsPage(a.state,{esc,num:String,pct:String}).includes('당시 전략 기록 없음'));
});

test('weekly selection reasons explain the decision, not the nomination, for watch, reserve and exited stocks',()=>{
 const capturedAt=Date.parse('2026-10-05T01:00:00Z'),stock=(s,symbol)=>weekly.weeklyStrategySnapshot(s,capturedAt).ideas[0].stocks.find(x=>x.symbol===symbol);
 // Watch-only research: no basket, the management review says why.
 const watch=strategyState();watch.externalResearch.trendUnits=[];watch.externalResearch.investmentIdeas[0].managementReview={status:'watch',reason:'밸류에이션 확인 전 관찰',sourceUrls:[]};
 assert.deepEqual([stock(watch,'005930').selection,stock(watch,'005930').selectionReason,stock(watch,'005930').candidateReason],['watch','밸류에이션 확인 전 관찰','사업 관련 후보']);
 // Reserve: not the nomination reason.
 const reserve=strategyState(),u=reserve.externalResearch.trendUnits[0];u.members=[{symbol:'005930',weight:1,reason:'최종 선정'}];u.reserves=['000660'];
 assert.equal(stock(reserve,'000660').selection,'reserve');assert.match(stock(reserve,'000660').selectionReason,/예비 후보/);
 // An exited basket no longer reports its members as selected.
 const exited=strategyState();Object.assign(exited.externalResearch.trendUnits[0],{action:'exit',exitReason:'수요 둔화로 철회'});
 assert.deepEqual([stock(exited,'005930').selection,stock(exited,'005930').selectionReason],['exited','수요 둔화로 철회']);
 // The page labels the reason by decision and keeps the nomination reason apart.
 const html=weeklyReportsPage({weeklyReports:[{period:{start:'2026-10-05',end:'2026-10-09'},coverage:{complete:true,limitation:''},metrics:{pnl:0,returnRate:0,endingEquity:1,executions:0,fees:0,realizedPnl:0},sources:[],marketOverview:'',selectionReview:'',resultsReview:'',nextWeekPlan:'',strategyReview:{available:true,snapshotCount:1,asOf:'x',limitation:'',ideas:weekly.weeklyStrategySnapshot(watch,capturedAt).ideas}}]},{esc:x=>String(x),num:String,pct:String});
 assert.match(html,/<span class="cell-label">관찰 이유<\/span>밸류에이션 확인 전 관찰<\/p><p class="cell-line muted"><span class="cell-label">후보 사유<\/span>사업 관련 후보<\/p>/);
 // Reports saved before candidateReason existed: the stored nomination reason is shown as 후보 사유.
 const legacyIdea={...weekly.weeklyStrategySnapshot(watch,capturedAt).ideas[0]};legacyIdea.stocks=legacyIdea.stocks.map(({candidateReason,...x})=>({...x,selectionReason:'사업 관련 후보'}));
 const legacyHtml=weeklyReportsPage({weeklyReports:[{period:{start:'2026-10-05',end:'2026-10-09'},coverage:{complete:true,limitation:''},metrics:{pnl:0,returnRate:0,endingEquity:1,executions:0,fees:0,realizedPnl:0},sources:[],marketOverview:'',selectionReview:'',resultsReview:'',nextWeekPlan:'',strategyReview:{available:true,snapshotCount:1,asOf:'x',limitation:'',ideas:[legacyIdea]}}]},{esc:x=>String(x),num:String,pct:String});
 assert.match(legacyHtml,/<span class="cell-label">관찰 이유<\/span>밸류에이션 확인 전 관찰<\/p><p class="cell-line muted"><span class="cell-label">후보 사유<\/span>사업 관련 후보<\/p>/);
});

test('weekly selection keeps the latest exit decision when a held episode exists',()=>{
 const s=strategyState(),proposal=s.externalResearch.trendUnits[0];
 const episode={...structuredClone(proposal),status:'active',capital:200000,reviewLog:[]};s.trendUnits=[episode];
 Object.assign(proposal,{action:'exit',exitReason:'수요 둔화로 철회',members:[proposal.members[1]]});
 const before=structuredClone(s),idea=weekly.weeklyStrategySnapshot(s,Date.parse('2026-10-05T01:00:00Z')).ideas[0];
 const stock=idea.stocks.find(x=>x.symbol==='005930');
 assert.deepEqual([stock.selection,stock.selectionReason],['exited','수요 둔화로 철회']);
 assert.equal(idea.units[0].capital,200000);assert.deepEqual(idea.units[0].members,episode.members);
 assert.deepEqual(s,before);
});

for(const [status,selection,reason] of [['closing','exited','유닛 투자논리 훼손: 출하 감소'],['closed','exited','전 구성종목 청산 완료'],['reduced','selected','최종 선정']])test(`weekly selection reflects a ${status} episode rather than its original hold action`,()=>{
 const s=strategyState();s.trendUnits=[{...structuredClone(s.externalResearch.trendUnits[0]),status,closedAt:'2026-10-05',reviewLog:[{date:'2026-10-04',reason:'이전 검토'},{date:'2026-10-05',reason}]}];
 const stock=weekly.weeklyStrategySnapshot(s,Date.parse('2026-10-05T01:00:00Z')).ideas[0].stocks.find(x=>x.symbol==='005930');
 assert.deepEqual([stock.selection,stock.selectionReason],[selection,reason]);
});
