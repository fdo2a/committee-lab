import {departmentOpinions,stanceLabel,ideaFor,ideaEntryCheck,businessResearch,departmentNames} from './committee.mjs';
import {companies,technical,krwBars,market} from './engine.mjs';
import {reasonHtml,sourceFold} from './ui-format.mjs';
import {activeCompanies} from './universe.mjs';
import {FUNDAMENTALS_MAX_AGE_DAYS,fundamentalsCurrent} from './fundamentals-freshness.mjs';

// Stocks the committee actually has something to say about: concept candidates, final basket members,
// open plans and current holdings. Any other stock would only show the same "미확인" defaults.
// First unmet entry condition in plain words, mirroring entryEligible; null when nothing blocks entry.
export function entryGap(state,symbol,now=Date.now()){
 if(state.mode!=='live')return null;
 const f=state.fundamentals?.[symbol],r=state.externalResearch;
 if(!f)return '재무 숫자 미수집';
 if(state.investmentProcessVersion>=5){
  const checks=(f.checks??[]).filter(x=>x.name!=='최신 바텀업 사업·공시 검토'),failed=checks.filter(x=>!x.pass).map(x=>x.name);
  if((f.numericPass??(checks.length>0&&!failed.length))!==true)return `재무 기준 미달: ${failed.join(', ')||'수치 검증 미통과'}`;
  if(!fundamentalsCurrent(f,now))return `재무 수집 후 ${FUNDAMENTALS_MAX_AGE_DAYS}일이 지남`;
  const unit=r?.trendUnits?.find(u=>u.action==='hold'&&u.members.some(m=>m.symbol===symbol));
  const ideaId=unit?.ideaId??r?.investmentIdeas?.find(i=>i.action==='review'&&i.candidates.some(c=>c.symbol===symbol))?.id;
  if(!ideaId)return '이 종목을 후보로 올린 컨셉이 없음';
  return ideaEntryCheck(state,symbol,ideaId,now).gap;
 }
 if(r?.fresh===false)return '외부 조사가 오래됨';
 if(f.pass!==true)return `재무 기준 미달: ${(f.checks??[]).filter(x=>!x.pass).map(x=>x.name).join(', ')}`;
 const b=businessResearch(state,symbol);
 if(!b)return '사업 조사 없음';
 if(b.businessPass!==true)return '펀더멘탈부 사업 검증 미통과';
 if(!(b.sourceUrls.length>0||b.fundamentalPass===true))return '사업 조사 근거 출처 없음';
 return null;
}

export function reviewSymbols(state){
 const r=state.externalResearch,wanted=new Set([
  ...(r?.investmentIdeas??[]).filter(i=>i.action==='review').flatMap(i=>i.candidates.map(c=>c.symbol)),
  ...(r?.trendUnits??[]).filter(u=>u.action==='hold').flatMap(u=>u.members.map(m=>m.symbol)),
  ...(r?.screening??[]).filter(x=>x.stance==='allow').map(x=>x.symbol),
  ...(state.plans??[]).filter(p=>['대기','승인'].includes(p.status)).map(p=>p.symbol),
  ...(state.holdings??[]).filter(h=>h.qty>0).map(h=>h.symbol)]);
 return activeCompanies(state).filter(c=>wanted.has(c.symbol)).map(c=>c.symbol);
}

export function opinionsFor(state, symbol) {
  const c=companies.find(x=>x.symbol===symbol),r=state.analysis?.reports?.find(x=>x.symbol===symbol);
  const unit=state.externalResearch?.trendUnits?.find(u=>u.action==='hold'&&u.members.some(m=>m.symbol===symbol)),idea=ideaFor(state,unit?.ideaId)??state.externalResearch?.investmentIdeas?.find(i=>i.action==='review'&&i.candidates.some(c=>c.symbol===symbol));
  return (state.investmentProcessVersion<5||!state.investmentProcessVersion?r?.opinions:null) || departmentOpinions(state,c,technical(krwBars(state,symbol)),market(state,c.country).regime,r?.technicalScore??50,idea?.id);
}
export const nominationsFor = (state,report) => state.investmentProcessVersion>=5?[...new Set((state.externalResearch?.investmentIdeas??[]).filter(i=>i.action==='review'&&i.candidates.some(c=>c.symbol===report.symbol)).flatMap(i=>i.sourceDepartments))]:(report.candidateDepartments??opinionsFor(state,report.symbol).filter(x=>x.stance==='allow').map(x=>x.department));

export function committeeReviewPanel(state, symbol, {esc,badge}) {
  const opinions=opinionsFor(state,symbol),r=state.analysis?.reports?.find(x=>x.symbol===symbol);
  const plan=state.plans.filter(x=>x.symbol===symbol).at(-1);
  const rows=opinions.map(o=>`<tr><td><b>${esc(o.name)}</b><small class="table-sub">${o.origin==='calculated'?'가격·국면 규칙 계산':o.origin==='legacy'?'과거 검토 · 원본 컨셉 미연결':o.origin==='missing'?'조사 대기':'부서별 외부 조사'}</small></td><td>${badge(stanceLabel(o.initialStance))}${o.initialStance!==o.stance?` → ${badge(stanceLabel(o.stance))}`:''}</td><td>${reasonHtml(o.reason,esc)}${o.revisionReason?`<small class="table-sub">수정 이유: ${esc(o.revisionReason)}</small>`:''}<div class="fold-row">${o.risks?`<details class="source-fold"><summary>위험·반대 근거</summary>${reasonHtml(o.risks,esc,99)}</details>`:''}${sourceFold(o.sourceUrls,esc)}</div></td></tr>`).join('');
  const legacy=state.investmentProcessVersion>=5&&plan&&['buy','short'].includes(plan.side)&&(!plan.ideaId||!ideaFor(state,plan.ideaId));
  const risk=legacy?null:plan?.riskReview;
  const status=r?.managementStatus,failedRisk=risk?.checks.filter(x=>!x[1]).map(x=>x[0]).join(', ');
  const managementLine=status==='검토'?`검토 내용: ${(r.candidateDepartments??[]).map(d=>departmentNames[d]??d).join('·')} 제안과 반대 근거를 전략·비중 조건과 함께 검토`:
   status==='편입안'?`편입안 이유: ${plan?.reason||r.managementReason||'전략·비중 조건 확인'}${plan?.strategy?` · 전략 ${plan.strategy}`:''}`:
   status==='보유'?'보유 이유: 이미 보유한 종목으로 중복 진입 보류':
   status==='보류'?`보류 이유: ${entryGap(state,symbol)??'전략·비중 조건 미충족'}`:status==='관찰'?'관찰 이유: 이 종목을 후보로 제안한 부서가 없음':'다음 자동 실행에서 검토';
  const riskLine=legacy?'과거 심사 · 새 후보 검증 후 재검토':!plan?'편입안 대기: 운용부가 아직 편입안을 내지 않음':!risk?'심사 대기: 진입 계획이 아니어서 편입 위험 심사 대상 아님':
   risk.status==='approved'?`승인 이유: ${failedRisk?`조건부 통과 (${failedRisk})`:'현금·노출·손실 한도 모두 통과'}`:risk.status==='held'?`보류 이유: ${failedRisk||'위험 기준 미충족'}`:'심사 대기: 승인 전 위험 심사 진행 중';
  const readiness=state.analysis?.researchReadiness,stage=key=>({complete:"완료",pending:"검토 대기",watch:"관찰"}[readiness?.stages?.[key]]||"재검토 대기");
  return `<section class="panel spaced"><div class="panel-heading"><h2>후보 검증·편입 심사</h2></div><p class="muted">컨셉 발굴 ${stage("ideas")} → 기업 검토 ${stage("fundamental")} · 기술 검토 ${stage("technical")} · 퀀트 ${r?.quant?.ready?"계산 완료":"자료 대기"} → 운용 선정 ${stage("management")} → 리스크 심사 → 투자 실행</p><div class="table-scroll"><table class="opinion-table"><thead><tr><th>조사 부서</th><th>검토 의견</th><th>근거와 출처</th></tr></thead><tbody>${rows}</tbody></table></div><div class="two-columns spaced"><article><h3>운용부 ${badge(r?.managementStatus||'다음 실행에서 검토')}</h3><p class="verdict-line">${esc(managementLine)}</p>${legacy?'<p class="muted">과거 운용 판단 · 새 후보 검증 후 재심사</p>':''}<p>${esc(plan?.managementReview?.reason||r?.managementReason||'조사 대기')}</p>${plan?`<p>${esc(plan.reason)}</p>`:''}</article><article><h3>리스크관리부 ${badge(legacy?'과거 심사 · 재검토 대기':risk?({approved:'승인',held:'보류',pending:'심사 대기'}[risk.status]):'편입안 대기')}</h3><p class="verdict-line">${esc(riskLine)}</p></article></div></section>`;
}
