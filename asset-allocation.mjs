import {regularExecution,stampDecision,executionBasis} from './execution.mjs';

import {ETF_ASSETS} from './etf-catalog.mjs';
export {ETF_ASSETS} from './etf-catalog.mjs';
export const ETF_CANDIDATES=ETF_ASSETS.filter(a=>a.enabled!==false);
export const BOND_ASSET=ETF_ASSETS[0];
export const ALLOCATION_POLICY={version:1,idleAllocation:.9,maxBondWeight:.5,cashBuffer:.1,turnoverLimit:.01,rebalanceBand:.01};
// An approved buy fills only at an approved regular close; five calendar days cover a weekend and one holiday
// (order A43 waited 18 days through held reviews and a Tokyo holiday in 2026-10). Sells are risk exits and never expire.
export const PENDING_BUY_TTL=5*86400000;
const FEE=.00015,SLIP=.001;
const positive=x=>Number.isFinite(x)&&x>0;
export const assetPositions=s=>Object.values(s.assetAllocation?.positions??{});
export const assetValue=s=>assetPositions(s).reduce((n,a)=>n+a.qty*a.quote.price*a.fx.rate,0);
export const assetReceivables=s=>assetPositions(s).reduce((n,a)=>n+a.distributions.reduce((m,d)=>m+d.amount*a.fx.rate,0),0);
const assetFor=symbol=>ETF_ASSETS.find(a=>a.symbol===symbol);
const value=a=>a.qty*a.quote.price*a.fx.rate;
export function validateAssetSnapshot(input,now=Date.now(),reviewStartedAt=null){
 const stamp=Date.parse(input?.fetchedAt),q=input?.quote,asset=assetFor(input?.symbol);
 if(!asset)throw Error('허용된 한국·미국·일본 ETF가 아닙니다.');
 const fx=input.fx;
 if(!positive(fx?.rate)||!positive(fx?.time)||fx.time>now/1000+300||now/1000-fx.time>4*86400||(asset.currency==='KRW'?fx.rate!==1:fx.source!==`https://finance.yahoo.com/quote/${asset.currency==='USD'?'KRW=X':'JPYKRW=X'}/`))throw Error('실제 원화 환산 환율이 필요합니다.');
 if(input.provider!=='Yahoo Finance / Python'||input.currency!==asset.currency||!Number.isFinite(stamp)||stamp>now||!positive(q?.price)||!positive(q.time)||q.time>now/1000+300||now/1000-q.time>7*86400)throw Error('30분 이내 실제 ETF 자료가 필요합니다.');
 // Verified preopen evidence cannot execute; open/close keep the original collection freshness.
 const fresh=reviewStartedAt===null?now-stamp<=1800000:Number.isSafeInteger(reviewStartedAt)&&stamp<=reviewStartedAt&&reviewStartedAt-stamp<=1800000&&reviewStartedAt<=now&&now-reviewStartedAt<1800000;
 if(!fresh)throw Object.assign(Error('ETF 자료 또는 검토 창이 만료됐습니다.'),{reason:'priceEvidenceStale'});
 if(!Array.isArray(input.bars)||input.bars.length<20||input.bars.length>500)throw Error('ETF 일봉·거래량 확인 필요');
 const bars=input.bars.map(b=>{
  if(!['time','open','high','low','close','volume'].every(k=>positive(b[k]))||b.time>now/1000||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close))throw Error('ETF 일봉 확인 실패');
  return {time:b.time,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume};
 });
 if(new Set(bars.map(b=>b.time)).size!==bars.length||bars.some((b,i)=>i&&b.time<=bars[i-1].time))throw Error('ETF 일봉 시간 확인 실패');
 const sessions=q.regularSessions??[],seen=new Set();
 if(!Array.isArray(sessions)||sessions.length>5)throw Error('ETF 정규장 시각 확인 필요');
 const zone=new Intl.DateTimeFormat('en',{timeZone:asset.zone,year:'numeric',month:'2-digit',day:'2-digit'});
 const localDate=time=>{const p=Object.fromEntries(zone.formatToParts(new Date(time*1000)).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`};
 const regularSessions=sessions.map(e=>{
  const bar=bars.find(b=>b.time===e.openTime);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||seen.has(e.date)||!positive(e.openTime)||!positive(e.closeTime)||e.openTime>=e.closeTime||e.closeTime-e.openTime>86400||e.openTime>stamp/1000||localDate(e.openTime)!==e.date||!bar||bar.open!==e.open||typeof e.complete!=='boolean'||(e.complete?(!positive(e.close)||bar.close!==e.close||e.closeTime>stamp/1000):e.close!==null))throw Error('실제 ETF 일봉과 정규장 가격 불일치');
  seen.add(e.date);return {date:e.date,open:e.open,close:e.close,openTime:e.openTime,closeTime:e.closeTime,complete:e.complete};
 });
 if(!Array.isArray(input.sources)||!input.sources.some(s=>s.url===`https://finance.yahoo.com/quote/${asset.yahooSymbol}/history/`))throw Error('ETF 가격 출처 확인 필요');
 const dividends=input.dividends??[];
 if(!Array.isArray(dividends)||dividends.length>100||dividends.some(d=>!positive(d.time)||!positive(d.amount)||d.time>now/1000||d.amount>q.price))throw Error('ETF 분배금 공시 값 확인 필요');
 return {symbol:asset.symbol,provider:input.provider,currency:asset.currency,fx:{rate:fx.rate,time:fx.time,source:fx.source??null},fetchedAt:input.fetchedAt,quote:{price:q.price,time:q.time,regularSessions},bars,dividends,sources:[{title:'Yahoo 실제 ETF 가격',url:`https://finance.yahoo.com/quote/${asset.yahooSymbol}/history/`},{title:asset.name,url:asset.source}]};
}

export function validateAllocationState(allocation){
 if(allocation===undefined)return;
 if(!allocation||allocation.version!==1||!allocation.positions||Array.isArray(allocation.positions)||Object.keys(allocation.positions).length>ETF_ASSETS.length)throw Error('멀티에셋 보유 내역 확인 실패');
 if(allocation.decision)allocationDecision(allocation.decision,Date.parse(allocation.decision.asOf));
 for(const [symbol,a] of Object.entries(allocation.positions)){
 const asset=assetFor(symbol);
 if(!asset||a.symbol!==symbol||a.assetClass!==asset.assetClass||!Number.isInteger(a.qty)||a.qty<0||a.qty%asset.lot||!Number.isFinite(a.cost)||a.cost<0||!positive(a.quote?.price)||!positive(a.fx?.rate)||(asset.currency==='KRW'&&a.fx.rate!==1)||!Array.isArray(a.trades)||a.trades.length>100000||!Array.isArray(a.distributions)||a.distributions.length>1000)throw Error('ETF 보유 내역 확인 실패');
 for(const d of a.distributions)if(!positive(d.amount)||!positive(d.time)||typeof d.id!=='string')throw Error('분배금 미수금 확인 실패');
 for(const t of a.trades)if(t.symbol!==symbol||!['buy','sell'].includes(t.side)||!Number.isInteger(t.qty)||t.qty<=0||t.qty%asset.lot||!positive(t.price)||!positive(t.nativePrice)||!positive(t.fxRate)||!Number.isFinite(t.fee)||t.fee<0||!positive(t.executionTime)||!(t.pnl===null||Number.isFinite(t.pnl)))throw Error('ETF 체결 기록 확인 실패');
 const p=a.pending;
 if(p&&(p.symbol!==symbol||!['buy','sell'].includes(p.side)||!Number.isInteger(p.qty)||p.qty<=0||p.qty%asset.lot||!positive(p.reference)||!positive(p.eligibleAfter)||!positive(p.signalTimestamp)||p.status!=='승인'))throw Error('ETF 승인 주문 확인 실패');
 }
}

export function applyBondOnlyPolicy(s){
 const allocation=s.assetAllocation;if(!allocation)return s;
 for(const asset of ETF_ASSETS.filter(a=>a.enabled===false)){
  const weight=allocation.decision?.weights?.[asset.symbol];
  if(Number.isFinite(weight)&&weight>=0&&weight<=.1)allocation.decision.weights[asset.symbol]=0;
 }
 validateAllocationState(allocation);
 for(const asset of ETF_ASSETS.filter(a=>a.enabled===false))if(allocation.positions[asset.symbol]?.pending?.side==='buy')allocation.positions[asset.symbol].pending=null;
 return s;
}

export function allocateAssets(s,input,now,book,reserved=0,session=null,logicReview={approved:true}){
 if(s.mode!=='live')throw Error('실제 가격 모드에서만 ETF를 운용합니다.');
 applyBondOnlyPolicy(s);
 const allocation=s.assetAllocation??={version:1,positions:{}},asset=assetFor(input.symbol),retired=asset.enabled===false;
 const priorValue=assetValue(s),priorReceivables=assetReceivables(s);
 const a=allocation.positions[asset.symbol]??={symbol:asset.symbol,qty:0,cost:0,pending:null,trades:[],distributions:[]};
 a.quote=input.quote;a.fx=input.fx;
 a.metrics=assetMetrics(input);a.category=asset.category;a.assetClass=asset.assetClass;a.fetchedAt=input.fetchedAt;a.sources=input.sources;
 const current=value(a),allBonds=assetValue(s);
 for(const d of input.dividends){
  const id=String(d.time);if(a.distributions.some(x=>x.id===id))continue;
  const owned=a.trades.filter(t=>t.executionTime<d.time).reduce((n,t)=>n+(t.side==='buy'?t.qty:-t.qty),0);
  if(owned>0)a.distributions.push({id,time:d.time,qty:owned,perShare:d.amount,amount:owned*d.amount,status:'paymentUnverified',source:`https://finance.yahoo.com/quote/${asset.yahooSymbol}/history/`});
 }
 const capital=book.equity+allBonds-priorValue+assetReceivables(s)-priorReceivables;
 const free=Math.max(0,book.availableCash+allBonds-Math.max(0,reserved));
 const decision=allocation.decision,weightOf=x=>x.enabled===false?0:decision?.weights[x.symbol]??x.idleWeight;
 // Bond ETFs together stay within maxBondWeight of capital: scale every bond weight down by the same factor.
 const bondWeights=ETF_ASSETS.filter(x=>x.assetClass==='bond').reduce((n,x)=>n+weightOf(x),0);
 const weight=weightOf(asset)*(asset.assetClass==='bond'&&bondWeights>ALLOCATION_POLICY.maxBondWeight?ALLOCATION_POLICY.maxBondWeight/bondWeights:1);
 const decisionFresh=decision&&now>=Date.parse(decision.asOf)&&now-Date.parse(decision.asOf)<36*3600000;
 const changedStrategy=asset.reviewBy&&new Date(now).toISOString().slice(0,10)>=asset.reviewBy;
 let target=Math.max(0,Math.min(free*weight,capital*weight,Math.max(0,capital-book.gross)*weight/.9));
 if(asset.assetClass==='equity')target=Math.min(target,Math.max(0,capital*.8-(book.long-book.short)-(book.equityEtfs??0)+current));
 const economicValue=current+a.distributions.reduce((n,d)=>n+d.amount*a.fx.rate,0);
 if(!asset.idleWeight&&a.qty>0&&(economicValue<a.cost*.9||(a.openedAt&&now/1000-a.openedAt>=90*86400)))a.riskExitAt??=now;
 if(logicReview.approved&&!retired&&a.riskExitAt&&decision&&Date.parse(decision.asOf)>a.riskExitAt)a.riskExitAt=null;
 if(a.riskExitAt)target=0;
 const drawdown=1-capital/Math.max(capital,...s.history.map(h=>h.equity));
 const entryAllowed=!retired&&!a.riskExitAt&&!changedStrategy&&drawdown<.1&&(asset.idleWeight>0||decisionFresh);
 const incomplete=new Set(input.quote.regularSessions.filter(e=>!e.complete).map(e=>e.openTime));
 const volumeBars=input.bars.filter(b=>!incomplete.has(b.time)).slice(-20);
 const turnover=volumeBars.length===20?volumeBars.reduce((n,b)=>n+b.close*b.volume,0)/20:0;
 const lotRound=qty=>Math.floor(qty/asset.lot)*asset.lot;
 const capacity=lotRound(turnover*ALLOCATION_POLICY.turnoverLimit/input.quote.price);
 const priceKRW=input.quote.price*input.fx.rate;
 const cashRoom=Math.max(0,book.availableCash-Math.max(0,reserved)-free*ALLOCATION_POLICY.cashBuffer);
 const bondValue=assetPositions(s).filter(x=>x.assetClass==='bond').reduce((n,x)=>n+value(x),0);
 const buyBudget=Math.max(0,Math.min(target-current,cashRoom,capital-book.gross-allBonds,asset.assetClass==='bond'?capital*ALLOCATION_POLICY.maxBondWeight-bondValue:Infinity));
 const approvedMs=Date.parse(a.pending?.approvedAt)||(a.pending?.eligibleAfter||a.pending?.signalTimestamp||0)*1000;
 if(a.pending?.side==='buy'&&approvedMs&&now-approvedMs>PENDING_BUY_TTL){s.events.unshift({date:new Date(now+9*3600000).toISOString().slice(0,10),text:`${asset.name} 매수 ${a.pending.qty}주 승인 만료 · 5일 내 미체결`});a.pending=null;}
 if(a.pending?.side==='buy'&&(!entryAllowed||buyBudget<priceKRW*(1+SLIP)*(1+FEE)*asset.lot||capital<=0||s.insolvent))a.pending=null;
 const quote=session?{...input.quote,regularSessions:input.quote.regularSessions.filter(e=>e.date===session.date)}:input.quote;
 const p=a.pending,event=p&&(logicReview.approved||p.side==='sell'&&(retired||a.riskExitAt||p.riskExit))&&(!session||session.phase===(executionBasis(p.side,s)==='regularClose'?'close':'open'))?regularExecution(s,p,quote,now):null;
 let status='allocated';
 if(p&&event){
  const nativePrice=event.sessionPrice*(1+(p.side==='buy'?SLIP:-SLIP)),price=nativePrice*input.fx.rate;
  const limit=p.side==='buy'?lotRound(buyBudget/(price*(1+FEE))):Math.min(a.qty,Math.ceil(Math.max(0,current-target)/priceKRW/asset.lot)*asset.lot);
  const qty=Math.min(p.qty,capacity,limit);
  const freshFX=asset.currency==='KRW'||(now/1000-input.fx.time<=7200&&input.fx.time>=event.executionTime);
  if(qty>0&&freshFX&&(p.side==='buy'||Math.abs(event.sessionPrice/p.reference-1)<=.03)){
   const gross=qty*price,fee=gross*FEE,basis=a.qty?a.cost*qty/a.qty:0;
   s.cash+=p.side==='buy'?-(gross+fee):gross-fee;
   if(p.side==='buy'&&a.qty===0)a.openedAt=event.executionTime;
   a.cost+=p.side==='buy'?gross+fee:-basis;a.qty+=p.side==='buy'?qty:-qty;
   if(a.qty===0)a.cost=0;
   a.trades.unshift({id:'A'+s.nextId++,symbol:asset.symbol,side:p.side,qty,price,nativePrice,fxRate:input.fx.rate,fxTime:input.fx.time,fee,pnl:p.side==='sell'?gross-fee-basis:null,date:event.sessionDate,strategy:asset.category+' 자산 배분',...event});
   s.events.unshift({date:event.sessionDate,text:`${asset.name} ${p.side==='buy'?'매수':'매도'} ${qty}주 · 실제 정규장 모의 체결`});
   status='executed';a.pending=null;
  }else{a.pending=null;status='riskHeld'}
 }
 if(!a.pending&&status!=='executed'&&(!session||session.phase==='pre'||(retired||a.riskExitAt)&&a.qty>0)){
  const delta=target-value(a),selling=delta<0;
  const qty=Math.min(capacity,selling?Math.min(a.qty,Math.ceil(-delta/priceKRW/asset.lot)*asset.lot):lotRound(buyBudget/(priceKRW*(1+SLIP)*(1+FEE))));
  if(capital>0&&!s.insolvent&&(selling||entryAllowed)&&(logicReview.approved||selling&&(retired||a.riskExitAt))&&qty>0&&(a.qty===0||Math.abs(delta)>=capital*ALLOCATION_POLICY.rebalanceBand||a.riskExitAt||retired)){
   const order={id:'A'+s.nextId++,symbol:asset.symbol,side:selling?'sell':'buy',qty,reference:input.quote.price,status:'승인',riskExit:!!(selling&&(retired||a.riskExitAt)),signalTimestamp:input.quote.time};stampDecision(order,now);a.pending=order;status='orderApproved';
   s.events.unshift({date:new Date(now+9*3600000).toISOString().slice(0,10),text:`${asset.name} ${selling?'매도':'매수'} ${qty}주 승인 · 다음 정규장 ${executionBasis(order.side,s)==='regularOpen'?'시가':'종가'} 대기`});
  }else if(capacity===0)status='liquidityLimited';
 }
 if(!logicReview.approved&&status!=='executed'&&status!=='orderApproved')status='logicReviewHeld';
 else if(a.pending&&status!=='orderApproved')status='awaitingSession';
 a.lastUpdatedAt=new Date(now).toISOString();a.status=status;allocation.lastUpdatedAt=a.lastUpdatedAt;
 validateAllocationState(allocation);
 return {status,asset,policy:ALLOCATION_POLICY,holding:{qty:a.qty,cost:a.cost,value:value(a)},pending:a.pending,unrealized:value(a)-a.cost,distributionReceivables:assetReceivables(s),sources:input.sources,limitations:'채권 가격·금리·유동성 및 USD/JPY 환율 위험. 외화 매매는 수집 시점 실제 환율로 원화 환산하는 모의 모델입니다. 지급일 미확인 분배금은 미수금이며 가용 현금이 아닙니다.'};
}

export function assetMetrics(input){
 const bars=input.bars,close=bars.at(-1),returns=bars.slice(-61).slice(1).map((b,i)=>b.close/bars.slice(-61)[i].close-1);
 const mean=returns.reduce((n,x)=>n+x,0)/returns.length;
 const volatility=returns.length>1?Math.sqrt(returns.reduce((n,x)=>n+(x-mean)**2,0)/(returns.length-1))*Math.sqrt(252):null;
 const total=n=>{const prior=bars.at(-n-1);return prior?(close.close+input.dividends.filter(d=>d.time>prior.time&&d.time<=close.time).reduce((v,d)=>v+d.amount,0))/prior.close-1:null};
 const sma=bars.length>=60?bars.slice(-60).reduce((n,b)=>n+b.close,0)/60:null;
 return {asOf:new Date(close.time*1000).toISOString(),return20:total(20),return60:total(60),volatility,above60:sma===null?null:close.close>sma,method:'현지통화 가격+기간 분배금 단순수익률, 재투자·세금·FX 미반영. 변동성은 가격 기준.'};
}
export function allocationDecision(input,now=Date.now()){
 if(!input||!Number.isFinite(Date.parse(input.asOf))||Date.parse(input.asOf)>now||now-Date.parse(input.asOf)>36*3600000||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>6000||typeof input.risks!=='string'||!input.risks.trim()||input.risks.length>6000||!Array.isArray(input.sourceUrls)||!input.sourceUrls.length||input.sourceUrls.length>20)throw Error('ETF 배분 판단의 시점·편입 이유·위험·출처가 필요합니다.');
 for(const url of input.sourceUrls){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('공개 HTTPS ETF 근거가 필요합니다.')}
 if(!input.weights||Array.isArray(input.weights)||typeof input.weights!=='object')throw Error('ETF 목표 비중 형식 오류');
 const weights=Object.fromEntries(ETF_ASSETS.map(a=>[a.symbol,0]));let total=0,tactical=0;
 for(const [symbol,weight] of Object.entries(input.weights)){const asset=assetFor(symbol);if(!asset||!Number.isFinite(weight)||weight<0||weight>asset.maxWeight)throw Error('ETF 종목별 비중 한도 초과');total+=weight;if(!asset.idleWeight)tactical+=weight;weights[symbol]=weight;}
 if(total>.90000001||tactical>.40000001)throw Error('ETF 총 90%·중장기·회사채 합산 40% 한도 초과');
 return {asOf:input.asOf,weights,reason:input.reason.trim(),risks:input.risks.trim(),sourceUrls:[...input.sourceUrls]};
}
