import test from 'node:test';
import assert from 'node:assert/strict';
import {marketReports,reportBody,reportBrief,compactReports} from '../worker/market-reports.mjs';

const html='<body><div class="doc"><h1>시황</h1><script>steal()</script><style>hide()</style><p data-lede="action">'+ '금리와 환율 확인. '.repeat(20)+'</p><table><tr><td>10Y</td><td>5.277%</td><td>+4.3</td></tr><tr><td>USD/KRW</td><td>1,342.51</td><td>-1.06%</td></tr></table><span data-macro-asset="bonds" data-direction="1">우호</span></div></body>';
const weeklyHtml='<body data-layout="prose"><div class="topbar"><a href="../">홈</a></div><div class="container"><section class="card headline-card"><h1>일본 시장 주간</h1></section><section data-section="core"><p data-interp>'+'엔은 금리차가 아니라 위험 회피로 올랐다. '.repeat(10)+'</p><table><tr><th>지표</th><th>수준</th></tr><tr><td>JGB 10년</td><td>2.837%</td><td>-12.1bp</td><td>-23.4bp</td><td>80</td><td>2026-10-23</td></tr><tr><td>엔·달러</td><td>156.83</td><td>-0.73%</td></tr></table></section></div></body>';
const daily=[{date:'2026-10-06',title:'future',headline:'future'},{date:'2026-10-01',title:'old',headline:'old'},{date:'2026-10-02',title:'시황',headline:'금리 상승'}];
const weekly=[{key:'2026-W41',title:'future',headline:'future',start_date:'2026-10-05',end_date:'2026-10-09'},{key:'2026-W39',title:'old',headline:'old',start_date:'2026-09-21',end_date:'2026-09-25'},{key:'2026-W40',title:'일본 주간',headline:'BOJ 인상 경로',start_date:'2026-09-28',end_date:'2026-10-02'}];
const siteWith=(dailyRows,weeklyRows)=>async(url,options)=>{assert.equal(options.redirect,'manual');assert.ok(String(url).startsWith('https://fdo2a.github.io/'));const japan=String(url).includes('/japan/');return String(url).endsWith('.json')?Response.json(japan?weeklyRows:dailyRows):new Response(japan?weeklyHtml:html)};
const site=siteWith(daily,weekly);
test('reports use the latest dated body, compact source values and no instructions or redirects',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push(String(url));return site(url,options)};
 try{const r=await marketReports(Date.parse('2026-10-05T10:00:00Z'));assert.equal(r.reports.length,3);assert.equal(r.reports[0].date,'2026-10-02');assert.equal(r.reports[1].url,'https://fdo2a.github.io/kr/posts/2026-10-02.html');assert.equal(r.reports[0].ageDays,3);assert.ok(!r.reports[0].content.includes('steal'));assert.deepEqual(r.reports[0].brief.ratesAndFx[1],{label:'USD/KRW',value:'1,342.51',change:'-1.06%',asOf:null});assert.equal(r.reports[0].brief.stance[0].direction,1);assert.equal(r.reports[0].brief.commentary[0].kind,'action');assert.ok(!('content' in compactReports(r).reports[0]));assert.equal(calls.length,6)}finally{globalThis.fetch=original}
 globalThis.fetch=async()=>new Response('',{status:302,headers:{location:'https://example.com'}});
 try{assert.ok((await marketReports()).reports.every(r=>r.status==='unavailable'))}finally{globalThis.fetch=original}
 assert.throws(()=>reportBody('<div>no report</div>'));
 assert.equal(reportBrief('<tr><td>국고채 3년</td><td>3.937%</td><td>-7.3</td><td>2026-10-01</td></tr>').ratesAndFx[0].asOf,'2026-10-01');
});
test('weekly Japan report uses end_date as the report date, the week key as slug, and stays fresh for 10 days',async()=>{
 const original=globalThis.fetch;globalThis.fetch=site;
 try{
  const jp=(await marketReports(Date.parse('2026-10-05T10:00:00Z'))).reports[2];
  assert.equal(jp.market,'일본');assert.equal(jp.cadence,'weekly');assert.equal(jp.date,'2026-10-02');assert.equal(jp.url,'https://fdo2a.github.io/japan/posts/2026-W40.html');assert.equal(jp.ageDays,3);assert.equal(jp.status,'available');
  assert.ok(jp.content.includes('위험 회피'));assert.ok(!jp.content.includes('홈'));
  assert.deepEqual(jp.brief.ratesAndFx[0],{label:'JGB 10년',value:'2.837%',change:'-12.1bp',asOf:'2026-10-23'});assert.equal(jp.brief.ratesAndFx[1].label,'엔·달러');
  assert.equal(jp.brief.commentary[0].kind,'interp');assert.ok(jp.brief.commentary[0].text.startsWith('엔은 금리차가'));assert.equal(jp.brief.stance.length,0);
  globalThis.fetch=siteWith([daily[2]],[weekly[2]]);
  const day10=(await marketReports(Date.parse('2026-10-12T10:00:00Z'))).reports;
  assert.deepEqual(day10.map(r=>[r.ageDays,r.status]),[[10,'stale'],[10,'stale'],[10,'available']]);
  assert.equal((await marketReports(Date.parse('2026-10-13T10:00:00Z'))).reports[2].status,'stale');
 }finally{globalThis.fetch=original}
});
