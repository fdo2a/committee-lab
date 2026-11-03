import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,coreCompanies as companies,analyze,approve,advance} from '../web/engine.mjs';
import {cleanResearch,autonomousCycle} from '../worker/account.mjs';

const url='https://www.samsung.com/global/ir/';
function input(department='fundamental') {
  return {asOf:'2026-10-04T07:00:00Z',topDown:'업종 중립',bottomUp:'기업 사업 확인',decision:'교차 검토',limitations:'시험 자료',sources:[{title:'IR',url}],
    departmentResearch:{screening:[{symbol:'005930',stance:'avoid',score:20,reason:'업종 전망 약함',sourceUrls:[url]}],
      fundamental:[{symbol:'005930',stance:department==='fundamental'?'allow':'watch',score:80,reason:'사업·공시 확인',businessPass:true,sourceUrls:[url]}],
      ...(department!=='fundamental'?{[department]:[{symbol:'005930',stance:'allow',score:75,reason:'독립 발굴 근거',sourceUrls:[url]}]}:{})}};
}
function account(department) {
  const s=createState();s.mode='live';s.plans=[];s.fx={KRW:1,USD:1400,JPY:9.5};
  for(const c of companies)s.data[c.symbol]=Array.from({length:320},(_,i)=>{const p=100000*Math.pow(.999,i);return {open:p,close:p,high:p*1.00001,low:p*.99999,volume:1000};});
  s.marketData={quotes:Object.fromEntries(companies.map(c=>[c.symbol,{price:s.data[c.symbol].at(-1).close,time:2,currency:c.currency}]))};
  s.fundamentals={'005930':{pass:true}};s.externalResearch=cleanResearch(input(department));return s;
}
for(const department of ['fundamental','technical','market'])test(`${department} nomination survives screening opposition through plan, approval and fill`,()=>{
  const s=account(department);analyze(s);
  const p=s.plans.find(p=>p.symbol==='005930'&&p.status==='대기');assert.ok(p,'independent nomination produces a plan');
  assert.ok(p.managementReview.candidateDepartments.includes(department));
  assert.ok(p.managementReview.disagreements.some(x=>x.department==='screening'));
  approve(s,p.id);assert.equal(p.riskReview.status,'approved');p.signalTimestamp=1;
  advance(s,{quotes:s.marketData.quotes,date:s.date,now:Date.UTC(2026,9,4,8)});
  assert.ok(s.trades.some(t=>t.symbol==='005930'&&t.side==='short'));
});
test('nomination stays visible but numeric validation failure blocks a plan',()=>{
  const s=account();s.fundamentals['005930'].pass=false;analyze(s);
  const r=s.analysis.reports.find(x=>x.symbol==='005930');assert.ok(r.candidateDepartments.includes('fundamental'));
  assert.equal(r.managementStatus,'보류');assert.equal(s.plans.some(p=>p.symbol==='005930'),false);
});
test('risk rejection is recorded separately and cannot be bypassed by an opinion',()=>{
  const s=account();analyze(s);const p=s.plans.find(p=>p.status==='대기');assert.ok(p);
  p.qty=1000000;assert.throws(()=>approve(s,p.id),/위험 기준/);assert.equal(p.riskReview.status,'held');assert.notEqual(p.status,'승인');
});
test('newer business validation failure cancels an approved entry before fill',()=>{
  const s=account();analyze(s);const p=s.plans.find(p=>p.status==='대기');assert.ok(p);approve(s,p.id);p.signalTimestamp=1;
  s.fundamentals['005930'].pass=false;advance(s,{quotes:s.marketData.quotes,date:s.date});
  assert.equal(p.status,'만료');assert.equal(s.trades.length,0);
});
test('withdrawn nominations cancel an approved entry even when business figures still pass',()=>{
  const s=account();analyze(s);const p=s.plans.find(p=>p.status==='대기');assert.ok(p);approve(s,p.id);p.signalTimestamp=1;
  for(const d of ['screening','fundamental','technical','market'])s.externalResearch.departmentResearch[d]=[{symbol:'005930',stance:'watch',reason:'재검토로 추천 철회',score:null,businessPass:d==='fundamental',sourceUrls:[url]}];
  advance(s,{quotes:s.marketData.quotes,date:s.date});assert.equal(p.status,'만료');assert.equal(s.trades.length,0);
});
test('original and revised opinions are preserved and revision requires a reason',()=>{
  const raw=input();raw.departmentResearch.screening[0].revisedStance='allow';
  assert.throws(()=>cleanResearch(raw),/수정/);
  raw.departmentResearch.screening[0].revisionReason='교차 검토에서 기업별 수요 확인';
  const clean=cleanResearch(raw);assert.equal(clean.departmentResearch.screening[0].stance,'avoid');assert.equal(clean.departmentResearch.screening[0].revisedStance,'allow');
});
test('unknown departments, duplicate symbols, unsupported sources and invalid scores are rejected',()=>{
  for(const mutate of [r=>r.departmentResearch.other=[],r=>r.departmentResearch.fundamental.push(r.departmentResearch.fundamental[0]),r=>r.departmentResearch.market=[{symbol:'005930',stance:'allow',reason:'자료',score:101,sourceUrls:[url]}],r=>r.departmentResearch.fundamental[0].sourceUrls=['https://unknown.example/']]){
    const raw=input();mutate(raw);assert.throws(()=>cleanResearch(raw));
  }
});
test('stale research fails business eligibility despite passing financial figures',()=>{
  const s=account(),now=Date.UTC(2026,9,4,7);const raw=input();raw.asOf='2026-09-01T00:00:00Z';
  const financial={periodEnd:'2026-03-31',periodType:'12M',currency:'KRW',fetchedAt:new Date(now).toISOString(),sources:[{title:'연간 재무',url:'https://finance.yahoo.com/quote/005930.KS/financials/'}],metrics:{revenue:1000,priorRevenue:950,netIncome:100,operatingCashFlow:120,freeCashFlow:80,equity:1000,debt:300,eps:10000}};
  const fresh=account();autonomousCycle(fresh,input(),now,{data:fresh.data,quotes:fresh.marketData.quotes,fx:fresh.fx},{'005930':financial});
  assert.equal(fresh.fundamentals['005930'].pass,true);
  autonomousCycle(s,raw,now,{data:s.data,quotes:s.marketData.quotes,fx:s.fx},{'005930':financial});
  assert.equal(s.fundamentals['005930'].pass,false);assert.equal(s.plans.some(p=>p.status==='승인'),false);
});
test('legacy claimed financial approval cannot replace failed business review',()=>{
  const s=account(),now=Date.UTC(2026,9,4,7),raw=input();delete raw.departmentResearch;
  raw.screening=[{symbol:'005930',stance:'allow',topDownScore:80,reason:'산업 긍정',bottomUpPass:false,fundamentalPass:true,fundamentalReview:'사용자 입력 통과 주장',sourceUrls:[url]}];
  const financial={periodEnd:'2026-03-31',periodType:'12M',currency:'KRW',fetchedAt:new Date(now).toISOString(),sources:[{title:'연간 재무',url:'https://finance.yahoo.com/quote/005930.KS/financials/'}],metrics:{revenue:1000,priorRevenue:950,netIncome:100,operatingCashFlow:120,freeCashFlow:80,equity:1000,debt:300,eps:10000}};
  autonomousCycle(s,raw,now,{data:s.data,quotes:s.marketData.quotes,fx:s.fx},{'005930':financial});
  assert.equal(s.fundamentals['005930'].businessPass,false);assert.equal(s.fundamentals['005930'].pass,false);
});

test('investment committee lists only stocks with research, a basket, an open plan or a holding', async () => {
  const {reviewSymbols} = await import('../web/committee-view.mjs');
  const {eligibleIdeaAccount,ideaState} = await import('./idea-fixtures.mjs');
  assert.deepEqual(reviewSymbols(eligibleIdeaAccount()), ['005930','000660']);
  const empty = ideaState();
  assert.deepEqual(reviewSymbols(empty), []);
  empty.holdings = [{symbol:'035420',qty:3},{symbol:'068270',qty:0}];
  empty.plans = [{symbol:'005380',status:'대기'},{symbol:'051910',status:'거절'}];
  assert.deepEqual(new Set(reviewSymbols(empty)), new Set(['035420','005380']));
});

test('entry gap names the first unmet condition in plain words and is null for an eligible stock', async () => {
  const {entryGap} = await import('../web/committee-view.mjs');
  const {ideaEntryCheck,entryEligible} = await import('../web/committee.mjs');
  const {eligibleIdeaAccount,testNow} = await import('./idea-fixtures.mjs');
  const s = eligibleIdeaAccount();
  assert.equal(entryEligible(s,'005930','kr-ai',testNow), true);
  assert.equal(entryGap(s,'005930',testNow), null);
  assert.equal(ideaEntryCheck(s,'005930','kr-ai',testNow).gap, null);
  s.externalResearch.departmentResearch.fundamental.find(r=>r.symbol==='005930').businessPass = false;
  assert.equal(entryEligible(s,'005930','kr-ai',testNow), false);
  assert.equal(entryGap(s,'005930',testNow), '펀더멘탈부 사업 검증 미통과');
  assert.equal(entryGap(s,'000660',testNow), '같은 바스켓 종목의 기업·기술 검토 미완료');
  const t = eligibleIdeaAccount(); t.externalResearch.trendUnits = [];
  assert.equal(entryGap(t,'005930',testNow), '운용부 최종 바스켓에 포함되지 않음');
  assert.equal(entryGap(t,'005930',testNow + 25*3600000), '운용부 최종 바스켓에 포함되지 않음');
  assert.equal(entryGap(t,'005930',testNow + 31*86400000), '재무 수집 후 30일이 지남');
  delete t.fundamentals['005930'];
  assert.equal(entryGap(t,'005930',testNow), '재무 숫자 미수집');
});

test('committee proposal first line gives the plan reason and strategy',async()=>{
 const {committeeReviewPanel}=await import('../web/committee-view.mjs');
 const s=account();analyze(s);
 const r=s.analysis.reports.find(x=>x.symbol==='005930'),plan=s.plans.find(p=>p.symbol==='005930');
 assert.equal(r.managementStatus,'편입안');
 const html=committeeReviewPanel(s,'005930',{esc:String,badge:String}),line=html.match(/<p class="verdict-line">([^<]*)<\/p>/)?.[1];
 assert.match(line,/편입안 이유/);assert.ok(line.includes(plan.reason));assert.ok(line.includes(plan.strategy));
});

test('committee holding first line explains why another entry is held',async()=>{
 const {committeeReviewPanel}=await import('../web/committee-view.mjs');
 const s=account();s.holdings=[{symbol:'005930',qty:3}];analyze(s);
 assert.equal(s.analysis.reports.find(x=>x.symbol==='005930').managementStatus,'보유');
 const html=committeeReviewPanel(s,'005930',{esc:String,badge:String}),line=html.match(/<p class="verdict-line">([^<]*)<\/p>/)?.[1];
 assert.match(line,/보유 이유/);assert.match(line,/이미 보유/);assert.match(line,/중복 진입 보류/);
});
