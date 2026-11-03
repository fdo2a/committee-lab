import {strategies,researchForUnit} from '../web/engine.mjs';
import {quantMethod} from '../web/quant-research.mjs';
export function learningReview(s,now=Date.now()){
 const old=s.strategyLearning||{},learning={};
 for(const st of strategies){
  const exits=s.trades.filter(t=>['sell','cover'].includes(t.side)&&t.strategy===st.id);
  const grouped=new Map();
  for(const t of exits){if(t.unitId&&s.trendUnits?.find(u=>u.id===t.unitId)?.status!=='closed')continue;const key=t.unitId||t.id||t;const prior=grouped.get(key);if(prior)prior.pnl+=t.pnl;else grouped.set(key,{...t});}
  const closed=[...grouped.values()].slice(0,20);
  const n=closed.length,pnl=closed.reduce((a,t)=>a+t.pnl,0),wins=closed.filter(t=>t.pnl>0).length;
  const disabled=n>=3&&closed.slice(0,3).every(t=>t.pnl<0);
  const scale=disabled?0:n>=5&&pnl<0?0.5:1;
  learning[st.id]={closed:n,wins,netPnl:pnl,scale,reason:disabled?'최근 해당 전략 3회 연속 손실: 신규 진입 중단':scale<1?'5회 이상 실현 손실: 신규 규모 절반':'관측 결과 유지',reviewedAt:new Date(now).toISOString()};
  if(old[st.id]?.scale!==undefined&&old[st.id].scale!==scale)s.events.unshift({date:s.date,text:`${st.id} 복기: ${learning[st.id].reason}`});
 }
 s.strategyLearning=learning;
 return {evaluated:Object.values(learning).filter(x=>x.closed>0).length,disabled:Object.entries(learning).filter(([_,x])=>x.scale===0).map(([k])=>k),reduced:Object.entries(learning).filter(([_,x])=>x.scale===0.5).map(([k])=>k),limitations:'청산 결과에 따른 제한적 운용 규칙 조정. 시장 변화의 원인이나 미래 수익을 학습했다고 해석하지 않습니다.'};
}
export function departmentReviews(s,summary,now=Date.now()){
 const r=s.externalResearch,ideas=(r?.investmentIdeas??[]).filter(i=>i.action==='review'),units=(r?.trendUnits??[]).filter(u=>u.action==='hold'),plans=s.plans.filter(p=>p.date===s.date);
 const candidates=new Set(ideas.flatMap(i=>i.candidates.map(c=>c.symbol)));
 const rows=d=>(r?.departmentResearch?.[d]??[]).filter(x=>ideas.some(i=>i.id===x.ideaId&&i.candidates.some(c=>c.symbol===x.symbol)));
 const fundamental=rows('fundamental'),technical=rows('technical'),stages=s.analysis.researchReadiness?.stages;
 const status=stage=>({complete:'완료',pending:'검토 대기',watch:'관찰'}[stages?.[stage]]??'검토 대기');
 const stamp=new Date(now).toISOString(),base={asOf:stamp},quant=s.analysis.quantResearch??[],quantRows=quant.flatMap(q=>q.candidates);
 return [
  {...base,name:'산업·테마분석부',status:status('ideas'),result:`컨셉 ${ideas.filter(i=>i.sourceDepartments.includes('screening')).length}개 · 고유 후보 ${candidates.size}개`,details:r?.topDown||'산업·정책·수요와 참조지수에서 컨셉 발굴 대기'},
  {...base,name:'기술적 분석부',status:status('technical'),result:`후보 검토 ${technical.length}건 · 가격 계산 ${s.analysis.reports.length}개`,details:'발굴 후보의 추세·모멘텀·변동성과 진입 시점을 검증합니다. 외부 검토와 가격 규칙 계산을 구분하고 운용 판단을 지원합니다.'},
  {...base,name:'펀더멘탈부',status:status('fundamental'),result:`후보 검토 ${fundamental.length}건 · 사업 통과 ${fundamental.filter(x=>x.businessPass).length}건 · 숫자 통과 ${[...candidates].filter(x=>s.fundamentals?.[x]?.numericPass).length}종목`,details:r?.bottomUp||'후보별 사업·공시 검토 대기. 같은 기업도 아이디어별 사업 연결을 따로 판단합니다.'},
  {...base,name:'마켓부',status:status('ideas'),result:`컨셉 ${ideas.filter(i=>i.sourceDepartments.includes('market')).length}개 · 매크로 관측 ${r?.macroScorecard?.length??0}건`,details:r?.marketReview||'성장·물가·정책·유동성, 금리·환율·크레딧과 시장 국면·현금 배분 판단 대기'},
  {...base,name:'리스크관리부',status:plans.some(p=>p.riskReview?.status==='held')?'일부 보류':plans.some(p=>p.riskReview)?'심사':'편입안 대기',result:`편입안 ${plans.filter(p=>p.riskReview).length}건 · 위험 보류 ${plans.filter(p=>p.riskReview?.status==='held').length}건 · 기본 규모의 ${((s.policy?.riskScale??1)*100).toFixed(0)}%`,details:'유닛·현금·종목·업종·총/순노출·증거금·손실 한도를 심사하고 체결 직전 재검사합니다. 기존 보유 위험 청산은 유지합니다.'},
  {...base,name:'운용부',status:status('management'),result:`최종 바스켓 ${units.length}개 · 선정 ${units.reduce((n,u)=>n+u.members.length,0)}종목 · 승인 ${summary.approved}건 · 체결 ${summary.newExecutions}건`,details:r?.decision||'기업·계량·기술 검토와 반대 의견을 종합해 편입·예비·제외와 비중·목표·기한 결정 대기'},
  {...base,name:'퀀트리서치부',status:!quantRows.length?'계산 대기':quantRows.some(c=>!c.ready)?'일부 보류':'완료',result:`아이디어 ${quant.length}개 · 후보 계산 ${quantRows.length}건 · 순위 산출 ${quantRows.filter(c=>c.rank!==null).length}건 · 바스켓 가격 전략 검증 ${units.reduce((n,u)=>n+researchForUnit(s,u.id).filter(x=>x.pass).length,0)}건`,details:quantMethod.method+' · '+quantMethod.limitations},
 ];
}
