import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/engine.mjs';

test('expanded registry does not activate stocks with missing histories in a legacy account',()=>{
 const legacy=engine.createState(),before=structuredClone(legacy);
 assert.equal(engine.eligibleCatalog.length,928);
 assert.equal(engine.indexCatalog.length,928);
 assert.ok(!engine.companies.some(c=>c.symbol==='053610'));
 assert.equal(engine.EXPANDED_SYMBOLS.length,36);
 assert.equal(engine.activeCompanies(legacy).length,24);
 assert.equal(Object.keys(legacy.data).length,24);
 assert.equal(legacy.analysis.reports.length,24);
 assert.equal(engine.validateState(legacy),legacy);
 assert.deepEqual(legacy.cash,before.cash);
 assert.deepEqual(legacy.history,before.history);
 for(const country of ['한국','미국','일본'])assert.equal(engine.activeCompanies(legacy).filter(c=>c.country===country).length,8);
});

test('universe activation rejects undeclared histories, incomplete data and simulated expansion',()=>{
 const legacy=engine.createState(),extra=engine.companies.find(c=>!engine.activeCompanies(legacy).some(x=>x.symbol===c.symbol));
 const undeclared=structuredClone(legacy);undeclared.data[extra.symbol]=structuredClone(legacy.data['005930']);
 assert.throws(()=>engine.validateState(undeclared),/관찰 종목|가격 데이터/);
 const incomplete=structuredClone(legacy);incomplete.mode='live';incomplete.universeVersion='expanded36';
 assert.throws(()=>engine.validateState(incomplete),/가격 데이터/);
 const simulated=structuredClone(legacy);simulated.universeVersion='expanded36';
 for(const c of engine.activeCompanies(simulated))simulated.data[c.symbol]??=structuredClone(legacy.data['005930']);
 assert.throws(()=>engine.validateState(simulated),/실제 가격/);
 const invalid=structuredClone(legacy);invalid.universeVersion='unregistered';
 assert.throws(()=>engine.validateState(invalid),/관찰 종목/);
});

function expandedAccount(){
 const state=engine.createState();state.mode='live';state.universeVersion='expanded36';state.plans=[];
 state.fx={KRW:1,USD:1400,JPY:9.5};
 for(const c of engine.activeCompanies(state))if(!state.data[c.symbol])state.data[c.symbol]=Array.from({length:260},(_,i)=>({open:100,close:100,high:101,low:99,volume:1000,time:1700000000+i*86400}));
 return state;
}
function plan(state,symbol,qty,side='buy'){
 const price=100*engine.fxOf(symbol,state),short=side==='short';
 return {id:'Ptest',symbol,qty,side,reference:price,stop:price*(short?1.04:.96),target:price*(short?.9:1.1),strategy:'S1',status:'대기',date:state.date};
}
test('new stock orders cannot exceed 1% of observed 20-day native turnover',()=>{
 const s=expandedAccount();
 const allowed=engine.risk(s,plan(s,'003030',10)),held=engine.risk(s,plan(s,'003030',11));
 assert.equal(allowed.pass,true);
 assert.equal(held.pass,false);
 assert.ok(held.checks.some(([name,pass])=>name==='20일 평균 거래대금 1% 이하'&&!pass));
 s.data['003030'].at(-1).volume=null;
 assert.equal(engine.risk(s,plan(s,'003030',1)).pass,false);
});

test('mid and small stocks retain stricter equity caps for long and short orders',()=>{
 const s=expandedAccount();
 for(const symbol of ['014680','003030'])for(const b of s.data[symbol])b.volume=200000000;
 assert.equal(engine.risk(s,plan(s,'014680',99000)).pass,true);
 assert.equal(engine.risk(s,plan(s,'014680',100000)).pass,false);
 assert.equal(engine.risk(s,plan(s,'003030',49000)).pass,true);
 for(const side of ['buy','short']){
  const held=engine.risk(s,plan(s,'003030',50000,side));
  assert.equal(held.pass,false);
  assert.ok(held.checks.some(([name,pass])=>name==='소형 종목 비중 5% 이하'&&!pass));
 }
});

test('new-stock proposals size within liquidity and size limits before approval',()=>{
 const s=expandedAccount();
 for(const c of engine.activeCompanies(s))s.data[c.symbol]=Array.from({length:320},(_,i)=>{const price=100000*Math.pow(.999,i);return {open:price,close:price,high:price*1.00001,low:price*.99999,volume:1000,time:1700000000+i*86400};});
 s.externalResearch={fresh:true,screening:[{symbol:'003030',stance:'allow',topDownScore:90,fundamentalPass:true,bottomUpPass:true,sourceUrls:['https://example.com/official'],bottomUpReason:'직접 확인한 사업 근거'}]};
 s.fundamentals={'003030':{pass:true}};
 engine.analyze(s);
 const proposal=s.plans.find(p=>p.symbol==='003030');
 assert.ok(proposal);
 assert.equal(proposal.status,'대기');
 assert.ok(proposal.qty<=10);
 assert.equal(engine.risk(s,proposal).pass,true);
 engine.approve(s,proposal.id);
 assert.equal(proposal.status,'승인');
 assert.equal(s.trades.length,0);
});

test('explicit active symbols cannot contain duplicate or unverified index candidates',()=>{
 assert.throws(()=>engine.activeCompanies({activeSymbols:['005930','005930']}),/중복|관찰 종목/);
 assert.throws(()=>engine.activeCompanies({activeSymbols:['UNREGISTERED']}),/확인|관찰 종목/);
 assert.throws(()=>engine.activeCompanies({activeSymbols:['053610']}),/확인|관찰 종목/);
});

test('unknown-size index candidates retain a 5% cap and observed liquidity requirement',()=>{
 const s=expandedAccount();
 const c=engine.companies.find(c=>c.symbol==='AOS');
 assert.equal(c.sizeClass,undefined);
 assert.equal(engine.sizeOrderCapacity(s,'AOS',100*engine.fxOf('AOS',s)).maxWeight,.05);
 const held=engine.risk(s,plan(s,'AOS',11));
 assert.equal(held.pass,false);
 assert.ok(held.checks.some(([name,pass])=>name==='20일 평균 거래대금 1% 이하'&&!pass));
});
test('explicit verified subsets calculate only prepared prices and preserve ledger',()=>{
 const s=engine.createState(),before=structuredClone(s);
 s.mode='live';s.universeVersion='indexCatalog';s.activeSymbols=['005930','AAPL','7203'];s.plans=[];
 s.data=Object.fromEntries(s.activeSymbols.map(symbol=>[symbol,s.data[symbol]]));
 assert.equal(engine.validateState(s),s);
 engine.analyze(s);
 assert.equal(s.analysis.reports.length,3);
 assert.deepEqual(s.cash,before.cash);assert.deepEqual(s.history,before.history);
 assert.equal(engine.activeCompanies(s).length,3);
});
