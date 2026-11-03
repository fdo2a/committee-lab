import {companies,activeCompanies} from './universe.mjs';
import {fundamentalsCurrent} from './fundamentals-freshness.mjs';
export const researchDepartments = ['screening', 'technical', 'fundamental', 'market'];
export const departmentNames = {screening:'산업·테마분석부',technical:'기술적 분석부',fundamental:'펀더멘탈부',market:'마켓부'};
export const stanceLabel = stance => ({allow:'후보 제안',watch:'관찰',avoid:'반대'}[stance] || '미확인');
export const technicalOpinionScore = t => Math.max(0,Math.min(100,Math.round(50+t.momentum*350+(t.p>t.ma60?15:-15))));

export const ideaFor=(s,ideaId)=>s.externalResearch?.investmentIdeas?.find(i=>i.id===ideaId);
export function businessResearch(s, symbol, ideaId) {
  if(ideaId!==undefined)return s.externalResearch?.departmentResearch?.fundamental?.find(x=>x.symbol===symbol&&x.ideaId===ideaId)??null;
  const independent=s.externalResearch?.departmentResearch?.fundamental?.find(x=>x.symbol===symbol);
  if(independent)return independent;
  const legacy=s.externalResearch?.screening?.find(x=>x.symbol===symbol);
  return legacy ? {businessPass:legacy.bottomUpPass===true || (legacy.bottomUpPass===undefined&&legacy.fundamentalPass===true),
    reason:legacy.bottomUpReason,sourceUrls:legacy.sourceUrls||[],fundamentalPass:legacy.fundamentalPass} : null;
}
export function ideaEntryCheck(s,symbol,ideaId,now=Date.now()) {
  const idea=ideaFor(s,ideaId),rows=s.externalResearch?.departmentResearch;
  const review=(department,symbol)=>rows?.[department]?.find(x=>x.ideaId===ideaId&&x.symbol===symbol);
  const fundamental=review('fundamental',symbol),technical=review('technical',symbol);
  const unit=s.externalResearch?.trendUnits?.find(u=>u.ideaId===ideaId&&u.action==='hold'&&u.members.some(m=>m.symbol===symbol));
  const fresh=stamp=>Number.isFinite(Date.parse(stamp))&&Math.abs(now-Date.parse(stamp))<36*3600000;
  const sourced=r=>!!r?.reason?.trim()&&!!r.sourceUrls?.length;
  const candidateSymbols=idea?.candidates?.map(c=>c.symbol)??[];
  // Gates run in order and stop at the first failure, so later gates may assume idea and unit exist.
  // gap names that first failure in plain words for the committee page.
  const gates=[
    ['원본 컨셉이 후보 검증 상태가 아님',()=>!!idea&&idea.action==='review'],
    ['조사 시점이 36시간을 넘음',()=>fresh(idea.asOf)&&fresh(s.externalResearch.asOf)&&s.externalResearch.fresh!==false],
    ['컨셉 설명 항목 누락',()=>['name','thesis','catalyst','whatToWatch','invalidation'].every(k=>idea[k]?.trim())],
    ['탑다운·시장·판단 요약 누락',()=>['topDown','marketReview','decision'].every(k=>s.externalResearch[k]?.trim())],
    // This stock's own reviews come before basket-wide gates so its own gap is the one named.
    ['펀더멘탈부 사업 검증 미통과',()=>fundamental?.businessPass===true],
    ['기업·기술 검토의 근거 출처 누락',()=>sourced(fundamental)&&sourced(technical)],
    ['운용부 최종 바스켓에 포함되지 않음',()=>!!unit&&candidateSymbols.includes(symbol)],
    // Candidates and constituents may span countries; cleanResearch already limits them to registered symbols.
    ['원본 후보의 선정 사유 오류',()=>idea.candidates.every(c=>c.reason.trim()&&companies.some(a=>a.symbol===c.symbol))],
    ['같은 바스켓 종목의 기업·기술 검토 미완료',()=>unit.members.every(m=>activeCompanies(s).some(a=>a.symbol===m.symbol)&&review('fundamental',m.symbol)?.businessPass===true&&sourced(review('fundamental',m.symbol))&&sourced(review('technical',m.symbol)))],
    ['바스켓 제외 사유 누락',()=>(unit.excluded??[]).every(x=>x.reason.trim())],
    ['바스켓 종목이 원본 후보 밖에 있음',()=>[...unit.members.map(m=>m.symbol),...unit.reserves,...(unit.excluded??[]).map(x=>x.symbol)].every(x=>candidateSymbols.includes(x))],
  ];
  const gap=gates.find(([,ok])=>!ok())?.[0]??null,pass=gap===null;
  return {pass,gap,reason:pass?'컨셉·기업·기술 검토와 운용 선정 확인':'컨셉·기업·기술 검토 또는 운용 선정 미충족',idea,fundamental,technical};
}
export function entryEligible(s, symbol, ideaId, now=Date.now()) {
  if(s.mode!=='live')return true;
  if(s.investmentProcessVersion>=5){
    const f=s.fundamentals?.[symbol],checks=(f?.checks??[]).filter(x=>x.name!=='최신 바텀업 사업·공시 검토');
    const numeric=f?.numericPass??(checks.length>0&&checks.every(x=>x.pass));
    return numeric===true&&fundamentalsCurrent(f,now)&&ideaEntryCheck(s,symbol,ideaId,now).pass;
  }
  const b=businessResearch(s,symbol);
  return s.externalResearch?.fresh!==false && s.fundamentals?.[symbol]?.pass===true &&
    !!b && b.businessPass===true && (b.sourceUrls.length>0 || b.fundamentalPass===true);
}
export function departmentOpinions(s, c, t, regime, technicalScore,ideaId) {
  const legacy=s.externalResearch?.screening?.find(x=>x.symbol===c.symbol);
  const demo=s.mode!=='live';
  const technicalCandidate=(regime==='하락'&&t.trend==='하락') || (regime!=='하락'&&t.trend==='상승');
  const fallback={
    screening:{stance:legacy?.stance ?? (demo&&c.growth>0?'allow':'watch'),score:legacy?.topDownScore ?? null,reason:legacy?.topDownReason||legacy?.reason||'외부 산업 조사 미확인',sourceUrls:legacy?.sourceUrls||[],origin:legacy?'legacy':'missing'},
    fundamental:{stance:legacy?(legacy.bottomUpPass||legacy.fundamentalPass?'allow':'watch'):(demo&&c.growth>0?'allow':'watch'),score:legacy?.bottomUpScore??null,reason:legacy?.bottomUpReason||'사업·공시 조사 미확인',sourceUrls:legacy?.sourceUrls||[],origin:legacy?'legacy':'missing'},
    technical:{stance:technicalCandidate?'allow':'watch',score:regime==='하락'?100-technicalScore:technicalScore,reason:`${t.trend} 추세 · 20일 모멘텀 ${(t.momentum*100).toFixed(2)}% · ${regime} 국면의 전략 진입 검토`,sourceUrls:[],origin:'calculated'},
    market:{stance:'watch',score:null,reason:`${c.country} ${regime} 국면 · 종목별 외부 거시 근거는 별도 확인`,sourceUrls:[],origin:'calculated'},
  };
  return researchDepartments.map(department=>{
    const idea=ideaFor(s,ideaId);
    const submitted=s.externalResearch?.departmentResearch?.[department]?.find(x=>x.symbol===c.symbol&&(s.investmentProcessVersion<5||!s.investmentProcessVersion||x.ideaId===ideaId));
    const concept=s.investmentProcessVersion>=5&&idea&&['screening','market'].includes(department)?{stance:idea.sourceDepartments.includes(department)&&idea.action==='review'?'allow':'watch',score:null,reason:idea.thesis,sourceUrls:idea.sourceUrls,risks:idea.opposingViews.filter(v=>v.department===department).map(v=>v.reason).join(' · '),origin:'external'}:null;
    const opinion=concept??(submitted?{...submitted,origin:s.investmentProcessVersion>=5&&!idea?'legacy':'external'}:fallback[department]);
    let stance=opinion.revisedStance || opinion.stance;
    if(s.externalResearch?.fresh===false || (submitted&&!opinion.sourceUrls.length))stance='watch';
    return {...opinion,department,name:departmentNames[department],initialStance:opinion.stance,stance};
  });
}
