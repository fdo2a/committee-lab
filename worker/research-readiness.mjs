import {companies,activeCompanies} from '../web/engine.mjs';
import {businessResearch,researchDepartments} from '../web/committee.mjs';
import {macroFactors,memberCountries} from '../web/trend-units.mjs';
import {manualGaps} from './manual-candidates.mjs';

const country=symbol=>companies.find(c=>c.symbol===symbol)?.country;
const current=(date,observedAt)=>{const age=Date.parse(date+'T23:59:59Z')-Date.parse(observedAt);return Number.isFinite(age)&&age>=-86400000&&age<=120*86400000;};
// Also usable on rejected input: identify department gaps without echoing submitted text or URLs.
export function departmentReadiness(research,required=companies){
 const registered=new Set((Array.isArray(research?.sources)?research.sources:[]).map(s=>s?.url).filter(u=>typeof u==='string'));
 const missing=[];
 for(const department of researchDepartments){
  const rows=Array.isArray(research?.departmentResearch?.[department])?research.departmentResearch[department]:[];
  for(const c of required){
   const matches=rows.filter(r=>r?.symbol===c.symbol),reasons=[];
   if(matches.length!==1)reasons.push(`각 부서가 전체 ${required.length}개 종목을 중복 없이 독립 검토해야 합니다`);
   else{
    const row=matches[0];
    if(typeof row.reason!=='string'||!row.reason.trim())reasons.push('부서별 실제 판단 근거 필요');
    if(!Array.isArray(row.sourceUrls)||!row.sourceUrls.length||row.sourceUrls.some(u=>!registered.has(u)))reasons.push('전체 출처 목록에 등록된 원문 출처 1개 이상 필요');
   }
   if(reasons.length)missing.push({region:c.country,kind:'department',field:department+'.'+c.symbol,reason:reasons.join(' · ')});
  }
  if(rows.some(row=>!companies.some(c=>c.symbol===row?.symbol)))missing.push({region:null,kind:'department',field:department+'.symbols',reason:`관찰 대상 ${companies.length}개 종목의 등록된 기호만 사용해야 합니다`});
 }
 return missing;
}
// Receives sanitized research. Preparation completeness does not replace investment risk gates.
export function researchReadiness(state,research,now=Date.now()){
 if(state.investmentProcessVersion>=5||research?.investmentIdeas?.length)return ideaReadiness(state,research,now);
 const date=new Date(now+9*3600000).toISOString().slice(0,10),missing=[];
 const add=(region,kind,field,reason)=>missing.push({region,kind,field,reason});
 if(!research)return {complete:false,missing:[{region:null,kind:'research',field:'research',reason:'출처가 있는 최신 부서별 조사 자료 필요'}],regions:[]};
 missing.push(...departmentReadiness(research,activeCompanies(state)));
 if(!research.sources.length)add(null,'research','sources','원문 출처를 확인한 조사 자료 필요');
 const stamp=Date.parse(research.asOf);
 if(!Number.isFinite(stamp)||Math.abs(now-stamp)>=36*3600000)add(null,'research','asOf','36시간 이내 조사 시점 필요');
 const proposals=research.trendUnits.filter(u=>u.action!=='exit');
 const view={...state,externalResearch:research};
 const nominated=activeCompanies(state).filter(c=>{
  const business=businessResearch(view,c.symbol);
  const nomination=researchDepartments.some(d=>research.departmentResearch[d]?.some(x=>x.symbol===c.symbol&&(x.revisedStance||x.stance)==='allow'&&x.sourceUrls.length))||research.screening.some(x=>x.symbol===c.symbol&&x.stance==='allow'&&x.sourceUrls.length);
  return nomination&&business?.businessPass===true&&business.sourceUrls.length;
 });
 // A proposal is an explicit allocation decision; researched candidates outside it can stay on watch.
 const required=[...new Set(proposals.length?proposals.flatMap(u=>u.members.map(m=>country(m.symbol))):nominated.map(c=>c.country))].sort();
 for(const region of required){
  for(const factor of macroFactors){
   const row=research.macroScorecard.find(r=>r.region===region&&r.factor===factor);
   if(!row)add(region,'macro',factor,'지역별 관측일·해석·출처 필요');
   else if(row.signal==='unknown')add(region,'macro',factor,'확인된 지표 해석 필요');
   else if(!current(date,row.observedAt))add(region,'macro',factor,'120일 이내의 실제 관측일 필요');
   else if(!row.sourceUrls.length||!row.reason.trim())add(region,'macro',factor,'관측 해석과 원문 출처 필요');
  }
  if(!proposals.some(u=>u.members.some(m=>country(m.symbol)===region)))add(region,'basket','trendUnits','2~20개 종목과 출처 있는 참조지수를 갖춘 투자 바스켓 필요');
 }
 for(const u of proposals){
  const regions=[...new Set(u.members.map(m=>country(m.symbol)))];
  for(const region of regions){
   if(!current(date,u.referenceIndex.asOf))add(region,'referenceIndex','asOf','120일 이내 구성종목 확인 시점 필요');
   if(!u.referenceIndex.name.trim())add(region,'referenceIndex','name','실제 확인한 참조지수 이름 필요');
   for(const field of ['thesis','catalyst','invalidation','allocationReason','riskBasis'])if(!u[field].trim())add(region,'basket',field,'유닛별 투자 판단 근거 필요');
   if(u.members.some(m=>!m.reason.trim()))add(region,'basket','members.reason','구성종목별 편입 이유 필요');
   if(u.regime==='unknown')add(region,'basket','regime','확인된 시장 국면 필요');
   if(u.regime==='longBear'&&u.riskProfile!=='defensive')add(region,'basket','riskProfile','장기 약세의 위험선호 유닛은 신규 편입 금지');
  }
 }
 const regions=required.map(region=>{const gaps=missing.filter(m=>m.region===region);return {region,complete:!gaps.length,missing:gaps,observations:macroFactors.filter(f=>!gaps.some(m=>m.kind==='macro'&&m.field===f)).length};});
 return {complete:!missing.length,missing,regions};
}

function ideaReadiness(state,research,now){
 const missing=[],date=new Date(now+9*3600000).toISOString().slice(0,10),active=new Set(activeCompanies(state).map(c=>c.symbol));
 const add=(stage,ideaId,region,kind,field,reason,symbol)=>missing.push({stage,ideaId,region,kind,field,reason,...(symbol?{symbol}:{})});
 const recent=stamp=>Number.isFinite(Date.parse(stamp))&&Math.abs(now-Date.parse(stamp))<36*3600000;
 if(!research)return {complete:false,missing:[{stage:'ideas',region:null,kind:'research',field:'research',reason:'출처 있는 투자 컨셉 조사 필요'}],regions:[],stages:{ideas:'pending',fundamental:'pending',technical:'pending',management:'pending'}};
 const ideas=research.investmentIdeas??[],proposals=research.trendUnits.filter(u=>u.action!=='exit');
 if(!research.sources.length||!recent(research.asOf))add('ideas',null,null,'research','asOf','등록 출처와 36시간 이내 조사 필요');
 for(const key of ['topDown','marketReview','decision'])if(!research[key]?.trim())add('ideas',null,null,'research',key,'산업·시장·운용 판단 필요');
 if(!ideas.length&&(proposals.length||[...(research.screening??[]),...Object.values(research.departmentResearch).flat()].some(r=>(r.revisedStance??r.stance)==='allow')))add('ideas',null,null,'idea','investmentIdeas','최종 바스켓의 원본 컨셉 필요');
 const regionsRequired=new Set();
 for(const idea of ideas){
  if(idea.action==='withdraw')continue;
  // region is a label; macro is required for every country the candidates actually come from.
  const region=idea.region;for(const c of memberCountries(idea.candidates))regionsRequired.add(c);
  if(!recent(idea.asOf))add('ideas',idea.id,region,'idea','asOf','36시간 이내 컨셉 조사 필요');
  for(const field of ['name','thesis','catalyst','whatToWatch','invalidation'])if(!idea[field]?.trim())add('ideas',idea.id,region,'idea',field,'실제 컨셉 판단 근거 필요');
  if(!current(date,idea.referenceIndex.asOf))add('ideas',idea.id,region,'referenceIndex','asOf','120일 이내 컨셉 구성 확인 필요');
  if(!idea.referenceIndex.name.trim())add('ideas',idea.id,region,'referenceIndex','name','실제 참조지수 이름 필요');
  for(const c of idea.candidates){
   if(!country(c.symbol)||!c.reason.trim())add('ideas',idea.id,region,'idea','candidates','등록 종목·컨셉 연결 이유 확인 필요',c.symbol);
   for(const department of ['fundamental','technical']){
    const rows=research.departmentResearch[department]?.filter(r=>r.ideaId===idea.id&&r.symbol===c.symbol)??[];
    if(rows.length!==1||!rows[0].reason.trim()||!rows[0].sourceUrls.length)add(department,idea.id,region,'department',department+'.'+c.symbol,'해당 컨셉 후보의 원문 검토 필요',c.symbol);
   }
  }
  if(!proposals.some(u=>u.ideaId===idea.id)&&!(idea.managementReview?.status==='watch'&&idea.managementReview.reason.trim()&&idea.managementReview.sourceUrls.length))add('management',idea.id,region,'basket','trendUnits','컨셉을 검토한 최종 바스켓 또는 보류·관찰 결정 필요');
 }
 for(const department of ['fundamental','technical'])for(const r of research.departmentResearch[department]??[]){
  if(r.ideaId&&!ideas.some(i=>i.id===r.ideaId&&i.candidates.some(c=>c.symbol===r.symbol)))add(department,r.ideaId,country(r.symbol),'department',department+'.'+r.symbol,'원본 컨셉 후보와 검토 행 연결 필요',r.symbol);
 }
 for(const u of proposals){
  const idea=ideas.find(i=>i.id===u.ideaId);
  if(!idea||idea.action!=='review'){add('management',u.ideaId??null,u.region,'basket','ideaId','유효한 원본 컨셉 필요');continue;}
  const candidates=new Set(idea.candidates.map(c=>c.symbol)),selected=new Set(u.members.map(m=>m.symbol)),reserves=u.reserves??[],excluded=u.excluded??[];
  if([...selected,...reserves,...excluded.map(x=>x.symbol)].some(s=>!candidates.has(s)))add('management',idea.id,u.region,'basket','members','최종·예비·제외 종목은 컨셉 후보에서 선택');
  for(const m of u.members){
   if(!active.has(m.symbol))add('technical',idea.id,u.region,'department','prices','최종 편입 종목의 실제 가격 수집 필요',m.symbol);
   const b=businessResearch({externalResearch:research},m.symbol,idea.id);
   if(b?.businessPass!==true)add('fundamental',idea.id,u.region,'department','businessPass','최종 종목의 사업 검증 통과 필요',m.symbol);
  }
  if(!current(date,u.referenceIndex.asOf))add('management',idea.id,u.region,'referenceIndex','asOf','120일 이내 최종 구성 확인 필요');
  for(const field of ['thesis','catalyst','invalidation','allocationReason','riskBasis'])if(!u[field].trim())add('management',idea.id,u.region,'basket',field,'최종 편입 판단 근거 필요');
  if(u.members.some(m=>!m.reason.trim())||excluded.some(x=>!x.reason.trim()))add('management',idea.id,u.region,'basket','members.reason','선정·제외 이유 필요');
  if(u.regime==='unknown'||(u.regime==='longBear'&&u.riskProfile!=='defensive'))add('management',idea.id,u.region,'basket','regime','확인된 국면과 장기 약세의 방어형 판단 필요');
 }
 for(const region of regionsRequired)for(const factor of macroFactors){
  const r=research.macroScorecard.find(r=>r.region===region&&r.factor===factor);
  if(!r||r.signal==='unknown'||!current(date,r.observedAt)||!r.reason.trim()||!r.sourceUrls.length)add('ideas',null,region,'macro',factor,'120일 이내 실제 관측·해석·출처 필요');
 }
 missing.push(...manualGaps(state,research));
 const stages=Object.fromEntries(['ideas','fundamental','technical','management'].map(stage=>[stage,missing.some(m=>m.stage===stage)?'pending':ideas.some(i=>i.action==='review')?'complete':'watch']));
 const regions=[...regionsRequired].sort().map(region=>({region,complete:!missing.some(m=>m.region===region),missing:missing.filter(m=>m.region===region),observations:macroFactors.filter(f=>!missing.some(m=>m.region===region&&m.kind==='macro'&&m.field===f)).length}));
 const readyUnitIds=proposals.filter(u=>ideas.some(i=>i.id===u.ideaId&&i.action==='review')&&!missing.some(m=>m.ideaId===u.ideaId&&(!m.symbol||m.stage==='ideas'||u.members.some(c=>c.symbol===m.symbol))||(m.ideaId===null&&(m.kind==='research'||m.kind==='idea'||m.kind==='macro'&&memberCountries(u.members).includes(m.region))))).map(u=>u.id);
 const coverage=ideas.filter(i=>i.action==='review').map(i=>{
  const reviewed=c=>['fundamental','technical'].every(d=>research.departmentResearch[d]?.some(r=>r.ideaId===i.id&&r.symbol===c.symbol&&r.reason.trim()&&r.sourceUrls.length));
  return {ideaId:i.id,candidateCount:i.candidates.length,reviewedCount:i.candidates.filter(reviewed).length,pricedCount:i.candidates.filter(c=>active.has(c.symbol)).length,pendingSymbols:i.candidates.filter(c=>!reviewed(c)).map(c=>c.symbol),selectedCount:proposals.filter(u=>u.ideaId===i.id).reduce((n,u)=>n+u.members.length,0)};
 });
 return {complete:!missing.length,missing,regions,stages,readyUnitIds,coverage};
}
