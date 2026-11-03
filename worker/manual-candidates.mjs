import {eligibleCatalog} from '../web/universe.mjs';

// 2026-10-28 user request: stocks the owner names must be reviewed as candidates by the next pre-market research.
// The list only forces review; selection, Claude review, numeric checks and account limits are unchanged.
export const MANUAL_PENDING_LIMIT=20;
const KEEP=50;
const catalog=new Map(eligibleCatalog.map(c=>[c.symbol,c]));
const pending=state=>(state.manualCandidates??[]).filter(m=>!m.reviewedAt);

export function addManualCandidate(state,input,now=Date.now()){
 const symbol=typeof input?.symbol==='string'?input.symbol.trim().toUpperCase():'';
 const c=catalog.get(symbol);
 if(!c)throw Error('코스피200·S&P500·닛케이225 후보에 있는 종목코드만 추가할 수 있습니다.');
 const note=input.note===undefined?'':input.note;
 if(typeof note!=='string'||note.length>300)throw Error('메모는 300자 이하 문자열이어야 합니다.');
 if(state.holdings?.some(h=>h.symbol===symbol))throw Error('이미 보유 중인 종목입니다.');
 if(pending(state).some(m=>m.symbol===symbol))throw Error('이미 검토 대기 중인 종목입니다.');
 if(pending(state).length>=MANUAL_PENDING_LIMIT)throw Error(`검토 대기 종목은 최대 ${MANUAL_PENDING_LIMIT}개입니다.`);
 // A re-added symbol replaces its old reviewed entry; the oldest reviewed entries fall off past KEEP.
 const rest=(state.manualCandidates??[]).filter(m=>m.symbol!==symbol);
 state.manualCandidates=[...rest,{symbol,name:c.name,country:c.country,note:note.trim(),addedAt:new Date(now).toISOString()}].slice(-KEEP);
 return state.manualCandidates;
}
export function removeManualCandidate(state,symbol){
 const before=state.manualCandidates??[];
 state.manualCandidates=before.filter(m=>m.symbol!==symbol);
 if(state.manualCandidates.length===before.length)throw Error('목록에 없는 종목입니다.');
 return state.manualCandidates;
}

// The research has no market field; the prompt requires all five macro factors for every region of its market,
// so the scorecard and idea regions tell which manual stocks this run must cover (asia: 한국·일본, us: 미국).
const researchedRegions=research=>new Set([...(research.macroScorecard??[]).map(r=>r.region),...(research.investmentIdeas??[]).filter(i=>i.action!=='withdraw').map(i=>i.region)]);
function coveringIdea(research,symbol){
 const reviewed=ideaId=>['fundamental','technical'].every(d=>research.departmentResearch?.[d]?.some(r=>r.ideaId===ideaId&&r.symbol===symbol&&r.reason?.trim()&&r.sourceUrls?.length));
 return (research.investmentIdeas??[]).find(i=>i.action!=='withdraw'&&i.candidates.some(c=>c.symbol===symbol)&&reviewed(i.id));
}
// Gaps carry ideaId null and kind 'manual', so they never hold another idea's ready basket.
export function manualGaps(state,research){
 const regions=researchedRegions(research);
 return pending(state).filter(m=>regions.has(m.country)&&!coveringIdea(research,m.symbol)).map(m=>({stage:'ideas',ideaId:null,region:m.country,kind:'manual',field:'manual.'+m.symbol,reason:'사용자 필수 검토 종목: 컨셉 후보에 넣고 원문 근거 있는 기업·기술 검토 필요',symbol:m.symbol}));
}
// Called when an approved pre-market run saves its research. Uncovered stocks stay pending for the next pre-market.
export function markManualReviewed(state,research,now=Date.now()){
 for(const m of pending(state)){
  const idea=coveringIdea(research,m.symbol);if(!idea)continue;
  const unit=(research.trendUnits??[]).find(u=>u.action!=='exit'&&u.ideaId===idea.id&&u.members.some(x=>x.symbol===m.symbol));
  const row=research.departmentResearch?.fundamental?.find(r=>r.ideaId===idea.id&&r.symbol===m.symbol);
  m.reviewedAt=new Date(now).toISOString();
  m.outcome=unit?{status:'바스켓 제안',ideaId:idea.id,unit:unit.name}:{status:'관찰',ideaId:idea.id,reason:String(row?.reason??'').slice(0,300)};
 }
}
export const manualContext=state=>pending(state).map(({symbol,name,country,note,addedAt})=>({symbol,name,country,note,addedAt}));
