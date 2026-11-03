// Fama-French three-factor exposure from Kenneth French's published factor returns (percent per period).
// US and Japan daily factors only. Korea has no own series there (only monthly Emerging Markets), so the user
// chose on 2026-10-27 to leave Korean candidates on the four required factors.
export const FF3_SOURCE='https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/';
export const FF3_REGIONS={미국:'us',일본:'japan'};
export const FF3_FILES={us:{file:'F-F_Research_Data_Factors_daily_CSV.zip',frequency:'daily',limit:600},japan:{file:'Japan_3_Factors_Daily_CSV.zip',frequency:'daily',limit:600}};
const WINDOW=252,MIN_OBS=120,PER_YEAR=252;
const ZONES={미국:'America/New_York',일본:'Asia/Tokyo'};
export const FF3_LIMITATIONS='Kenneth French 공개 팩터(약 1~2개월 지연) 기준 과거 회귀. 일본 팩터는 달러 수익률이고 종목 수익률은 엔화라 환율 효과가 섞입니다. 한국 종목은 FF3 알파 없이 필수 4요소로 계산합니다. 알파는 과거 초과수익이며 미래 수익을 보장하지 않습니다.';

// Collected factors are evidence; a malformed region is dropped instead of failing the whole price snapshot.
export function cleanFactors(input){
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const out={};
 for(const [region,spec] of Object.entries(FF3_FILES)){
  const set=input[region];
  if(!set||set.frequency!==spec.frequency||set.source!==FF3_SOURCE+spec.file||!Array.isArray(set.rows)||!set.rows.length||set.rows.length>spec.limit)continue;
  const ok=set.rows.every((r,i)=>Array.isArray(r)&&r.length===5&&Number.isSafeInteger(r[0])&&String(r[0]).length===8&&(i===0||r[0]>set.rows[i-1][0])&&r.slice(1).every(x=>Number.isFinite(x)&&Math.abs(x)<100));
  if(ok)out[region]={frequency:set.frequency,source:set.source,asOf:set.rows.at(-1)[0],rows:set.rows.map(r=>[...r])};
 }
 return Object.keys(out).length?out:null;
}

const dayKey=(time,zone)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time*1000)).map(x=>[x.type,x.value]));return Number(p.year+p.month+p.day);};
function returns(bars,zone){
 const closes=bars.filter(b=>Number.isFinite(b?.close)&&b.close>0&&Number.isFinite(b.time)).map(b=>[dayKey(b.time,zone),b.close]);
 return new Map(closes.slice(1).map(([d,c],i)=>[d,c/closes[i][1]-1]));
}
// Solves the 4x4 normal equations by Gaussian elimination; null when the factors are collinear.
function solve(a,b){
 const n=b.length,m=a.map((row,i)=>[...row,b[i]]);
 for(let c=0;c<n;c++){
  const p=m.slice(c).reduce((best,row,i)=>Math.abs(row[c])>Math.abs(m[best][c])?c+i:best,c);
  if(Math.abs(m[p][c])<1e-12)return null;[m[c],m[p]]=[m[p],m[c]];
  for(let r=0;r<n;r++)if(r!==c){const f=m[r][c]/m[c][c];for(let k=c;k<=n;k++)m[r][k]-=f*m[c][k];}
 }
 return m.map((row,i)=>row[n]/row[i]);
}
export function ff3Exposure(bars,country,factors){
 const region=FF3_REGIONS[country],set=factors?.[region];
 if(!set||!Array.isArray(bars))return null;
 const r=returns(bars,ZONES[country]);
 const rows=set.rows.filter(f=>r.has(f[0])).slice(-WINDOW);
 if(rows.length<MIN_OBS)return null;
 const X=rows.map(f=>[1,f[1]/100,f[2]/100,f[3]/100]),y=rows.map(f=>r.get(f[0])-f[4]/100);
 const xtx=[0,1,2,3].map(i=>[0,1,2,3].map(j=>X.reduce((n,x)=>n+x[i]*x[j],0))),xty=[0,1,2,3].map(i=>X.reduce((n,x,k)=>n+x[i]*y[k],0));
 const beta=solve(xtx,xty);if(!beta)return null;
 const fitted=X.map(x=>x.reduce((n,v,i)=>n+v*beta[i],0)),resid=y.map((v,i)=>v-fitted[i]),mean=y.reduce((a,b)=>a+b,0)/y.length;
 const sse=resid.reduce((n,e)=>n+e*e,0),sst=y.reduce((n,v)=>n+(v-mean)**2,0),dof=rows.length-4;
 const inverse0=solve(xtx,[1,0,0,0]),seAlpha=inverse0?Math.sqrt(Math.max(0,sse/dof*inverse0[0])):null;
 // Rounded and without derivable fields: this rides on every quant candidate inside the 480KB review input.
 const r4=x=>Number.isFinite(x)?Math.round(x*1e4)/1e4:null;
 return {observations:rows.length,factorAsOf:set.asOf,alphaAnnual:r4(beta[0]*PER_YEAR),alphaT:seAlpha>0?r4(beta[0]/seAlpha):null,
  betas:{market:r4(beta[1]),size:r4(beta[2]),value:r4(beta[3])},r2:sst>0?r4(1-sse/sst):null};
}
// ponytail: linear map of the alpha t-statistic (t=+2.5 -> 100, 0 -> 50); t, not raw alpha, so a noisy
// regression is discounted by its own standard error. Recalibrate from unit results.
export function ff3AlphaScore(ff3,direction='long'){
 if(!Number.isFinite(ff3?.alphaT))return null;
 const t=direction==='short'?-ff3.alphaT:ff3.alphaT;
 return Math.max(0,Math.min(100,50+20*t));
}
