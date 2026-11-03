import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanFactors,ff3Exposure,ff3AlphaScore,FF3_SOURCE} from '../web/fama-french.mjs';
import {styleScore} from '../web/trend-units.mjs';

// Weekday rows with known loadings: excess return = 0.0004 + 1.2*MKT + 0.5*SMB - 0.3*HML (+ tiny noise).
function synthetic(days=300){
 const rows=[],bars=[];let close=100,seed=7;const rand=()=>((seed=seed*16807%2147483647)/2147483647-.5);
 for(let d=Date.UTC(2025,0,2);rows.length<days;d+=86400000){
  const day=new Date(d);if([0,6].includes(day.getUTCDay()))continue;
  const key=Number(day.toISOString().slice(0,10).replaceAll('-','')),mkt=rand()*2,smb=rand(),hml=rand(),rf=.01;
  close*=1+rf/100+.0004+1.2*mkt/100+.5*smb/100-.3*hml/100+rand()*1e-5;
  rows.push([key,+mkt.toFixed(6),+smb.toFixed(6),+hml.toFixed(6),rf]);bars.push({time:(d+15*3600000)/1000,close});
 }
 return {rows,bars};
}
const us=rows=>({us:{frequency:'daily',source:FF3_SOURCE+'F-F_Research_Data_Factors_daily_CSV.zip',rows}});

test('three-factor regression recovers known market, size and value loadings and a positive alpha',()=>{
 const {rows,bars}=synthetic();
 const e=ff3Exposure(bars,'미국',cleanFactors(us(rows)));
 assert.equal(e.observations,252);assert.equal(e.factorAsOf,rows.at(-1)[0]);
 assert.ok(Math.abs(e.betas.market-1.2)<.01&&Math.abs(e.betas.size-.5)<.01&&Math.abs(e.betas.value+.3)<.01,JSON.stringify(e.betas));
 assert.ok(Math.abs(e.alphaAnnual-.0004*252)<.01);assert.ok(e.alphaT>2.5&&e.r2>.99);
 assert.equal(ff3AlphaScore(e),100);assert.equal(ff3AlphaScore(e,'short'),0);
});
test('alpha joins the style score only when available; missing factors or a short history never invent one',()=>{
 const {rows,bars}=synthetic(100);
 assert.equal(ff3Exposure(bars,'미국',cleanFactors(us(rows))),null,'below 120 daily observations');
 assert.equal(ff3Exposure(bars,'일본',cleanFactors(us(rows))),null,'no Japan factors');
 const full=synthetic();assert.equal(ff3Exposure(full.bars,'한국',{...cleanFactors(us(full.rows)),emerging:cleanFactors(us(full.rows)).us}),null,'Korean candidates get no alpha');
 const base={pe:10,roe:.1,revenueGrowth:.2};
 assert.equal(styleScore(base,80).values.ff3Alpha,null);
 assert.equal(styleScore(base,80).score,styleScore(base,80,null).score);
 assert.equal(styleScore(base,80,100).score,(80+50+90+80+100)/5);
});
test('only Kenneth French sources with the expected frequency and ascending rows are kept, per region',()=>{
 const {rows}=synthetic(130),valid=us(rows).us;
 const emerging={frequency:'monthly',source:FF3_SOURCE+'Emerging_5_Factors_CSV.zip',rows:[[202608,4.37,4.58,-3.27,.29],[202609,-1.48,.89,1.1,.31]]};
 const cleaned=cleanFactors({us:valid,emerging,japan:{...valid,source:'https://example.com/Japan_3_Factors_Daily_CSV.zip'}});
 // Korea is out of scope (user decision 2026-10-27): an Emerging Markets series is never kept.
 assert.deepEqual(Object.keys(cleaned),['us']);assert.equal(cleaned.us.asOf,rows.at(-1)[0]);
 for(const bad of [{...valid,frequency:'monthly'},{...valid,rows:[...rows].reverse()},{...valid,rows:rows.map((r,i)=>i?r:[r[0],NaN,0,0,0])},{...valid,rows:Array.from({length:601},(_,i)=>[20200101+i,0,0,0,0])}])
  assert.equal(cleanFactors({us:bad}),null);
 assert.equal(cleanFactors(null),null);
});
test('the runtime review input summarizes factor series instead of copying them',async()=>{
 const {runtimeReviewInput}=await import('../scripts/logic-review.mjs');
 const {rows}=synthetic(130);
 const input=await runtimeReviewInput('/api/run',{marketSnapshot:{data:{},quotes:{},factors:us(rows)},expectedRevision:1},{revision:1});
 assert.deepEqual(input.candidate.marketSnapshot.factors.us,{frequency:'daily',source:FF3_SOURCE+'F-F_Research_Data_Factors_daily_CSV.zip',rows:130,first:rows[0][0],last:rows.at(-1)[0]});
});
