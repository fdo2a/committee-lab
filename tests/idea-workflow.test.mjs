import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanResearch,researchCheck,prepareResearch} from '../worker/account.mjs';
import {ideaResearch,ideaState,testNow} from './idea-fixtures.mjs';

test('sourced concept and two candidate reviews complete research without every stock review',()=>{
 const raw=ideaResearch(),clean=cleanResearch(raw);
 assert.equal(clean.investmentIdeas?.[0].id,'kr-ai');
 const r=researchCheck(ideaState(),raw,testNow);assert.equal(r.complete,true,JSON.stringify(r.missing));assert.equal(r.stages.ideas,'complete');assert.equal(r.stages.management,'complete');
});
test('concept links, active candidates, source dates and technical review cannot be bypassed',()=>{
 for(const mutate of [r=>r.trendUnits[0].ideaId='missing',r=>delete r.investmentIdeas,r=>r.departmentResearch.technical.pop(),r=>r.investmentIdeas[0].asOf='2026-09-01',r=>r.investmentIdeas[0].action='withdraw',r=>r.investmentIdeas[0].candidates.pop(),r=>r.investmentIdeas[0].referenceIndex.asOf='2025-01-01',r=>r.macroScorecard.pop()]){
  const raw=ideaResearch();mutate(raw);const r=researchCheck(ideaState(),raw,testNow);assert.equal(r.complete,false);
 }
 const s=ideaState();s.activeSymbols=s.activeSymbols.filter(x=>x!=='000660');assert.equal(researchCheck(s,ideaResearch(),testNow).complete,false);
});
test('review identity is idea and symbol, preserving original and revised opinions',()=>{
 const raw=ideaResearch();raw.departmentResearch.fundamental.push({...raw.departmentResearch.fundamental[0],ideaId:'other-idea',businessPass:false,stance:'avoid',revisedStance:'watch',revisionReason:'추가 검토'});
 const clean=cleanResearch(raw);assert.equal(clean.departmentResearch.fundamental.length,3);assert.equal(clean.departmentResearch.fundamental[2].stance,'avoid');assert.equal(clean.departmentResearch.fundamental[2].revisedStance,'watch');
 raw.departmentResearch.fundamental.push(raw.departmentResearch.fundamental[0]);assert.throws(()=>cleanResearch(raw));
});
test('reviewed candidates outside the final basket remain on watch without forced rejection',()=>{
 const raw=ideaResearch();const c={symbol:'035420',reason:'비교 후보'};raw.investmentIdeas[0].candidates.push(c);raw.investmentIdeas[0].referenceIndex.constituents.push(c.symbol);
 for(const d of ['fundamental','technical'])raw.departmentResearch[d].push({...raw.departmentResearch[d][0],symbol:c.symbol});
 assert.equal(researchCheck(ideaState(),raw,testNow).complete,true);
 raw.trendUnits[0].excluded=[{symbol:c.symbol,reason:'현금 회수 불확실성으로 제외'}];assert.equal(researchCheck(ideaState(),raw,testNow).complete,true);
});
test('unsourced empty observation is incomplete and genuine no-idea watch has no approval',()=>{
 const raw=ideaResearch();raw.investmentIdeas=[];raw.trendUnits=[];raw.departmentResearch={};raw.departmentResearch={};
 const r=researchCheck(ideaState(),raw,testNow);assert.equal(r.complete,true);assert.equal(r.stages.ideas,'watch');
 raw.sources=[];assert.equal(researchCheck(ideaState(),raw,testNow).complete,false);
});

import {analyze,approve,advance} from '../web/engine.mjs';
import {eligibleIdeaAccount} from './idea-fixtures.mjs';
test('management selects only the final concept basket and records idea through approval and fill',()=>{
 const s=eligibleIdeaAccount();analyze(s,testNow);
 const p=s.plans.find(p=>p.symbol==='005930'&&p.status==='대기');assert.ok(p);
 assert.equal(p.ideaId,'kr-ai');assert.equal(p.unitId,'test-unit');assert.deepEqual(p.managementReview.candidateDepartments,['screening','market']);
 approve(s,p.id,testNow);assert.equal(p.riskReview.status,'approved');p.signalTimestamp=testNow/1000-1;
 advance(s,{quotes:s.marketData.quotes,date:s.date,now:testNow});
 assert.equal(s.holdings[0].ideaId,'kr-ai');assert.equal(s.trades[0].ideaId,'kr-ai');assert.equal(s.trendUnits[0].ideaId,'kr-ai');
});
test('another idea business approval cannot replace the selected idea review',()=>{
 const s=eligibleIdeaAccount();const rows=s.externalResearch.departmentResearch.fundamental;
 rows.unshift({...rows[0],ideaId:'unrelated',businessPass:true});rows.find(r=>r.ideaId==='kr-ai'&&r.symbol==='005930').businessPass=false;
 analyze(s,testNow);assert.equal(s.plans.some(p=>p.symbol==='005930'),false);
});
test('technical opposition supports a recorded management judgment but never invents a candidate',()=>{
 const s=eligibleIdeaAccount();s.externalResearch.departmentResearch.technical[0].stance='avoid';
 s.externalResearch.departmentResearch.technical.push({...s.externalResearch.departmentResearch.technical[0],symbol:'AAPL',stance:'allow'});
 s.fundamentals.AAPL={pass:true,numericPass:true};analyze(s,testNow);
 const p=s.plans.find(p=>p.symbol==='005930');assert.ok(p);assert.ok(p.managementReview.disagreements.some(x=>x.department==='technical'));
 assert.equal(s.plans.some(p=>p.symbol==='AAPL'),false);
});
test('withdrawal, stale concept, missing review and numeric failure cancel approved entry before new quote',()=>{
 for(const mutate of [s=>s.externalResearch.investmentIdeas[0].action='withdraw',s=>s.externalResearch.investmentIdeas[0].asOf='2026-09-01',s=>s.externalResearch.departmentResearch.technical=[],s=>s.fundamentals['005930'].numericPass=false,s=>s.externalResearch.trendUnits[0].members=s.externalResearch.trendUnits[0].members.filter(m=>m.symbol!=='005930'),s=>s.externalResearch.trendUnits[0].ideaId='other',s=>delete s.plans.find(p=>p.symbol==='005930').ideaId]){
  const s=eligibleIdeaAccount();analyze(s,testNow);const p=s.plans.find(p=>p.symbol==='005930'&&p.status==='대기');assert.ok(p);approve(s,p.id,testNow);p.signalTimestamp=testNow/1000-1;mutate(s);
  advance(s,{quotes:s.marketData.quotes,date:s.date,now:testNow});assert.equal(p.status,'만료');assert.equal(s.trades.some(t=>t.symbol==='005930'&&t.side==='short'),false);
 }
});
test('legacy approved entry expires under v5 while existing stop loss continues',()=>{
 const s=eligibleIdeaAccount();s.externalResearch=null;s.plans=[{id:'old',symbol:'000660',side:'short',qty:1,reference:100000,stop:120000,target:80000,date:s.date,strategy:'old',status:'승인',signalTimestamp:1}];
 s.holdings=[{symbol:'005930',direction:'long',qty:1,entry:100000,cost:100000,stop:95000,target:120000,date:s.date,strategy:'old',lastCheckedQuoteTime:1}];
 advance(s,{quotes:s.marketData.quotes,date:s.date,now:testNow});assert.equal(s.plans[0].status,'만료');assert.equal(s.holdings.length,0);assert.ok(s.trades.some(t=>t.side==='sell'));
});

test('management can keep a fully reviewed idea on watch without inventing a basket',()=>{
 const raw=ideaResearch();raw.trendUnits=[];raw.investmentIdeas[0].managementReview={status:'watch',reason:'기업·기술 검토 후 수익 대비 위험이 커서 관찰',sourceUrls:raw.investmentIdeas[0].sourceUrls};
 const clean=cleanResearch(raw);assert.equal(clean.investmentIdeas[0].managementReview.reason,raw.investmentIdeas[0].managementReview.reason);
 assert.equal(researchCheck(ideaState(),clean,testNow).complete,true);
 raw.investmentIdeas[0].managementReview.reason=' ';assert.equal(researchCheck(ideaState(),raw,testNow).complete,false);
});
test('legacy nominations are pending migration rather than a no-idea watch decision',()=>{
 const raw=ideaResearch();raw.investmentIdeas=[];raw.trendUnits=[];raw.departmentResearch={};raw.screening=[{symbol:'005930',stance:'allow',topDownScore:80,reason:'이전 발굴',sourceUrls:raw.sources.map(s=>s.url)}];
 assert.equal(researchCheck(ideaState(),raw,testNow).complete,false);
});

import {investmentProcessPanel,processEvidencePanel} from '../web/trend-view.mjs';
import {committeeReviewPanel} from '../web/committee-view.mjs';
import {context} from '../worker/account.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const badge=value=>'<span>'+esc(value)+'</span>';
test('quant views show alpha scores and FF3 risk references without inventing missing values',()=>{
 const s=eligibleIdeaAccount();analyze(s,testNow);
 const q=s.analysis.quantResearch[0].candidates.find(c=>c.symbol==='005930');
 q.ff3={betas:{market:1.2,size:.5,value:-.3},r2:.8765,alphaT:2};q.style.values.ff3Alpha=90;
 s.analysis.reports.find(r=>r.symbol==='005930').quant=q;
 for(const html of [investmentProcessPanel(s,{esc,badge}),processEvidencePanel(s,'005930',{esc})]){
  for(const text of ['FF3','시장 베타 1.20','규모(SMB) 베타 0.50','가치(HML) 베타 -0.30','R² 87.6%','알파 t값 2.00'])assert.ok(html.includes(text),text);
 }
 q.ff3=null;q.style.values.ff3Alpha=null;
 const missing=processEvidencePanel(s,'005930',{esc});
 assert.ok(missing.includes('FF3 베타·R²·알파 t값 미확인'));assert.ok(!missing.includes('NaN'));assert.ok(!missing.includes('알파 0'));
});
test('workflow views distinguish discovered concepts, final selection and pending legacy research',()=>{
 const s=eligibleIdeaAccount();s.externalResearch.investmentIdeas[0].name='<script>attack</script>';s.externalResearch.investmentIdeas[0].invalidation='<script>attack</script>';s.externalResearch.trendUnits[0].excluded=[{symbol:'AAPL',reason:'<script>attack</script>'}];analyze(s,testNow);
 const html=investmentProcessPanel(s,{esc,badge})+committeeReviewPanel(s,'005930',{esc,badge});
 for(const label of ['바스켓 컨셉','최종 바스켓','산업·테마분석부','기업 검토','기술 검토','제외'])assert.ok(html.includes(label),label);
 assert.ok(!html.includes('<script>attack</script>'));assert.ok(html.includes('&lt;script&gt;'));
 const old=structuredClone(s);old.externalResearch.investmentIdeas=[];delete old.externalResearch.trendUnits[0].ideaId;
 assert.match(investmentProcessPanel(old,{esc,badge}),/원본 아이디어 미연결.*재검토/);
});
test('context advertises version five and candidate scoped corporate and technical reviews',()=>{
 const s=eligibleIdeaAccount(),c=context({state:s,revision:1,metadata:{enabled:false}});
 assert.equal(c.pipelineVersion,5);assert.equal(c.investmentProcess.version,5);assert.equal(c.researchWorkflow.version,5);
 assert.match(c.researchWorkflow.sequence.join(' '),/기업 분석/);assert.match(c.researchWorkflow.input,/ideaId/);assert.match(c.investmentProcess.ideaFields,/investmentIdeas/);
});
import {departmentReviews} from '../worker/department-reviews.mjs';
test('department reports count discovered ideas and scoped verification without inventing independent candidates',()=>{
 const s=eligibleIdeaAccount();analyze(s,testNow);s.policy={riskScale:1};s.analysis.researchReadiness=researchCheck(s,s.externalResearch,testNow);
 const reports=departmentReviews(s,{approved:0,newExecutions:0},testNow);
 assert.equal(reports.length,7);assert.equal(reports[0].name,'산업·테마분석부');assert.match(reports[0].result,/컨셉 1개/);assert.match(reports[1].result,/후보 검토 2건/);assert.match(reports[2].result,/후보 검토 2건/);assert.match(reports[5].result,/최종 바스켓 1개/);
 assert.ok(!JSON.stringify(reports).includes('독립 후보'));
});
test('entry review rejects missing idea, candidate, macro and final-selection evidence in manual approval and fill',()=>{
 const base=eligibleIdeaAccount();analyze(base,testNow);
 const mutations=[s=>s.externalResearch.investmentIdeas[0].thesis='',s=>s.externalResearch.investmentIdeas[0].whatToWatch='',s=>s.externalResearch.investmentIdeas[0].invalidation='',s=>s.externalResearch.investmentIdeas[0].candidates[0].reason='',s=>s.externalResearch.macroScorecard[0].reason='',s=>s.externalResearch.trendUnits[0].members[0].reason='',s=>s.externalResearch.trendUnits[0].referenceIndex.name='',s=>s.externalResearch.decision=''];
 const outcomes=mutations.map(mutate=>{
  const s=structuredClone(base),p=s.plans.find(p=>p.symbol==='005930'&&p.status==='대기');mutate(s);
  let approved=false;try{approve(s,p.id,testNow);approved=true;}catch{}
  // An earlier approval must also be invalidated after the evidence disappears.
  p.status='승인';p.signalTimestamp=testNow/1000-1;advance(s,{quotes:s.marketData.quotes,date:s.date,now:testNow});
  return {approved,filled:s.trades.some(t=>t.symbol==='005930'&&t.side==='short')};
 });assert.deepEqual(outcomes,mutations.map(()=>({approved:false,filled:false})));
});
import {enableRegularExecution} from '../web/execution.mjs';
test('cached financial approval expires after 30 days or a missing timestamp before regular-open execution',()=>{
 const outcomes=[];
 for(const missing of [false,true]){
  const s=eligibleIdeaAccount();s.fundamentals['005930'].fetchedAt=new Date(testNow).toISOString();enableRegularExecution(s,testNow-3600000,'open');analyze(s,testNow);
  const p=s.plans.find(p=>p.symbol==='005930'&&p.status==='대기');approve(s,p.id,testNow);
  const later=testNow+31*86400000;if(missing)delete s.fundamentals['005930'].fetchedAt;
  const checkAt=missing?testNow:later;let approved=false;p.status='대기';try{approve(s,p.id,checkAt);approved=true;}catch{}p.status='승인';
  const open=(later-3600000)/1000,quotes=structuredClone(s.marketData.quotes),date=new Date(later+9*3600000).toISOString().slice(0,10);
  for(const q of Object.values(quotes)){q.time=later/1000;q.regularSessions=[{date,openTime:open,closeTime:open+23400,open:q.price,close:null,complete:false}];}
  advance(s,{quotes,date,now:later});outcomes.push({approved,filled:s.trades.some(t=>t.symbol==='005930'&&t.side==='short')});
 }assert.deepEqual(outcomes,[{approved:false,filled:false},{approved:false,filled:false}]);
});
test('concept and final reference constituents may include registered stocks of another country',()=>{
 for(const key of ['investmentIdeas','trendUnits']){
  const raw=ideaResearch(),s=ideaState();s.activeSymbols=s.activeSymbols.filter(x=>x!=='AAPL');raw[key][0].referenceIndex.constituents.push('AAPL');
  const r=researchCheck(s,raw,testNow);assert.equal(r.complete,true,JSON.stringify(r.missing));assert.equal(r.missing.some(m=>m.kind==='referenceIndex'&&m.field==='constituents'),false);
 }
});
// 2026-10-29 user instruction: one idea may mix countries; each member country then needs its own five macro factors.
function mixedCountryResearch(){
 const raw=ideaResearch(),idea=raw.investmentIdeas[0],unit=raw.trendUnits[0],url=raw.sources[0].url;
 idea.region='한국·미국';unit.region='한국·미국';idea.candidates.push({symbol:'AAPL',reason:'미국 수요 측 후보'});idea.referenceIndex.constituents.push('AAPL');
 unit.members=[{symbol:'005930',weight:.5,reason:'최종 선정'},{symbol:'AAPL',weight:.5,reason:'최종 선정'}];
 for(const d of ['fundamental','technical'])raw.departmentResearch[d].push({ideaId:idea.id,symbol:'AAPL',stance:'allow',score:80,reason:d==='fundamental'?'사업 연결 확인':'진입 시점 지원',businessPass:d==='fundamental',sourceUrls:[url]});
 raw.macroScorecard.push(...raw.macroScorecard.map(r=>({...r,region:'미국'})));
 return raw;
}
test('a basket mixing Korean and US stocks is complete when both countries have macro evidence',()=>{
 const s=ideaState(),r=researchCheck(s,mixedCountryResearch(),testNow);
 assert.equal(r.complete,true,JSON.stringify(r.missing));assert.deepEqual(r.readyUnitIds,['test-unit']);assert.deepEqual(r.regions.map(x=>x.region),['미국','한국']);
 const missingUs=mixedCountryResearch();missingUs.macroScorecard=missingUs.macroScorecard.filter(m=>m.region!=='미국');
 const gap=researchCheck(s,missingUs,testNow);assert.equal(gap.complete,false);assert.deepEqual(gap.readyUnitIds,[]);assert.ok(gap.missing.some(m=>m.kind==='macro'&&m.region==='미국'));
});
test('invalid v5 input reports the current scoped contract without retired all-stock instructions',()=>{
 const raw=ideaResearch();raw.trendUnits[0].members[0].weight=.9;
 const r=researchCheck(ideaState(),raw,testNow);assert.equal(r.complete,false);assert.ok(r.missing.every(m=>m.kind==='validation'));assert.equal(r.stages.ideas,'pending');assert.match(r.missing[0].reason,/컨셉.*기업.*기술/);
});


import {autonomousCycle} from '../worker/account.mjs';
test('incomplete independent idea cannot freeze a reviewed basket at preparation or approval',()=>{
 const s=eligibleIdeaAccount(),raw=ideaResearch(),other=structuredClone(raw.investmentIdeas[0]);other.id='pending';other.candidates=['035420','005380'].map(symbol=>({symbol,reason:'조사 중'}));other.referenceIndex.constituents=['035420','005380'];raw.investmentIdeas.push(other);
 const unit=structuredClone(raw.trendUnits[0]);unit.id='pending-unit';unit.ideaId='pending';unit.members=other.candidates.map(c=>({...c,weight:.5}));unit.referenceIndex=other.referenceIndex;raw.trendUnits.push(unit);
 const ready=researchCheck(s,raw,testNow);assert.equal(ready.complete,false);assert.deepEqual(ready.readyUnitIds,['test-unit']);assert.ok(ready.missing.some(m=>m.ideaId==='pending'));
 const finance=Object.fromEntries(['005930','000660'].map(symbol=>[symbol,{periodEnd:'2026-03-31',periodType:'12M',currency:'KRW',fetchedAt:new Date(testNow).toISOString(),sources:[{url:'https://finance.yahoo.com/quote/005930.KS/financials/'}],metrics:{revenue:1200,priorRevenue:1000,netIncome:100,equity:1000,eps:10000,debt:100,operatingCashFlow:120}}]));
 const summary=autonomousCycle(s,raw,testNow,{...s.marketData,data:s.data,fx:s.fx},finance,{phase:'pre',countries:['한국']});assert.equal(summary.status,'researchIncomplete');assert.ok(summary.approved>0);assert.ok(s.plans.some(p=>p.unitId==='test-unit'&&p.status==='승인'));assert.equal(s.plans.some(p=>p.unitId==='pending-unit'&&p.status==='승인'),false);
 raw.investmentIdeas[0].asOf='2026-09-01';assert.deepEqual(researchCheck(s,raw,testNow).readyUnitIds,[]);
});


import {market,research,researchForUnit} from '../web/engine.mjs';
import {companies} from '../web/universe.mjs';
test('broad discovery persists 60 candidates and does not freeze a verified basket',()=>{
 const s=eligibleIdeaAccount(),raw=ideaResearch(),idea=raw.investmentIdeas[0];
 const extra=companies.filter(c=>c.country==='한국'&&!idea.candidates.some(x=>x.symbol===c.symbol)).slice(0,58);
 idea.candidates.push(...extra.map(c=>({symbol:c.symbol,reason:'공급망·간접 수혜 가능성, 원문 분석 대기'})));
 idea.referenceIndex.constituents=[...idea.candidates.map(c=>c.symbol)];raw.trendUnits[0].referenceIndex=idea.referenceIndex;
 const readiness=prepareResearch({state:s,metadata:{}},raw,testNow);assert.equal(readiness.complete,false);assert.deepEqual(readiness.readyUnitIds,['test-unit']);assert.equal(s.externalResearch.investmentIdeas[0].candidates.length,60);
 assert.equal(readiness.coverage[0].candidateCount,60);assert.equal(readiness.coverage[0].reviewedCount,2);assert.equal(readiness.coverage[0].pendingSymbols.length,58);
 analyze(s,testNow);const p=s.plans.find(p=>p.symbol==='005930'&&p.status==='대기');assert.ok(p);approve(s,p.id,testNow);assert.equal(p.status,'승인');
 const q=s.analysis.quantResearch[0];assert.equal(q.candidateCount,60);assert.equal(q.rankedCount,2);assert.equal(q.candidates.filter(c=>c.rank===null).length,58);
 s.analysis.researchReadiness=readiness;const html=investmentProcessPanel(s,{esc,badge});assert.match(html,/조사 후보 60개/);assert.match(html,/기업·기술 검토 2개/);assert.match(html,/분석 대기 58개/);
 s.externalResearch.departmentResearch.technical.pop();assert.deepEqual(researchCheck(s,s.externalResearch,testNow).readyUnitIds,[]);assert.throws(()=>approve(s,p.id,testNow));
});

test('discovery accepts 100 registered candidates but rejects 101 or unknown symbols',()=>{
 const raw=ideaResearch(),idea=raw.investmentIdeas[0],extra=companies.filter(c=>c.country==='한국'&&!idea.candidates.some(x=>x.symbol===c.symbol)).slice(0,98);
 idea.candidates.push(...extra.map(c=>({symbol:c.symbol,reason:'연관 사업 비교'})));idea.referenceIndex.constituents=companies.filter(c=>c.country==='한국').map(c=>c.symbol);
 assert.equal(cleanResearch(raw).investmentIdeas[0].candidates.length,100);
 const remaining=idea.referenceIndex.constituents.find(symbol=>!idea.candidates.some(c=>c.symbol===symbol));idea.candidates.push({symbol:remaining,reason:'추가'});assert.throws(()=>cleanResearch(raw));
 idea.candidates.pop();idea.candidates[99].symbol='UNKNOWN';assert.throws(()=>cleanResearch(raw));
});
test('a sideways market admits a researched basket with a backtested individual uptrend',()=>{
 const s=eligibleIdeaAccount();s.externalResearch.trendUnits[0].direction='long';s.externalResearch.trendUnits[0].regime='sideways';
 for(const symbol of s.activeSymbols){s.data[symbol]=Array.from({length:400},(_,i)=>{const price=['005380','051910','035720','068270','105560'].includes(symbol)?100000:100000*Math.pow(1.003,i);return {open:price,close:price,high:price*1.00001,low:price*.99999,volume:1000000};});s.marketData.quotes[symbol].price=s.data[symbol].at(-1).close;}
 assert.equal(market(s,'한국').regime,'횡보');assert.ok(research(s).some(x=>x.pass&&x.regime==='상승'));analyze(s,testNow);
 const p=s.plans.find(p=>p.symbol==='005930'&&p.status==='대기');assert.ok(p,'Individual uptrend should remain eligible in a sideways market');assert.equal(p.side,'buy');approve(s,p.id,testNow);assert.equal(p.status,'승인');
});

test('a validated theme can enter when unrelated flat watchlist stocks fail the global trade-count gate',()=>{
 const s=eligibleIdeaAccount();s.externalResearch.trendUnits[0].direction='long';s.externalResearch.trendUnits[0].regime='sideways';
 s.data=Object.fromEntries(s.activeSymbols.map(symbol=>[symbol,Array.from({length:400},(_,i)=>{const price=['005930','000660'].includes(symbol)?10000*Math.pow(1.003,i):10000;return {open:price,close:price,high:price*1.00001,low:price*.99999,volume:1000000};})]));
 for(const symbol of s.activeSymbols)s.marketData.quotes[symbol].price=s.data[symbol].at(-1).close;
 assert.equal(market(s,'한국').regime,'횡보');assert.equal(research(s).some(st=>st.pass),false);
 analyze(s,testNow);const p=s.plans.find(p=>p.symbol==='005930'&&p.status==='대기');assert.ok(p,'The reviewed basket should have its own validation scope');
 assert.deepEqual(p.managementReview.strategyValidation.symbols,['000660','005930']);assert.ok(p.managementReview.strategyValidation.trainTrades>=3);assert.ok(p.managementReview.strategyValidation.trades>=2);
 approve(s,p.id,testNow);assert.equal(p.status,'승인');assert.equal(research(s).some(st=>st.pass),false,'Scoped cache must not replace global results');
 for(const plan of s.plans.filter(x=>x.status==='대기'))approve(s,plan.id,testNow);
 for(const plan of s.plans.filter(x=>x.status==='승인'))plan.signalTimestamp=testNow/1000;
 const quotes=Object.fromEntries(Object.entries(s.marketData.quotes).map(([symbol,q])=>[symbol,{...q,time:testNow/1000+60}]));
 advance(s,{quotes,date:s.date,now:testNow+60000});assert.equal(s.trades.filter(t=>t.side==='buy').length,2);assert.equal(s.holdings.length,2);
});

test('basket validation still rejects profitable data with only two completed training trades',()=>{
 const s=eligibleIdeaAccount();s.externalResearch.trendUnits[0].direction='long';s.externalResearch.trendUnits[0].regime='bull';
 s.data=Object.fromEntries(s.activeSymbols.map(symbol=>[symbol,Array.from({length:260},(_,i)=>{const price=10000*Math.pow(1.003,Math.max(0,i-190));return {open:price,close:price,high:price*1.00001,low:price*.99999,volume:1000000};})]));
 const st=researchForUnit(s,'test-unit').find(x=>x.id==='S1');assert.equal(st.trainTrades,2);assert.ok(st.trainRet>0);assert.ok(st.ret>0);assert.ok(st.trades>=2);assert.equal(st.pass,false);
 assert.deepEqual(researchForUnit(s,'missing-unit'),[]);
});
