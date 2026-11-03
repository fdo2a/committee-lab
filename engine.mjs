import {companies,coreCompanies,activeCompanies,CORE_SYMBOLS,EXPANDED_SYMBOLS,indexCatalog,eligibleCatalog} from './universe.mjs';
export {companies,coreCompanies,activeCompanies,CORE_SYMBOLS,EXPANDED_SYMBOLS,indexCatalog,eligibleCatalog} from './universe.mjs';
import {unitEntryCheck,unitWeightLimit,recordUnitEntry,monitorUnits,styleScore,historicalRisk,basketRisk,portfolioUnitRisk,unitPerformance} from './trend-units.mjs';
import {quantScreening,ff3For} from './quant-research.mjs';
import {ff3AlphaScore} from './fama-french.mjs';
import {ideaEntryCheck,ideaFor,departmentOpinions,departmentNames,entryEligible,businessResearch,technicalOpinionScore} from './committee.mjs';
import {regularExecution,stampDecision} from './execution.mjs';
import {assetValue,assetReceivables,validateAllocationState} from './asset-allocation.mjs';
import {FUNDAMENTALS_MAX_AGE_DAYS} from './fundamentals-freshness.mjs';
export const INITIAL = 100000000,
  FEE = 0.00015,
  SLIP = 0.001;
export const SHORT_BORROW_RATE = 0.03;
export const isEntry = p => ["buy","short"].includes(p.side);
export const isShort = h => h.direction === "short";
const strategyMatchesMarket=(strategy,regime)=>strategy.direction==='short'?regime==='하락':regime!=='하락';
export const sideLabel = side => ({buy:"롱 매수",sell:"롱 청산",short:"숏 진입",cover:"숏 상환"}[side] || side);
const companyBySymbol = new Map(companies.map(c=>[c.symbol,c]));
const dateFormats=Object.fromEntries(Object.entries({한국:'Asia/Seoul',미국:'America/New_York',일본:'Asia/Tokyo'}).map(([country,timeZone])=>[country,new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'})]));
export const fxOf = (symbol,state) => {const c=companyBySymbol.get(symbol);return state?.fx?.[c.currency]??c.fx};
export const krwBars = (state, symbol) => {
  const fx=fxOf(symbol,state);
  return state.data[symbol].map((b) => ({
    ...b,
    ...(Number.isFinite(b.time)&&b.time>0?{date:dateFormats[companyBySymbol.get(symbol).country].format(new Date(b.time*1000))}:{}),
    open: b.open * fx,
    close: b.close * fx,
    high: b.high * fx,
    low: b.low * fx,
  }));
};
export const depts = [
  ["산업·테마분석부", "발굴", "산업·정책·수요에서 투자 아이디어와 바스켓 후보를 발굴합니다."],
  ["기술적 분석부", "타이밍", "발굴된 후보의 추세·모멘텀·변동성을 검증하고 진입 시점을 지원합니다."],
  ["펀더멘탈부", "가치", "발굴된 후보의 사업·공시·실적·현금흐름·가치를 검증합니다."],
  ["마켓부", "국면", "시장 국면·금리·환율을 반영해 투자 아이디어와 바스켓 후보를 발굴합니다."],
  ["리스크관리부", "보호", "운용부의 편입안을 심사하고 위험 한도 위반을 차단합니다."],
  ["운용부", "결정", "후보의 기업·계량·기술 검토와 반대 의견을 종합해 유닛·종목·비중·목표·기한을 결정합니다."],
  ["퀀트리서치부", "계량", "같은 아이디어 후보의 실제 재무·가격 팩터를 점수화하고 순위·위험값·성과를 계산합니다."],
];
export const regimes = ["상승", "하락", "횡보"],
  families = ["추세 추종", "돌파", "눌림목", "평균 회귀", "상대강도"],
  sizing = ["고정 비중", "변동성 조절", "분할 진입", "확인 후 진입"];
export const strategies = regimes.flatMap((regime, r) =>
  families.flatMap((family, f) =>
    sizing.map((size, z) => ({
      id: `${r === 1 ? "SH" : "S"}${r * 20 + f * 4 + z + 1}`,
      direction: r === 1 ? "short" : "long",
      regime,
      family,
      size,
      r,
      f,
      z,
    })),
  ),
);
const round = (n) => Math.round(n);
const priceRound = (n, c) =>
  c.currency === "USD" ? Math.round(n * 100) / 100 : Math.round(n);
export function nextDate(date) {
  let d = new Date(date + "T12:00:00Z");
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
function noise(seed, index) {
  const x = Math.sin(seed * 17.83 + index * 83.17) * 43758.5453;
  return x - Math.floor(x);
}
export function bar(c, i, prev) {
  const seed = [...c.symbol].reduce((v, k) => v * 31 + k.charCodeAt(0), 0),
    n = noise(seed, i),
    cycle = Math.sin(i / 23 + 2.5) * 0.002;
  const open = priceRound(prev * (1 + (noise(seed + 1, i) - 0.5) * 0.009), c);
  const close = priceRound(
    open * (1 + c.drift + cycle + (n - 0.49) * 0.026),
    c,
  );
  return {
    open,
    close,
    high: priceRound(
      Math.max(open, close) * (1 + noise(seed + 2, i) * 0.009),
      c,
    ),
    low: priceRound(
      Math.min(open, close) * (1 - noise(seed + 3, i) * 0.009),
      c,
    ),
    volume: round(1000000 + noise(seed + 4, i) * 7000000),
  };
}
export function dataset(count = 260) {
  return Object.fromEntries(
    coreCompanies.map((c) => {
      const a = [];
      let p = c.base;
      for (let i = 0; i < count; i++) {
        const b = bar(c, i, p);
        a.push(b);
        p = b.close;
      }
      return [c.symbol, a];
    }),
  );
}
export const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export function technical(bars) {
  const closes = bars.map((b) => b.close),
    p = closes.at(-1),
    ma20 = mean(closes.slice(-20)),
    ma60 = mean(closes.slice(-60)),
    momentum = p / closes.at(-21) - 1,
    returns = closes
      .slice(-21)
      .slice(1)
      .map((x, i) => x / closes.slice(-21)[i] - 1),
    vol = Math.sqrt(mean(returns.map((r) => r * r))) * Math.sqrt(252),
    atr = mean(bars.slice(-14).map((b) => b.high - b.low));
  return {
    p,
    ma20,
    ma60,
    momentum,
    vol,
    atr,
    trend:
      p > ma20 && ma20 > ma60
        ? "상승"
        : p < ma20 && ma20 < ma60
          ? "하락"
          : "횡보",
    change: p / closes.at(-2) - 1,
  };
}
export function market(state, country = "전체") {
  const pool = activeCompanies(state).filter(
    (c) => country === "전체" || c.country === country,
  );
  if(!pool.length)return {count:0,regime:"횡보",breadth:0,momentum:0,vol:0,uncertain:true};
  const t = pool.map((c) => technical(state.data[c.symbol]));
  const breadth = t.filter((x) => x.p > x.ma60).length / t.length,
    mom = mean(t.map((x) => x.momentum));
  return {
    count: t.length,
    regime:
      breadth >= 0.6 && mom > 0
        ? "상승"
        : breadth <= 0.4 && mom < 0
          ? "하락"
          : "횡보",
    breadth,
    momentum: mom,
    vol: mean(t.map((x) => x.vol)),
    uncertain: breadth > 0.35 && breadth < 0.65,
  };
}
export const markPrice=(s,symbol)=>(s.mode==='live'?s.marketData?.quotes?.[symbol]?.price:undefined)??s.data[symbol].at(-1).close;
export function exposure(s) {
  let long=0,short=0,restrictedProceeds=0;
  for(const h of s.holdings){const value=h.qty*markPrice(s,h.symbol)*fxOf(h.symbol,s);if(isShort(h)){short+=value;restrictedProceeds+=Math.max(h.cost,value);}else long+=value;}
  const etfs=assetValue(s),equityEtfs=Object.values(s.assetAllocation?.positions??{}).filter(a=>a.assetClass==='equity').reduce((n,a)=>n+a.qty*a.quote.price*a.fx.rate,0),bonds=etfs-equityEtfs,receivables=assetReceivables(s),total=s.cash+long-short+etfs+receivables;
  return {long,short,etfs,equityEtfs,bonds,receivables,assetGross:long+short+etfs,assetGrossRatio:total>0?(long+short+etfs)/total:null,gross:long+short,net:long+equityEtfs-short,equity:total,restrictedProceeds,margin:short,availableCash:s.cash-restrictedProceeds-short,grossRatio:total>0?(long+short+etfs)/total:null,netRatio:total>0?(long+equityEtfs-short)/total:null};
}
export function equity(s) { return exposure(s).equity; }
export function unrealized(s,h) {const value=h.qty*markPrice(s,h.symbol)*fxOf(h.symbol,s);return isShort(h)?h.cost-value-(h.borrowAccrued||0):value-h.cost;}
export function drawdown(points) {
  let peak = points[0] || INITIAL,
    dd = 0;
  for (const p of points) {
    peak = Math.max(peak, p);
    dd = Math.max(dd, (peak - p) / peak);
  }
  return dd;
}
const guardedCompany = company => company && (['mid','small'].includes(company.sizeClass)||!CORE_SYMBOLS.includes(company.symbol));
// Order capacity uses observed native-currency turnover, never market-cap metadata.
export function sizeOrderCapacity(state,symbol,priceKrw=markPrice(state,symbol)*fxOf(symbol,state)) {
  const company=companyBySymbol.get(symbol);
  if(!guardedCompany(company))return {maxWeight:Infinity,maxQty:Infinity,volumeVerified:true,averageTurnoverNative:null};
  const provisional=new Set((state.marketData?.quotes?.[symbol]?.regularSessions||[]).filter(session=>!session.complete).map(session=>session.openTime));
  const bars=(state.data?.[symbol]||[]).filter(b=>!provisional.has(b.time)).slice(-20);
  const volumeVerified=bars.length===20&&bars.every(b=>Number.isFinite(b.close)&&b.close>0&&Number.isFinite(b.volume)&&b.volume>0);
  const averageTurnoverNative=volumeVerified?mean(bars.map(b=>b.close*b.volume)):null;
  const nativePrice=priceKrw/fxOf(symbol,state);
  const maxQty=volumeVerified&&Number.isFinite(nativePrice)&&nativePrice>0?Math.floor(averageTurnoverNative*.01/nativePrice):0;
  return {maxWeight:company.sizeClass==='mid'?.1:.05,maxQty,volumeVerified,averageTurnoverNative};
}
export function sizeLiquidityChecks(state,plan,priceKrw=markPrice(state,plan.symbol)*fxOf(plan.symbol,state)) {
  const company=companyBySymbol.get(plan.symbol);
  if(!isEntry(plan)||!guardedCompany(company))return [];
  const capacity=sizeOrderCapacity(state,plan.symbol,priceKrw);
  return [
    ['20거래일 거래량 확인',capacity.volumeVerified],
    ['20일 평균 거래대금 1% 이하',capacity.volumeVerified&&plan.qty<=capacity.maxQty],
  ];
}
export function risk(s, p, price=markPrice(s,p.symbol)*fxOf(p.symbol,s),now=Date.now(),reserved=[]) {
  const book=exposure(s),e=book.equity,short=p.side==='short',notional=p.qty*price*(1+SLIP),cost=notional*(1+FEE);
  const company=companyBySymbol.get(p.symbol),sector=company.sector;
  const sizeWeightLimit=guardedCompany(company)?(company.sizeClass==='mid'?.1:.05):null;
  const value=x=>x.qty*markPrice(s,x.symbol)*fxOf(x.symbol,s);
  const pending=[...s.plans.filter(x=>x.status==='승인'&&x.id!==p.id&&isEntry(x)),...reserved.filter(x=>x.id!==p.id)];
  const reservedCost=pending.reduce((a,x)=>a+value(x)*(1+SLIP)*(1+FEE),0);
  const pendingLong=pending.filter(x=>x.side==='buy').reduce((a,x)=>a+value(x)*(1+SLIP),0);
  const pendingShort=pending.filter(x=>x.side==='short').reduce((a,x)=>a+value(x)*(1+SLIP),0);
  const combined=[...s.holdings,...pending];
  const existing=combined.filter(x=>x.symbol===p.symbol).reduce((a,x)=>a+value(x),0);
  const sectorVal=combined.filter(x=>companyBySymbol.get(x.symbol).sector===sector).reduce((a,x)=>a+value(x),0);
  const loss=p.qty*(short?p.stop-price*(1-SLIP):price*(1+SLIP)-p.stop)+notional*FEE*2;
  const priorLoss=combined.reduce((a,x)=>a+x.qty*Math.max(0,(isShort(x)||x.side==='short')?x.stop-markPrice(s,x.symbol)*fxOf(x.symbol,s):markPrice(s,x.symbol)*fxOf(x.symbol,s)-x.stop),0);
  const prospectiveLong=book.long+pendingLong+(short?0:notional),prospectiveShort=book.short+pendingShort+(short?notional:0);
  const unit=unitEntryCheck(s,p.symbol,short?'short':'long',p.unitId,now);
  const configuration=s.trendUnits?.find(u=>u.id===p.unitId)??unit.unit;
  const memberBudget=(configuration?.maxWeight??0)*(configuration?.members.find(m=>m.symbol===p.symbol)?.weight??0);
  const unitValue=combined.filter(x=>x.unitId===p.unitId).reduce((n,x)=>n+value(x),0);
  const checks=[
    ...(s.mode==='live'&&s.investmentProcessVersion>=5?[[`서버 재무 숫자·${FUNDAMENTALS_MAX_AGE_DAYS}일 이내 수집 확인`,entryEligible(s,p.symbol,p.ideaId,now)]]:[]),
    ...(s.mode==='live'&&s.investmentProcessVersion>=4?[['유닛 투자 프로세스 근거',!!p.unitId&&unit.pass&&(s.investmentProcessVersion<5||unit.unit?.ideaId===p.ideaId)],['유닛 비중 예산 이하',!!p.unitId&&(unitValue+notional)/e<=unitWeightLimit(s,p)],['유닛 내 종목 배분 예산 이하',!!p.unitId&&(existing+notional)/e<=memberBudget]]:[]),
    ['수량·가격 유효',Number.isInteger(p.qty)&&p.qty>0&&price>0&&p.stop>0&&p.target>0&&(short?p.stop>price&&p.target<price:p.stop<price&&p.target>price)],
    ['계좌 순자산 양수',e>0&&!s.insolvent],
    ['가용 현금',cost+reservedCost<=book.availableCash],
    [short?'숏 종목 비중 10% 이하':'종목 비중 20% 이하',(notional+existing)/e<=(short?0.1:0.2)],
    ['업종 비중 40% 이하',(notional+sectorVal)/e<=0.4],
    ['총노출 100% 이하',(prospectiveLong+prospectiveShort+book.etfs)/e<=1],
    ['숏 총노출 30% 이하',prospectiveShort/e<=0.3],
    ['절대 순노출 80% 이하',Math.abs(prospectiveLong+book.equityEtfs-prospectiveShort)/e<=0.8],
    ['계획 손실 0.8% 이하',loss/e<=0.008],
    ['합산 손절 손실 5% 이하',(loss+priorLoss)/e<=0.05],
    ['동일 종목 양방향 금지',!combined.some(x=>x.symbol===p.symbol&&(isShort(x)||x.side==='short')!==short)],
    ['최대낙폭 10% 이하',drawdown(s.history.map(x=>x.equity))<0.1],
    ...(sizeWeightLimit?[[(company.sizeClass==='mid'?'중형 종목 비중 10% 이하':company.sizeClass==='small'?'소형 종목 비중 5% 이하':'규모 미확인 한도 5%'),(notional+existing)/e<=sizeWeightLimit]]:[]),
    ...sizeLiquidityChecks(s,p,price),
  ];
  return {pass:checks.every(x=>x[1]),checks,cost,weight:notional/e,loss};
}
function signal(bars, i, st) {
  const a = bars.slice(0, i + 1),
    t = technical(a),
    reg = t.trend;
  if (reg !== st.regime) return false;
  let yes = false;
  if(st.direction==='short') {
    if(st.f===0)yes=t.p<t.ma20&&t.momentum<-.01;
    if(st.f===1)yes=t.p<Math.min(...a.slice(-21,-1).map(x=>x.low));
    if(st.f===2)yes=t.ma20<t.ma60&&Math.abs(t.p/t.ma20-1)<.015;
    if(st.f===3)yes=t.p/t.ma20>1.025;
    if(st.f===4)yes=t.momentum<-.04;
    if(st.z===3)yes=yes&&a.at(-1).close<a.at(-2).close;
  } else {
    if(st.f===0)yes=t.p>t.ma20&&t.momentum>.01;
    if(st.f===1)yes=t.p>Math.max(...a.slice(-21,-1).map(x=>x.high));
    if(st.f===2)yes=t.ma20>t.ma60&&Math.abs(t.p/t.ma20-1)<.015;
    if(st.f===3)yes=t.p/t.ma20<.975;
    if(st.f===4)yes=t.momentum>.04;
    if(st.z===3)yes=yes&&a.at(-1).close>a.at(-2).close;
  }
  return yes;
}
export function backtest(bars, st, start = 180) {
  let cash=INITIAL,qty=0,entry=0,entryI=0,losses=0,trades=0,entryCost=0,borrow=0,lastBorrowDate=null;
  const short=st.direction==='short',points=[cash];
  const close=price=>{const fill=price*(1+(short?SLIP:-SLIP));const amount=qty*fill*(1+(short?FEE:-FEE));const pnl=short?entryCost-amount-borrow:amount-entryCost;if(pnl<0)losses++;cash+=short?-amount:amount;qty=0;trades++;};
  for(let i=start;i<bars.length-1;i++){
    const t=technical(bars.slice(0,i+1)),next=bars[i+1];
    if(qty&&short){const days=next.date&&lastBorrowDate?Math.max(0,(Date.parse(next.date)-Date.parse(lastBorrowDate))/86400000):1;const fee=qty*t.p*SHORT_BORROW_RATE*days/365;cash-=fee;borrow+=fee;lastBorrowDate=next.date;}
    const ret=(t.p/entry-1)*(short?-1:1);
    if(qty&&(ret<-.05||ret>.1||i-entryI>=15||(short&&cash-Math.max(entryCost,qty*t.p)-qty*t.p<0)))close(next.open);
    else if(!qty&&signal(bars,i,st)){
      const allocation=st.z===1?Math.min(.2,.03/Math.max(t.vol,.1)):st.z===2?.1:.2;
      const fill=next.close*(1+(short?-SLIP:SLIP));qty=Math.max(0,Math.floor(cash*allocation/(fill*(1+FEE))));entryCost=qty*fill*(1+(short?-FEE:FEE));cash+=short?entryCost:-entryCost;entry=fill;entryI=i+1;borrow=0;lastBorrowDate=next.date;
    }
    points.push(cash+qty*next.close*(short?-1:1));
  }
  // A remaining position is marked, never liquidated at an invented terminal event.
  const ret=points.at(-1)/INITIAL-1,dd=drawdown(points),baseline=bars.at(-1).close/bars[start].close-1;
  return {ret,dd,trades,losses,baseline,pass:trades>=3&&ret>0&&dd<=.15,points};
}
const researchCache = new WeakMap();
export function research(s,selectedSymbols) {
  const available=activeCompanies(s),scoped=selectedSymbols!==undefined;
  if(scoped&&(!Array.isArray(selectedSymbols)||!selectedSymbols.length||selectedSymbols.some(symbol=>!available.some(c=>c.symbol===symbol))))return [];
  const pool=scoped?[...new Set(selectedSymbols)].sort().map(symbol=>companyBySymbol.get(symbol)):available;
  if(!pool.length)return [];
  const symbols=pool.map(c=>c.symbol).join(','),stamp=available.map(c=>c.symbol+':'+s.data[c.symbol].length).join(',');
  let cache=researchCache.get(s);
  if(!cache||cache.stamp!==stamp||cache.data!==s.data||cache.fx!==s.fx||cache.mode!==s.mode||cache.universeVersion!==(s.universeVersion??'core24')){cache={stamp,data:s.data,fx:s.fx,mode:s.mode,universeVersion:s.universeVersion??'core24',results:new Map()};researchCache.set(s,cache);}
  const key=(scoped?'unit:':'global:')+symbols;if(cache.results.has(key))return cache.results.get(key);
  const allBars=pool.map(c=>krwBars(s,c.symbol));
  const minTrainTrades=scoped?Math.max(3,pool.length):24,minTestTrades=scoped?Math.max(2,Math.ceil(pool.length/2)):pool.length*(s.mode==='live'?.5:1.5);
  const results = strategies.map((st) => {
    const split=s.mode==='live'?Math.max(220,Math.floor(allBars[0].length*0.7)):null;
    const train=split?allBars.map(b=>backtest(b.slice(0,split),st)):null;
    const results = allBars.map(b=>backtest(b,st,split||180)),
      ret = mean(results.map((x) => x.ret)),
      dd = Math.max(...results.map((x) => x.dd)),
      trades = results.reduce((a, x) => a + x.trades, 0);
    return {
      ...st,
      ret,
      dd,
      trades,
      split,
      trainRet:train?mean(train.map(x=>x.ret)):null,
      trainTrades:train?train.reduce((a,x)=>a+x.trades,0):null,
      ...(scoped?{symbols:pool.map(c=>c.symbol),minTrainTrades,minTestTrades}:{}),
      pass: trades >= minTestTrades && ret > 0 && dd <= 0.15 && (!train||(mean(train.map(x=>x.ret))>0&&train.reduce((a,x)=>a+x.trades,0)>=minTrainTrades)),
    };
  });
  cache.results.set(key,results);
  return results;
}
export function researchForUnit(s,unitId){
 if(s.mode!=='live'||!(s.investmentProcessVersion>=5))return research(s);
 const unit=s.trendUnits?.find(u=>u.id===unitId)??s.externalResearch?.trendUnits?.find(u=>u.id===unitId);
 return unit?.members?.length?research(s,unit.members.map(m=>m.symbol)):[];
}
export function analysisReports(s,now=Date.now()){
  return activeCompanies(s).map((c) => {
      const t = technical(krwBars(s, c.symbol)),
        score = technicalOpinionScore(t);
      const external = s.externalResearch?.screening?.find(
        (x) => x.symbol === c.symbol,
      );
      const combined = external
        ? Number.isFinite(external.topDownScore)? round(external.topDownScore):null
        : s.mode==='live'?null:Math.max(0,Math.min(100,round(50+c.growth-c.pe/3-c.debt/10)));
      const selected=s.externalResearch?.trendUnits?.find(u=>u.action==='hold'&&u.members.some(m=>m.symbol===c.symbol));
      const idea=ideaFor(s,selected?.ideaId)??s.externalResearch?.investmentIdeas?.find(i=>i.action==='review'&&i.candidates.some(x=>x.symbol===c.symbol));
      const opinions=departmentOpinions(s,c,t,market(s,c.country).regime,score,idea?.id);
      const screeningOpinion=opinions.find(x=>x.department==='screening');
      const independentScreening=s.externalResearch?.departmentResearch?.screening?.some(x=>x.symbol===c.symbol);
      const candidateDepartments=s.investmentProcessVersion>=5?(idea?.action==='review'?idea.sourceDepartments:[]):opinions.filter(x=>x.stance==='allow').map(x=>x.department);
      const business=businessResearch(s,c.symbol,s.investmentProcessVersion>=5?idea?.id:undefined);
      const eligible=entryEligible(s,c.symbol,selected?.ideaId,now);
      const unit=unitEntryCheck(s,c.symbol,market(s,c.country).regime==='하락'?'short':'long',selected?.id,now);
      const style=styleScore(s.fundamentals?.[c.symbol]?.metrics,score,ff3AlphaScore(ff3For(s,c.symbol)));
      return {
        symbol: c.symbol,
        opinions,candidateDepartments,ideaId:idea?.id??null,
        style,riskMetrics:historicalRisk(krwBars(s,c.symbol)),unitId:unit.unit?.id??null,unitName:unit.unit?.name??null,unitReady:unit.pass,unitReason:unit.reason,
        candidateScore:Math.max(0,...opinions.filter(x=>x.stance==='allow'&&Number.isFinite(x.score)).map(x=>x.score)),
        disagreements:[...opinions.filter(x=>x.stance==='avoid').map(x=>({department:x.department,reason:x.reason})),...(idea?.opposingViews??[])],
        managementStatus:candidateDepartments.length?(eligible?'검토':'보류'):'관찰',
        managementReason:eligible?'부서별 제안과 반대 근거를 전략·비중 조건과 함께 검토':'최신 사업·공시 조사 또는 서버 재무 검증 미충족',
        score: independentScreening?screeningOpinion.score:combined,
        technicalScore: score,
        topDownScore: screeningOpinion.score,
        bottomUpScore: opinions.find(x=>x.department==='fundamental').score,
        stance: screeningOpinion.stance,
        screeningReason:screeningOpinion.reason,
        topDownReason:screeningOpinion.reason,
        bottomUpReason:business?.reason??external?.bottomUpReason??'사업·성장 요인 조사 미확인',
        fundamentalReview:s.fundamentals?.[c.symbol]?`${business?.reason||'사업 조사 미확인'} · ${s.fundamentals[c.symbol].text||''}`:external?.fundamentalReview??'공시 수치·밸류에이션 검증 미확인',
        fundamentalPass:eligible,
        risks:opinions.filter(x=>x.risks).map(x=>`${x.name}: ${x.risks}`).join(' · ')||external?.risks||'기업별 반대 근거 조사 미확인',
        ...t,
      };
    });
}
// ponytail: equal quant/technical weights plus a fixed bonus for a validated entry signal; calibrate from unit results.
export function selectionScore(r,st){
  const quant=r.quant?.ready?r.quant.style.score:0,technicalScore=r.opinions?.find(o=>o.department==='technical')?.score??r.technicalScore??0,signalBonus=st?10:0;
  return {score:round(.5*quant+.5*technicalScore+signalBonus),quant,technical:technicalScore,signal:!!st};
}
// Largest quantity up to p.qty that passes every risk check; size-dependent checks only get worse as qty grows.
export function fitRiskQty(s,p,price,now,reserved=[]){
  const at=qty=>risk(s,{...p,qty},price,now,reserved);
  let best=at(p.qty);if(best.pass)return {...best,qty:p.qty};
  let lo=1,hi=p.qty-1,qty=0;best=at(1);if(!best.pass)return {...best,qty:0};
  while(lo<=hi){const mid=Math.floor((lo+hi)/2),rr=at(mid);if(rr.pass){qty=mid;best=rr;lo=mid+1;}else hi=mid-1;}
  return {...best,qty};
}
export function analyze(s,now=Date.now()) {
  const m = market(s);
  for (const p of s.plans)
    if (p.status === "대기" && p.date !== s.date) p.status = "만료";
  s.analysis = {
    date: s.date,
    market: m,
    reports: analysisReports(s,now),
  };
  s.analysis.unitRisk=(s.externalResearch?.trendUnits||[]).filter(u=>u.members.every(m=>activeCompanies(s).some(c=>c.symbol===m.symbol))).map(u=>basketRisk(s,u,krwBars));
  refreshQuantAnalysis(s,now);
  const ranked = s.analysis.reports
      .filter((x) => x.candidateDepartments.length && x.fundamentalPass && (s.investmentProcessVersion<5||!s.investmentProcessVersion||x.unitReady));
  const candidates=[];
  for (const r of ranked) {
    if(s.holdings.some(h=>h.symbol===r.symbol)){r.managementStatus='보유';r.managementReason='이미 보유한 종목: 중복 진입 보류';continue;}
    if (
      s.plans.some(
        (p) =>
          p.symbol === r.symbol &&
          ((["대기", "보류"].includes(p.status) && p.date === s.date) ||
            p.status === "승인"),
      )
    )
      continue;
    const short=market(s,companyBySymbol.get(r.symbol).country).regime==='하락';
    const unitCheck=unitEntryCheck(s,r.symbol,short?'short':'long',r.unitId,now);
    if(!unitCheck.pass){r.managementStatus='보류';r.managementReason=unitCheck.reason;continue;}
    const unit=unitCheck.unit;
    const countryRegime=market(s,companyBySymbol.get(r.symbol).country).regime;
    const st=researchForUnit(s,unit?.id).filter(x=>x.pass&&(s.strategyLearning?.[x.id]?.scale??1)>0).sort((a,b)=>(b.ret*(s.strategyLearning?.[b.id]?.scale??1))-(a.ret*(s.strategyLearning?.[a.id]?.scale??1)))
      .find(x=>strategyMatchesMarket(x,countryRegime)&&signal(krwBars(s, r.symbol), s.data[r.symbol].length - 1, x));
    candidates.push({r,short,unit,st,selection:selectionScore(r,st)});
  }
  // Quant, technical and risk choose which candidates to buy, not whether: the best-ranked are sized first
  // and later ones are shrunk to whatever the hard account limits leave.
  candidates.sort((a,b)=>b.selection.score-a.selection.score||a.r.symbol.localeCompare(b.r.symbol));
  const reserved=[];
  candidates.forEach(({r,short,unit,st,selection},i)=>{
    const episode=s.trendUnits?.find(u=>u.id===unit?.id),configuration=episode??unit;
    const member=configuration?.members.find(m=>m.symbol===r.symbol);
    const unitBudget=configuration?configuration.maxWeight*member.weight:1;
    const capacity=sizeOrderCapacity(s,r.symbol,r.p);
    const distance=Math.max(r.atr*2,r.p*.04);
    const stop = round(r.p + (short?distance:-distance)),
      qty = Math.max(
        1,
        Math.floor(
          Math.min(
            (equity(s) * Math.min(short?.08:.15,unitBudget,capacity.maxWeight) * (s.policy?.riskScale ?? 1)) / (r.p*(1+SLIP)*(1+FEE)),
            (equity(s) * (short?.004:.008) * (s.policy?.riskScale ?? 1)) / Math.abs(r.p - stop),
            capacity.maxQty,
          ),
        ),
      );
    const adjustedQty=st?Math.max(1,Math.floor(qty*(s.strategyLearning?.[st.id]?.scale??1))):qty;
    const p = {
      id: `P${s.nextId++}`,
      symbol: r.symbol,
      ...(unit?{unitId:unit.id,unitName:unit.name,ideaId:unit.ideaId}:{}),
      date: s.date,
      qty:adjustedQty,
      stop,
      target: round(r.p + (r.p - stop) * 2),
      reference: r.p,
      side: short ? "short" : "buy",
      strategy: st?.id || "미검증",
      status: "대기",
      reason: st
        ? (short?"국가별 하락 국면·가격 하락 추세 헤지. 검증 기업과 가정 대차 모델 사용":"국가별 국면·바스켓 전략 검증·진입 조건 확인. 위험 점검 후 승인 가능")
        : "검증 전략의 진입 신호 없음: 기술 점수 가산 없이 선정 순위에 반영. 위험 점검 후 승인 가능",
      selection:{rank:i+1,...selection},
      managementReview:{status:'proposed',candidateDepartments:r.candidateDepartments,disagreements:r.disagreements,...(r.quant?{quant:{ideaId:r.ideaId,rank:r.quant.rank,score:r.quant.style.score,selectionReason:r.quant.selectionReason,asOf:s.analysis.quantResearch.find(q=>q.ideaId===r.ideaId)?.asOf}}:{}),reason:`${r.candidateDepartments.map(d=>departmentNames[d]).join('·')} 제안 검토. ${r.disagreements.length?'반대 의견을 기록하고 사업·재무·계량·전략 조건으로 판단.':'사업·재무·계량·전략 조건으로 판단.'}`,asOf:s.date},
    };
    if(st?.symbols)p.managementReview.strategyValidation={id:st.id,unitId:unit.id,symbols:[...st.symbols],split:st.split,trainTrades:st.trainTrades,trainRet:st.trainRet,trades:st.trades,ret:st.ret,dd:st.dd,minTrainTrades:st.minTrainTrades,minTestTrades:st.minTestTrades};
    const fit=fitRiskQty(s,p,r.p,now,reserved);
    p.riskReview={status:fit.pass?'pending':'held',checks:fit.checks,asOf:s.date};
    if(!fit.pass){p.status='보류';p.reason='계좌 하드 한도 소진: 1주도 한도 안에 들어가지 않음';}
    else if(fit.qty<p.qty){p.reason+=` · 리스크관리부 수량 조정 ${p.qty}→${fit.qty}주`;p.qty=fit.qty;}
    if(p.status==='대기')reserved.push(p);
    r.managementStatus=p.status==='대기'?'편입안':'보류';r.managementReason=p.reason;
    s.plans.push(p);
  });
  s.events.unshift({
    date: s.date,
    text: `아이디어 후보 검증 · ${s.analysis.reports.filter(x=>x.candidateDepartments.length).length}개 후보 통합 · 퀀트·기술·리스크 선정 순위 ${candidates.length}개`,
  });
  return s;
}
// Refresh evidence on reads without generating or altering orders.
export function refreshQuantAnalysis(s,now=Date.now()){
 s.analysis.quantResearch=quantScreening(s,s.analysis.reports,now);
 for(const r of s.analysis.reports){
  r.quant=s.analysis.quantResearch.find(q=>q.ideaId===r.ideaId)?.candidates.find(c=>c.symbol===r.symbol)??null;
 }
 s.analysis.portfolioUnitRisk=portfolioUnitRisk(s,(state,symbol)=>state.data[symbol]?krwBars(state,symbol):[]);
 s.analysis.unitPerformance=unitPerformance(s);
 return s.analysis;
}
export function createState() {
  const s = {
    version: 2,
    date: "2026-10-02",
    data: dataset(),
    cash: INITIAL,
    holdings: [],
    plans: [],
    trades: [],
    events: [],
    history: [{ date: "2026-10-02", equity: INITIAL, benchmark: INITIAL }],
    nextId: 1,
    day: 0,
    analysis: null,
  };
  return analyze(s);
}
export function approve(s, id, now=Date.now()) {
  const p = s.plans.find((p) => p.id === id);
  if (!p || !["대기", "보류"].includes(p.status))
    throw Error("승인할 수 없는 계획입니다.");
  if (p.date !== s.date)
    throw Error("분석 시점이 지났습니다. 새 분석으로 계획을 갱신하세요.");
  if (isEntry(p)) {
    if(!entryEligible(s,p.symbol,p.ideaId,now))throw Error('최신 사업 조사·재무 검증이 필요합니다.');
    if(!unitEntryCheck(s,p.symbol,p.side==='short'?'short':'long',p.unitId,now).pass)throw Error('트렌드 유닛 편입 근거가 필요합니다.');
    if(!currentNomination(s,p.symbol,p.ideaId,now))throw Error('부서별 후보 제안이 철회되었습니다.');
    const rr=risk(s,p,undefined,now);
    p.riskReview={status:rr.pass?'approved':'held',checks:rr.checks,asOf:s.date};
    if (!rr.pass)
      throw Error(
        "위험 기준을 통과하지 못했습니다. 비중을 낮춰 새 계획을 만드세요.",
      );
  }
  p.status = "승인";
  if([1,2,3,4].includes(s.executionPolicy?.version))stampDecision(p,now);
  if(p.managementReview)p.managementReview.status='approved';
  s.events.unshift({
    date: s.date,
    text: `${companyBySymbol.get(p.symbol).name} ${sideLabel(p.side)} 계획 승인 · 정규장 체결 가격 대기`,
  });
  return s;
}
function currentNomination(s,symbol,ideaId,now){
  if(s.investmentProcessVersion>=5)return ideaEntryCheck(s,symbol,ideaId,now).pass;
  const c=companyBySymbol.get(symbol),t=technical(krwBars(s,symbol));
  return departmentOpinions(s,c,t,market(s,c.country).regime,technicalOpinionScore(t)).some(x=>x.stance==='allow');
}
export function requestExit(s, symbol) {
  const h = s.holdings.find((x) => x.symbol === symbol);
  if (!h) throw Error("보유 종목이 없습니다.");
  if (
    s.plans.some(
      (p) =>
        p.symbol === symbol &&
        ["sell","cover"].includes(p.side) &&
        ["대기", "승인"].includes(p.status),
    )
  )
    throw Error("이미 청산 계획이 있습니다.");
  s.plans.push({
    id: `P${s.nextId++}`,
    symbol,
    unitId:h.unitId,ideaId:h.ideaId,
    qty: h.qty,
    date: s.date,
    reference: markPrice(s,symbol) * fxOf(symbol, s),
    ...(s.mode==='live'?{signalTimestamp:s.marketData.quotes[symbol].time}:{}),
    stop: h.stop,
    target: h.target,
    side: isShort(h) ? "cover" : "sell",
    strategy: h.strategy,
    status: "대기",
    reason: "사용자 청산 요청",
  });
  return s;
}
function sell(s,h,price,reason,quantity=h.qty,execution={}) {
  const qty=Math.min(h.qty,quantity),ratio=qty/h.qty,short=isShort(h),fill=price*(1+(short?SLIP:-SLIP)),gross=qty*fill,fee=gross*FEE;
  const allocatedCost=h.cost*ratio,borrow=(h.borrowAccrued||0)*ratio;
  const amount=short?gross+fee:gross-fee,pnl=short?allocatedCost-amount-borrow:amount-allocatedCost;
  s.cash+=short?-amount:amount;
  s.trades.unshift({id:`T${s.nextId++}`,symbol:h.symbol,unitId:h.unitId,ideaId:h.ideaId,side:short?'cover':'sell',direction:short?'short':'long',qty,partial:qty<h.qty,price:fill,fee,pnl,borrowFee:borrow,date:execution.sessionDate||s.date,reason,strategy:h.strategy,entryDate:h.date,...execution});
  const u=s.trendUnits?.find(u=>u.id===h.unitId);if(u)u.realizedPnl=(u.realizedPnl||0)+pnl;
  if(qty===h.qty)s.holdings=s.holdings.filter(x=>x!==h);
  else {h.qty-=qty;h.cost-=allocatedCost;if(short)h.borrowAccrued-=borrow;}
  if(u&&!s.holdings.some(x=>x.unitId===u.id)){u.status='closed';u.closedAt=s.date;u.reviewLog.push({date:s.date,reason:'전 구성종목 청산 완료',return:u.realizedPnl/u.capital});for(const p of s.plans.filter(p=>p.unitId===u.id&&isEntry(p)&&['승인','대기','보류'].includes(p.status)))p.status='만료';}
}
export function advance(s, options={}) {
  const prevDate = s.date,
    previousEquity = equity(s);
  s.date = options.date||nextDate(s.date);
  s.day++;
  if(!options.quotes)for (const c of activeCompanies(s)) {
    const a = s.data[c.symbol]; a.push(bar(c, a.length, a.at(-1).close));
  }
  const executionBar=symbol=>options.quotes?{open:options.quotes[symbol].price*fxOf(symbol,s),close:options.quotes[symbol].price*fxOf(symbol,s),high:options.quotes[symbol].price*fxOf(symbol,s),low:options.quotes[symbol].price*fxOf(symbol,s)}:krwBars(s,symbol).at(-1);
  const now=options.now??(options.quotes?Date.now():Date.parse(s.date+'T00:00:00Z'));
  const regular=!!options.quotes&&[1,2,3,4].includes(s.executionPolicy?.version);
  const queueExit=(h,reason)=>{
    const existing=s.plans.filter(p=>p.symbol===h.symbol&&['sell','cover'].includes(p.side)&&['대기','승인','보류'].includes(p.status));
    if(existing.some(p=>p.riskExit&&p.status==='승인'&&p.qty>=h.qty))return;
    for(const p of existing)p.status='취소';
    const p={id:`P${s.nextId++}`,symbol:h.symbol,unitId:h.unitId,ideaId:h.ideaId,side:isShort(h)?'cover':'sell',qty:h.qty,reference:h.entry,stop:h.stop,target:h.target,strategy:h.strategy,date:s.date,status:'승인',reason,riskExit:true,signalTimestamp:options.quotes[h.symbol].time};
    stampDecision(p,now);s.plans.push(p);
  };
  for(const h of s.holdings.filter(isShort)){
    const last=h.borrowLastAt??now,elapsed=Math.max(0,now-last),fee=h.qty*executionBar(h.symbol).open*SHORT_BORROW_RATE*elapsed/(365*86400000);
    s.cash-=fee;h.borrowAccrued=(h.borrowAccrued||0)+fee;h.borrowLastAt=Math.max(now,last);
  }
  // A stale quote cannot manufacture a margin call fill; use the next observed price.
  for(const h of [...s.holdings].filter(isShort)){
    if(regular)break;
    if(exposure(s).availableCash>=0)break;
    if(options.quotes&&options.quotes[h.symbol].time<=(h.lastCheckedQuoteTime??h.signalTimestamp??0))continue;
    sell(s,h,executionBar(h.symbol).open,'증거금 부족: 관측한 가격에서 숏 상환');
  }
  const priorPlanIds=new Set(s.plans.map(p=>p.id));
  // Regular mode stamps lastCheckedQuoteTime before monitorUnits runs; keep each unit's prior quote view.
  for(const h of s.holdings){const u=h.unitId&&s.trendUnits?.find(u=>u.id===h.unitId);if(u)(u.lastQuoteTimes??={})[h.symbol]??=h.lastCheckedQuoteTime??h.signalTimestamp??0;}
  if(!regular)monitorUnits(s,{unrealized,now,quotes:options.quotes,riskOnly:options.riskOnly,researchReviewed:options.researchReviewed});
  for(const p of s.plans.filter(p=>p.status==='승인')){
    if(options.execute===false||(options.executeEntries===false&&isEntry(p))||(options.riskOnly&&!p.riskExit)||(options.countries&&!options.countries.includes(companyBySymbol.get(p.symbol).country)))continue;
    if(!options.quotes&&p.date!==prevDate){p.status='만료';continue;}
    if(options.quotes&&isEntry(p)&&(!entryEligible(s,p.symbol,p.ideaId,now)||!currentNomination(s,p.symbol,p.ideaId,now)||!unitEntryCheck(s,p.symbol,p.side==='short'?'short':'long',p.unitId,now).pass||new Date(s.date)-new Date(p.date)>7*86400000||s.strategyLearning?.[p.strategy]?.scale===0)){p.status='만료';p.reason='후보 철회·최신 조사·재무 조건 미충족 또는 계획 만료';continue;}
    if(!regular&&options.quotes&&options.quotes[p.symbol].time<=(p.signalTimestamp??Infinity))continue;
    const quote=options.sessionDate?{...options.quotes[p.symbol],regularSessions:options.quotes[p.symbol].regularSessions.filter(e=>e.date===options.sessionDate)}:options.quotes?.[p.symbol];
    const event=regular?regularExecution(s,p,quote,now):null;
    if(regular&&!event)continue;
    const b=executionBar(p.symbol),fillBasis=event?event.sessionPrice*fxOf(p.symbol,s):(['buy','cover'].includes(p.side)&&!options.quotes?b.close:b.open);
    if(['sell','cover'].includes(p.side)){
      const h=s.holdings.find(h=>h.symbol===p.symbol);
      if(h&&(isShort(h)?'cover':'sell')===p.side){sell(s,h,fillBasis,p.unitExit||p.riskExit?p.reason:'승인된 청산',p.qty,event||{});p.status='체결';}else p.status='취소';continue;
    }
    const short=p.side==='short',old=s.holdings.find(h=>h.symbol===p.symbol);
    // Approved entries fill at the open whatever the gap from the reference price; only the account hard limits are rechecked.
    const finalRisk=risk(s,p,fillBasis,now);
    p.riskReview={status:!old&&finalRisk.pass?'approved':'held',checks:finalRisk.checks,asOf:s.date};
    if(old||!finalRisk.pass){p.status='보류';p.reason='체결 직전 가용 현금·총/순노출·손실한도 재점검에서 보류';continue;}
    const price=fillBasis*(1+(short?-SLIP:SLIP)),gross=p.qty*price,fee=gross*FEE,cost=gross*(1+(short?-FEE:FEE));
    s.cash+=short?cost:-cost;
    recordUnitEntry(s,p,gross+fee);
    s.holdings.push({symbol:p.symbol,unitId:p.unitId,ideaId:p.ideaId,direction:short?'short':'long',qty:p.qty,entry:price,cost,date:event?.sessionDate||s.date,stop:p.stop,target:p.target,strategy:p.strategy,...(short?{borrowAccrued:0,borrowLastAt:now}:{}),...(options.quotes?{signalTimestamp:event?.executionTime??options.quotes[p.symbol].time,lastCheckedQuoteTime:Math.max(event?.executionTime||0,options.quotes[p.symbol].time)}:{})});
    s.trades.unshift({id:`T${s.nextId++}`,symbol:p.symbol,unitId:p.unitId,ideaId:p.ideaId,side:p.side,direction:short?'short':'long',qty:p.qty,price,fee,pnl:null,date:event?.sessionDate||s.date,reason:event?`정규장 ${event.executionBasis==='regularClose'?'종가':'시가'} 모의 체결`:options.quotes?'자동 위험 심사 후 수집 가격에서 모의 체결':'승인 후 정규장 모의 체결',strategy:p.strategy,...(event||{})});p.status='체결';
  }
  for(const h of [...s.holdings]){
    if(options.quotes&&options.quotes[h.symbol].time<=(h.lastCheckedQuoteTime??h.signalTimestamp??0))continue;
    if(options.quotes)h.lastCheckedQuoteTime=options.quotes[h.symbol].time;
    const b=executionBar(h.symbol),short=isShort(h);
    if(short?b.high>=h.stop:b.low<=h.stop){if(regular)queueExit(h,'사전 승인 손절 · 정규장 청산 대기');else sell(s,h,short?Math.max(b.open,h.stop):Math.min(b.open,h.stop),'사전 승인 손절 · 동시 도달 시 손절 우선');}
    else if(short?b.low<=h.target:b.high>=h.target){if(regular)queueExit(h,'사전 승인 목표가 · 정규장 청산 대기');else sell(s,h,short?Math.min(b.open,h.target):Math.max(b.open,h.target),'사전 승인 목표가 청산');}
  }
  if(regular){
    for(const h of s.holdings.filter(isShort))if(exposure(s).availableCash<0)queueExit(h,'증거금 부족: 다음 정규장 가격에서 숏 상환');
    monitorUnits(s,{unrealized,now,quotes:options.quotes,riskOnly:options.riskOnly,researchReviewed:options.researchReviewed});
    for(const p of s.plans)if(!priorPlanIds.has(p.id)&&p.status==='승인'&&!p.approvedAt)stampDecision(p,now);
  }
  s.insolvent=equity(s)<=0;
  for (const p of s.plans)
    if (!options.quotes&&p.status === "대기" && p.date === prevDate) {
      p.status = "만료";
    }
  const benchReturn = mean(
    activeCompanies(s).map((c) => {
      const a = s.data[c.symbol];
      return options.quotes?(options.quotes[c.symbol].price/(options.previousQuotes?.[c.symbol]?.price||options.quotes[c.symbol].price)-1):a.at(-1).close / a.at(-2).close - 1;
    }),
  );
  s.history.push({
    date: s.date,
    ...(options.quotes?{timestamp:new Date().toISOString()}:{}),
    equity: equity(s),
    benchmark: s.history.at(-1).benchmark * (1 + benchReturn),
  });
  s.events.unshift({
    date: s.date,
    text: `${options.quotes?'실제 가격 갱신':'시뮬레이션 하루 진행'} · 자산 변화 ${round(equity(s) - previousEquity).toLocaleString("ko-KR")}원`,
  });
  // Risk-only monitoring must preserve research evidence and generate no entry proposals.
  if(!options.riskOnly)analyze(s,now);
  return s;
}
export function validateState(s) {
  validateAllocationState(s?.assetAllocation);
  if (
    !s ||
    s.version !== 2 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s.date) ||
    !Number.isFinite(s.cash) ||
    (s.cash < 0 && s.insolvent!==true) ||
    !Number.isInteger(s.day) ||
    s.day < 0 ||
    !Number.isInteger(s.nextId) ||
    s.nextId < 1
  )
    throw Error("계좌 파일 형식이 올바르지 않습니다.");
  for (const k of ["holdings", "plans", "trades", "history", "events"])
    if (!Array.isArray(s[k]) || s[k].length > 100000)
      throw Error("기록 형식이 올바르지 않습니다.");
  const pool = activeCompanies(s);
  if((s.universeVersion === 'expanded36'||s.activeSymbols!==undefined) && s.mode !== 'live') throw Error('확장 종목은 검증한 실제 가격으로만 준비합니다.');
  const symbols = Object.keys(s.data ?? {});
  if(symbols.length !== pool.length || symbols.some(symbol=>!pool.some(c=>c.symbol===symbol))) throw Error('선언한 관찰 종목과 가격 데이터가 일치하지 않습니다.');
  const lengths = pool.map((c) => s.data?.[c.symbol]?.length);
  if (
    lengths.some(
      (n) => !Number.isInteger(n) || n < 260 || n > 10000 || n !== lengths[0],
    )
  )
    throw Error("가격 데이터 길이가 올바르지 않습니다.");
  for (const c of pool)
    for (const b of s.data[c.symbol])
      if (
        !["open", "close", "high", "low", "volume"].every(
          (k) => Number.isFinite(b[k]) && b[k] > 0,
        ) ||
        b.low > Math.min(b.open, b.close) ||
        b.high < Math.max(b.open, b.close)
      )
        throw Error("가격 데이터가 올바르지 않습니다.");
  for (const h of s.holdings)
    if (
      (h.direction!==undefined && !["long","short"].includes(h.direction)) ||
      (isShort(h) && (!Number.isFinite(h.borrowAccrued)||h.borrowAccrued<0||!Number.isFinite(h.borrowLastAt))) ||
      !pool.some((c) => c.symbol === h.symbol) ||
      !Number.isInteger(h.qty) ||
      h.qty <= 0 ||
      !["entry", "cost", "stop", "target"].every(
        (k) => Number.isFinite(h[k]) && h[k] > 0,
      )
    )
      throw Error("보유 내역이 올바르지 않습니다.");
  for (const p of s.plans)
    if (
      !pool.some((c) => c.symbol === p.symbol) ||
      !Number.isInteger(p.qty) ||
      p.qty <= 0 ||
      !["reference", "stop", "target"].every(
        (k) => Number.isFinite(p[k]) && p[k] > 0,
      ) ||
      !["buy", "sell", "short", "cover"].includes(p.side) ||
      !["대기", "승인", "보류", "거절", "체결", "취소", "만료"].includes(
        p.status,
      )
    )
      throw Error("주문 내역이 올바르지 않습니다.");
  for (const t of s.trades)
    if (
      !pool.some((c) => c.symbol === t.symbol) ||
      !["buy", "sell", "short", "cover"].includes(t.side) ||
      !Number.isInteger(t.qty) ||
      t.qty <= 0 ||
      !Number.isFinite(t.price) ||
      t.price <= 0 ||
      !Number.isFinite(t.fee) ||
      t.fee < 0 ||
      (t.pnl !== null && !Number.isFinite(t.pnl))
    )
      throw Error("체결 기록이 올바르지 않습니다.");
  for (const e of s.events)
    if (typeof e.date !== "string" || typeof e.text !== "string")
      throw Error("활동 기록이 올바르지 않습니다.");
  if (!s.history.length || typeof (s.note || "") !== "string")
    throw Error("성과 또는 메모 형식이 올바르지 않습니다.");
  for (const h of s.history)
    if (
      !Number.isFinite(h.equity) ||
      !Number.isFinite(h.benchmark) ||
      (h.equity <= 0 && s.insolvent!==true) ||
      h.benchmark <= 0
    )
      throw Error("성과 기록이 올바르지 않습니다.");
  return s;
}
