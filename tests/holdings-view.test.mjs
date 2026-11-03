import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {companies,equity,exposure,markPrice,fxOf,unrealized} from '../web/engine.mjs';
import {ETF_ASSETS,assetPositions,assetReceivables} from '../web/asset-allocation.mjs';

test('dashboard shows only owned stocks and ETFs with cost basis and direction-aware profit',()=>{
 const source=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
 const functions=['assetPanel','holdingsPanel'].map(name=>source.slice(source.indexOf(`function ${name}(`),source.indexOf('\nfunction ',source.indexOf(`function ${name}(`)+1))).join('\n');
 const state={cash:100000,holdings:[{symbol:'005930',qty:2,cost:180000,direction:'long'},{symbol:'AAPL',qty:2,cost:280000,direction:'short',borrowAccrued:1000}],data:{'005930':[{close:100000}],AAPL:[{close:110}]},fx:{USD:1400},assetAllocation:{positions:{SGOV:{symbol:'SGOV',qty:3,cost:420000,quote:{price:101},fx:{rate:1500},trades:[],distributions:[]},'153130':{symbol:'153130',qty:0,cost:0,quote:{price:100000},fx:{rate:1},trades:[],distributions:[]}}}};
 const num=n=>Math.round(n).toLocaleString('ko-KR'),won=n=>num(n)+'원';
 const context={state,ETF_ASSETS,assetPositions,assetReceivables,equity,exposure,markPrice,fxOf,unrealized,num,won,pct:n=>(n>0?'+':'')+(n*100).toFixed(2)+'%',cOf:s=>companies.find(c=>c.symbol===s)??ETF_ASSETS.find(c=>c.symbol===s),esc:String,good:n=>n>=0?'positive':'negative',badge:String,panelTitle:(title,extra='')=>title+extra,icon:()=>'',sizeBadge:()=>'',seoulTime:()=>'',executionPriceLabel:()=>'',native:(n,s)=>new Intl.NumberFormat('ko-KR',{style:'currency',currency:(companies.find(c=>c.symbol===s)??ETF_ASSETS.find(c=>c.symbol===s)).currency,maximumFractionDigits:2}).format(n)};
 const html=runInNewContext(functions+'\nassetPanel()',context);
 assert.doesNotMatch(html,/ETF 투자 후보|KODEX 단기채권/);
 assert.match(html,/평균단가/);
 for(const value of ['90,000원','140,000원','20,000원','-29,000원','34,500원','+8.21%','US\\$101'])assert.ok(html.includes(value.replace('\\','')),value);
 assert.equal((html.match(/<tbody>/g)||[]).length,1);
 assert.equal((html.match(/<tr>/g)||[]).length,4);
 state.holdings=[];state.assetAllocation.positions.SGOV.qty=0;
 const empty=runInNewContext(functions+'\nassetPanel()',context);
 assert.match(empty,/보유 자산 없음/);
 assert.doesNotMatch(empty,/NaN|Infinity|<tbody>/);
});
